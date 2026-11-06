import {randomBytes} from 'node:crypto'
import {plainRecord,type Command,type Result,type Code} from './contracts.js'
import type {Context} from './dispatcher.js'

export const isTimerTool=(tool:string)=>['get_focus_timer','control_focus_timer','edit_focus_queue'].includes(tool)
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plainRecord(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',')
export function validTimerSnapshot(v:unknown):boolean{
  if(!exact(v,['version','focusMinutes','breakMinutes','phase','sessionRemainingMs','running','activeMiniId','miniTimers'])||!integer(v.version,1,2147483646)||!integer(v.focusMinutes,1,180)||!integer(v.breakMinutes,1,60)||!['focus','break'].includes(String(v.phase))||!integer(v.sessionRemainingMs,0,10800000)||typeof v.running!=='boolean'||!Array.isArray(v.miniTimers)||v.miniTimers.length>60)return false
  if(v.running&&v.sessionRemainingMs===0||v.phase==='break'&&v.activeMiniId!==null)return false
  const ids=new Set<string>()
  for(const t of v.miniTimers){
    if(!exact(t,['id','name','duration','remainingMs'])||typeof t.id!=='string'||!/^[a-f0-9-]{36}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>240||!integer(t.duration,60,7200)||!integer(t.remainingMs,0,Number(t.duration)*1000))return false
    ids.add(t.id)
  }
  return v.activeMiniId===null||typeof v.activeMiniId==='string'&&ids.has(v.activeMiniId)
}
type Entry={key:string;tabId:string;nonce:string;command:Command;expiresAt:number;recoverOnly?:true;result?:Result;resolve:(result:Result)=>void}
// Request-local browser rendezvous, NOT backend timer state. Durable intent calls
// own completed receipts. Restart/lost rendezvous fails uncertain, never replays.
export class BrowserTimerBridge {
  private entries=new Map<string,Entry>()
  constructor(private readonly now=()=>Date.now(),private readonly waitMs=10000){}
  async execute(command:Command,context:Context):Promise<Result>{
    if(!context.browserTabId||!context.invocationKey)return {state:'rejected',code:'transport_unconfigured'}
    const id=String(command.args.operationKey??'read_'+randomBytes(16).toString('hex'))
    const old=this.entries.get(id)
    if(old){
      if(old.key!==context.invocationKey||old.tabId!==context.browserTabId)return {state:'rejected',code:'forbidden'}
      if(JSON.stringify(old.command)!==JSON.stringify(command))return {state:'conflict',code:'operation_key_mismatch'}
      return old.result??{state:'uncertain',operationKey:id}
    }
    for(const [k,e] of this.entries)if(e.expiresAt<this.now()-120000)this.entries.delete(k)
    if(this.entries.size>=128)return {state:'rejected',code:'operation_capacity'}
    return new Promise<Result>(resolve=>{
      const expiresAt=this.now()+this.waitMs
      const timer=setTimeout(()=>{resolve(command.tool==='get_focus_timer'?{state:'rejected',code:'cache_unavailable'}:{state:'uncertain',operationKey:id})},this.waitMs)
      this.entries.set(id,{key:context.invocationKey!,tabId:context.browserTabId!,nonce:randomBytes(32).toString('hex'),command:structuredClone(command),expiresAt,resolve:result=>{clearTimeout(timer);resolve(result)}})
    })
  }
  reconcile(command:Command):Result|undefined{return this.entries.get(String(command.args.operationKey))?.result}
  async recover(command:Command,context:Context):Promise<Result>{
    for(const [key,entry] of this.entries)if(entry.expiresAt<this.now()-120000)this.entries.delete(key)
    const id=String(command.args.operationKey),known=this.reconcile(command)
    if(known)return known
    if(!context.browserTabId||!context.invocationKey)return {state:'uncertain',operationKey:id}
    const previous=this.entries.get(id)
    if(previous){previous.expiresAt=this.now()-1;previous.resolve({state:'uncertain',operationKey:id})}
    const recoveryId=id+':receipt'
    const pending=this.entries.get(recoveryId)
    if(pending?.result&&pending.result.state!=='uncertain')return pending.result
    if(pending&&pending.expiresAt>this.now())return {state:'uncertain',operationKey:id}
    if(this.entries.size>=128)return {state:'uncertain',operationKey:id}
    return new Promise<Result>(resolve=>{
      const timer=setTimeout(()=>resolve({state:'uncertain',operationKey:id}),this.waitMs)
      this.entries.set(recoveryId,{key:context.invocationKey!,tabId:context.browserTabId!,nonce:randomBytes(32).toString('hex'),command:structuredClone(command),recoverOnly:true,expiresAt:this.now()+this.waitMs,resolve:result=>{clearTimeout(timer);resolve(result)}})
    })
  }
  poll(key:string,tabId:string){
    return [...this.entries.values()].filter(e=>e.key===key&&e.tabId===tabId&&!e.result&&e.expiresAt>this.now()).map(e=>({nonce:e.nonce,command:e.command,expiresAt:e.expiresAt,...(e.recoverOnly?{recoverOnly:true}:{})}))
  }
  ack(key:string,tabId:string,body:unknown):boolean{
    if(!exact(body,['nonce','result'])||typeof body.nonce!=='string')return false
    const e=[...this.entries.values()].find(e=>e.nonce===body.nonce&&e.key===key&&e.tabId===tabId)
    if(!e||e.expiresAt<=this.now())return false
    const r=body.result
    // A recovery refusal is not proof that an earlier operation had no effect.
    // Only a matching applied receipt or explicit uncertainty can resolve it.
    if(e.recoverOnly&&(!plainRecord(r)||!['applied','uncertain'].includes(String(r.state))))return false
    let accepted:Result
    if(e.recoverOnly&&exact(r,['state','operationKey'])&&r.state==='uncertain'&&r.operationKey===e.command.args.operationKey){
      accepted={state:'uncertain',operationKey:String(r.operationKey)}
    }else if(e.command.tool==='get_focus_timer'&&exact(r,['state','data'])){
      if(r.state!=='ok'||!validTimerSnapshot(r.data))return false
      accepted={state:'ok',data:r.data}
    }else if(exact(r,['state','id','version'])){
      if(e.command.tool==='get_focus_timer'||r.state!=='applied'||r.id!==e.command.args.id||typeof r.id!=='string'||!integer(r.version,Number(e.command.args.expectedVersion),2147483646))return false
      accepted={state:'applied',id:r.id,version:Number(r.version)}
    }else{
      if(!exact(r,['state','code'])||!['rejected','conflict'].includes(String(r.state))||!['revision_mismatch','invalid_arguments','operation_capacity','forbidden','not_found'].includes(String(r.code)))return false
      accepted={state:r.state==='conflict'?'conflict':'rejected',code:r.code as Code}
    }
    if(e.result)return JSON.stringify(e.result)===JSON.stringify(accepted)
    e.result=structuredClone(accepted);e.resolve(e.result);return true
  }
}
