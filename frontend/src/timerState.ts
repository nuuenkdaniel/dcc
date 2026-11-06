import {advanceFocusTimer,startFocusTimer,canReorderFocusTimers,type FocusTimerState} from './focusTimer'

export const TIMER_STORAGE='dcc.focus-timer.tab.v1',TIMER_TAB='dcc.hermes.tab.v1'
export type Reply={state:'ok';data:unknown}|{state:'applied';id:string;version:number}|{state:'rejected'|'conflict';code:string}|{state:'uncertain';operationKey:string}
export type TimerDocument={version:number;focusMinutes:number;breakMinutes:number;timer:FocusTimerState;updatedAt:number;receiptFloorVersion?:number;receipts:Record<string,{fingerprint:string;result:Reply}>}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)
export function freshTimer(now:number):TimerDocument{return {version:1,focusMinutes:25,breakMinutes:5,timer:{phase:'focus',sessionRemainingMs:1500000,running:false,miniTimers:[],activeMiniId:null,sessionStarted:false},updatedAt:now,receipts:{}}}
export function timerSnapshot(d:TimerDocument){const {sessionStarted:_started,...timer}=d.timer;return {version:d.version,focusMinutes:d.focusMinutes,breakMinutes:d.breakMinutes,...timer}}
export function validTimerDocument(v:unknown):v is TimerDocument{
  if(!record(v)||!int(v.version,1,2147483646)||!int(v.focusMinutes,1,180)||!int(v.breakMinutes,1,60)||!int(v.updatedAt,0,Number.MAX_SAFE_INTEGER)||!record(v.receipts)||Object.keys(v.receipts).length>128||!record(v.timer))return false
  if(v.receiptFloorVersion!==undefined&&!int(v.receiptFloorVersion,0,Number(v.version)))return false
  const t=v.timer
  if(t.sessionStarted!==undefined&&typeof t.sessionStarted!=='boolean')return false
  if(!['focus','break'].includes(String(t.phase))||typeof t.running!=='boolean'||!int(t.sessionRemainingMs,0,10800000)||!Array.isArray(t.miniTimers)||t.miniTimers.length>60)return false
  if(t.running&&t.sessionRemainingMs===0||t.phase==='break'&&t.activeMiniId!==null)return false
  const ids=new Set<string>()
  for(const m of t.miniTimers){if(!record(m)||!uuid(m.id)||ids.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>240||!int(m.duration,60,7200)||!int(m.remainingMs,0,Number(m.duration)*1000))return false;ids.add(m.id)}
  for(const [key,receipt] of Object.entries(v.receipts)){
    if(!/^dcc_op_[a-f0-9-]{36}$/.test(key)||!record(receipt)||typeof receipt.fingerprint!=='string'||receipt.fingerprint.length>20000||!record(receipt.result)||receipt.result.state!=='applied'||!uuid(receipt.result.id)||!int(receipt.result.version,1,Number(v.version)))return false
  }
  return t.activeMiniId===null||typeof t.activeMiniId==='string'&&ids.has(t.activeMiniId)
}
export function restoreTimerDocument(value:unknown,now:number){
  if(!validTimerDocument(value)||!int(now,0,Number.MAX_SAFE_INTEGER))throw Error('Invalid stored timer clock')
  const elapsed=now-value.updatedAt
  const timer={...value.timer,sessionStarted:value.timer.sessionStarted??(value.timer.running||value.timer.activeMiniId!==null||value.timer.phase==='break'||value.timer.sessionRemainingMs!==(value.timer.miniTimers[0]?.remainingMs??value.focusMinutes*60000))}
  return {document:{...value,timer:elapsed<0?{...timer,running:false}:advanceFocusTimer(timer,elapsed,value.focusMinutes*60000,value.breakMinutes*60000),updatedAt:now},warning:elapsed<0?'Clock moved backwards; timer paused for review.':''}
}
// Atomic document update: effects and replay receipts are persisted together.
export function applyTimerCommand(d:TimerDocument,command:unknown,now:number,recoverOnly=false):{document:TimerDocument;result:Reply}{
  const reject=(code:string,state:'rejected'|'conflict'='rejected')=>({document:d,result:{state,code} as Reply})
  if(!record(command)||!record(command.args)||typeof command.tool!=='string')return reject('invalid_arguments')
  const a=command.args
  if(command.tool==='get_focus_timer')return Object.keys(a).length?reject('invalid_arguments'):{document:d,result:{state:'ok',data:timerSnapshot(d)}}
  if(!['control_focus_timer','edit_focus_queue'].includes(command.tool)||typeof a.operationKey!=='string'||!/^dcc_op_[a-f0-9-]{36}$/.test(a.operationKey)||!uuid(a.id)||!int(a.expectedVersion,1,2147483646))return reject('invalid_arguments')
  const fingerprint=JSON.stringify([command.tool,Object.fromEntries(Object.entries(a).sort(([x],[y])=>x.localeCompare(y)))])
  const prior=d.receipts[a.operationKey]
  if(prior)return prior.fingerprint===fingerprint?{document:d,result:prior.result}:reject('forbidden')
  // A recovery challenge may read proof but can NEVER execute the old mutation.
  if(recoverOnly||Number(a.expectedVersion)<(d.receiptFloorVersion??0))return {document:d,result:{state:'uncertain',operationKey:a.operationKey}}
  if(d.version!==a.expectedVersion)return reject('revision_mismatch','conflict')
  const next=structuredClone(d),t=next.timer
  if(Object.keys(next.receipts).length>=128){
    const oldest=Object.entries(next.receipts).sort(([,a],[,b])=>('version' in a.result?a.result.version:0)-('version' in b.result?b.result.version:0)).slice(0,64)
    for(const [key,receipt] of oldest){if(receipt.result.state!=='applied')return reject('forbidden');next.receiptFloorVersion=Math.max(next.receiptFloorVersion??0,receipt.result.version);delete next.receipts[key]}
  }
  if(command.tool==='control_focus_timer'){
    if(Object.keys(a).some(k=>!['operationKey','id','expectedVersion','action','phase','focusMinutes','breakMinutes'].includes(k)))return reject('invalid_arguments')
    if(a.action==='configure'){
      if(a.phase!==undefined||a.focusMinutes===undefined&&a.breakMinutes===undefined||a.focusMinutes!==undefined&&!int(a.focusMinutes,1,180)||a.breakMinutes!==undefined&&!int(a.breakMinutes,1,60))return reject('invalid_arguments')
      if(typeof a.focusMinutes==='number'){next.focusMinutes=a.focusMinutes;if(!t.running&&t.phase==='focus'&&!t.miniTimers.length)t.sessionRemainingMs=a.focusMinutes*60000}
      if(typeof a.breakMinutes==='number'){next.breakMinutes=a.breakMinutes;if(!t.running&&t.phase==='break')t.sessionRemainingMs=a.breakMinutes*60000}
    }else{
      if(a.focusMinutes!==undefined||a.breakMinutes!==undefined||a.phase!==undefined&&a.action!=='start')return reject('invalid_arguments')
      if(a.action==='reset'){
        t.miniTimers=t.miniTimers.map(m=>({...m,remainingMs:m.duration*1000}));t.running=false;t.sessionStarted=false;t.phase='focus';t.activeMiniId=null;t.sessionRemainingMs=t.miniTimers[0]?.remainingMs??next.focusMinutes*60000
      }else if(a.action==='pause')t.running=false
      else if(a.action==='resume'||a.action==='start'){
        if(a.phase!==undefined&&!['focus','break'].includes(String(a.phase)))return reject('invalid_arguments')
        if(a.phase!==undefined&&a.phase!==t.phase){
          if(t.running||t.sessionStarted!==false)return reject('revision_mismatch','conflict') // Reset first before selecting a different phase.
          t.phase=a.phase as 'focus'|'break';t.activeMiniId=null;t.sessionRemainingMs=(t.phase==='break'?next.breakMinutes:next.focusMinutes)*60000
        }
        Object.assign(t,startFocusTimer(t,next.focusMinutes*60000))
        if(t.sessionRemainingMs<=0)return reject('invalid_arguments')
        t.running=true
      }else return reject('invalid_arguments')
    }
  }else{
    if(Object.keys(a).some(k=>!['operationKey','id','expectedVersion','action','miniId','beforeId','name','minutes'].includes(k)))return reject('invalid_arguments')
    if(a.action==='add'){
      if(a.miniId!==undefined||a.beforeId!==undefined||typeof a.name!=='string'||!a.name.trim()||a.name.length>240||!int(a.minutes,1,120)||t.miniTimers.length>=60)return reject('invalid_arguments')
      const m={id:a.id,name:a.name.trim(),duration:Number(a.minutes)*60,remainingMs:Number(a.minutes)*60000}
      if(!t.miniTimers.length&&t.phase==='focus'&&!t.running&&t.sessionStarted!==true)t.sessionRemainingMs=m.remainingMs
      t.miniTimers.push(m)
    }else{
      if(a.name!==undefined||a.minutes!==undefined||!uuid(a.miniId))return reject('invalid_arguments')
      const index=t.miniTimers.findIndex(m=>m.id===a.miniId)
      if(index<0)return reject('not_found')
      if(a.action==='remove'){
        if(a.beforeId!==undefined)return reject('invalid_arguments')
        t.miniTimers.splice(index,1);if(t.activeMiniId===a.miniId)t.activeMiniId=null
      }else if(a.action==='move'){
        if(!uuid(a.beforeId)||!t.miniTimers.some(m=>m.id===a.beforeId))return reject('not_found')
        if(!canReorderFocusTimers(t))return reject('revision_mismatch','conflict')
        if(a.beforeId!==a.miniId){const [m]=t.miniTimers.splice(index,1);t.miniTimers.splice(t.miniTimers.findIndex(m=>m.id===a.beforeId),0,m);t.sessionRemainingMs=t.miniTimers[0].remainingMs}
      }else return reject('invalid_arguments')
    }
  }
  next.version++;next.updatedAt=now
  const result:Reply={state:'applied',id:a.id,version:next.version}
  next.receipts[a.operationKey]={fingerprint,result}
  return validTimerDocument(next)?{document:next,result}:reject('invalid_arguments')
}
