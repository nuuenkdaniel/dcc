import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import type {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {createHash} from 'node:crypto'
import {TOOLS,plainRecord,isCreation,type Result,type ToolName} from './contracts.js'
import {Dispatcher} from './dispatcher.js'
import {SqlIntentStore,IntentStoreError} from './intent-store.js'
import {ServiceTransport} from './service-transport.js'
import {serviceToolDefinitions} from './service-contracts.js'
import {composeSdkServer} from './sdk-server.js'
import {REQUEST_LIMITS,requestContext,type IntentRecord,type IntentPolicy,type ConversationGuard} from './request-intent.js'
import {validClarification,type Clarification} from './clarification.js'
import {validGuard} from './conversation-validation.js'
import {validRuntimeCompletion,type RuntimeCompletion,type AssistantReply} from './assistant-reply.js'

// A testable in-process port, NOT a Hermes CLI output format or transport adapter.
export type ModelRound={calls:{id:string;tool:string;arguments:Record<string,unknown>}[];done:boolean;final?:unknown}
export type ModelRunner=(input:{prompt:string;round:number;tools:Tool[];results:{id:string;result:Result}[];signal:AbortSignal})=>Promise<ModelRound>
export type NativeMcpRun={server:Server;prompt:string;allowedTools:readonly ToolName[];signal:AbortSignal;expiresAt:number;correlate:(id:string|number)=>string;active:()=>Promise<boolean>;replyVersion?:1}
export type NativeMcpRunner=(input:NativeMcpRun)=>Promise<void|RuntimeCompletion>
export type IntentSummary={phase:IntentRecord['phase'];outcome?:IntentRecord['outcome'];effects:{tool:string;state:string;id?:string;version?:number;confirmation?:'snapshot_pending'}[];pending:number;reads?:{tool:string;data:unknown}[];readsTruncated?:true;clarifications?:Clarification[];assistantReply?:AssistantReply;replyUnavailable?:true}
// Fixed projections only: never echo prompt, payload, policy, owner, model prose,
// read projections or arbitrary error text into the authoritative UI result.
export function summarizeIntent(record:IntentRecord):IntentSummary {
  const clarifications=record.calls.filter(c=>c.command.tool==='request_clarification'&&c.result?.state==='ok').map(c=>(c.result as Extract<Result,{state:'ok'}>).data).filter(validClarification).slice(0,3)
  const allReads=record.calls.filter(c=>c.command.tool!=='request_clarification'&&c.command.tool!=='list_prices'&&!TOOLS[c.command.tool].write&&c.result?.state==='ok').map(c=>({tool:c.command.tool,data:(c.result as Extract<Result,{state:'ok'}>).data}))
  const reads:typeof allReads=[];let bytes=0
  for(const read of [...allReads].reverse()){
    const size=Buffer.byteLength(JSON.stringify(read),'utf8')
    if(bytes+size<=1200000){reads.unshift(read);bytes+=size}
  }
  return {phase:record.phase,...(record.outcome?{outcome:record.outcome}:{}),...(clarifications.length?{clarifications}:{}),effects:record.calls.filter(c=>TOOLS[c.command.tool].write&&c.result).map(c=>{
    const r=c.result!
    return {tool:c.command.tool,state:r.state,...(r.state==='applied'&&'version' in r?{id:r.id,version:r.version}:{}),...(r.state==='saved'?{confirmation:'snapshot_pending' as const}:{})}
  }),pending:record.calls.filter(c=>!c.result||c.result.state==='uncertain').length,
    ...(record.allowedTools.length>3?{reads,...(reads.length<allReads.length?{readsTruncated:true as const}:{})}:{})}
}
export function requestTools(record:{allowedTools:readonly ToolName[]}):Tool[]{
  return serviceToolDefinitions().filter(t=>record.allowedTools.includes(t.name as IntentRecord['allowedTools'][number])).map(tool=>{
    const t=structuredClone(tool),properties=t.inputSchema.properties??{}
    if(TOOLS[t.name as keyof typeof TOOLS].write){
      delete properties.operationKey
      if(isCreation(t.name as ToolName))delete properties.id
    }
    t.inputSchema.properties=properties
    if(t.inputSchema.required)t.inputSchema.required=t.inputSchema.required.filter(k=>Object.hasOwn(properties,k))
    return t
  })
}
export class RequestController {
  constructor(private readonly options:{store:SqlIntentStore;transport:ServiceTransport;runner?:ModelRunner;nativeRunner?:NativeMcpRunner;now?:()=>number}){
    if(options.store.actorScope!==options.transport.actorScope)throw new IntentStoreError('actor_mismatch')
    if(!!options.runner===!!options.nativeRunner)throw new IntentStoreError('runner_configuration')
  }
  private async recover(key:string):Promise<IntentSummary>{
    const {store,transport}=this.options
    let record=(await store.interrupt(key)).record
    if(record.phase==='uncertain')for(const call of record.calls){
      if(!TOOLS[call.command.tool].write||call.result&&call.result.state!=='uncertain')continue
      const result=await transport.reconcile(call.command,requestContext(record))
      if(result)record=(await store.recovered(key,call.id,result)).record
      // Missing receipt is NOT evidence that the operation never started.
    }
    return summarizeIntent(await store.read(key))
  }
  async run(input:{key:string;prompt:string;tabId?:string;guard?:ConversationGuard;replyVersion?:1},policy:IntentPolicy,signal?:AbortSignal):Promise<IntentSummary>{
    const {store,transport,runner,nativeRunner}=this.options,now=this.options.now??Date.now
    const admitted=await store.admit({key:input.key,prompt:input.prompt,purpose:'action',...(input.guard?{guard:input.guard}:{}),...(input.tabId?{tabId:input.tabId}:{})},policy)
    // Existing legacy intents are not executed by this source-only controller.
    if(admitted.executor!=='mcp-action-v1'){
      if(nativeRunner)throw new IntentStoreError('executor_conflict')
      return summarizeIntent(admitted)
    }
    if(nativeRunner&&(admitted.allowedTools.length!==policy.allowedTools.length||admitted.allowedTools.some(tool=>!policy.allowedTools.includes(tool)))){
      if(admitted.phase!=='admitted'&&admitted.allowedTools.every(tool=>tool==='list_prices'||policy.allowedTools.includes(tool)))return this.recover(input.key)
      throw new IntentStoreError('executor_conflict')
    }
    if(signal?.aborted)return this.recover(input.key)
    const claim=await store.start(input.key,now())
    if(!claim.owner||claim.directive!=='start_model'){
      // A concurrent retry may fence the live owner, but must never replace it.
      return this.recover(input.key)
    }
    const owner=claim.owner,abort=new AbortController(),deadline=claim.record.startedAt!+REQUEST_LIMITS.timeoutMs
    const stop=()=>abort.abort()
    signal?.addEventListener('abort',stop,{once:true})
    if(signal?.aborted)stop()
    const timer=setTimeout(stop,Math.max(0,deadline-now()))
    const check=()=>{if(abort.signal.aborted||now()>=deadline)throw new IntentStoreError('interrupted')}
    const dispatcher=new Dispatcher(transport),tools=requestTools(claim.record)
    let expectedId:string|undefined
    // All execution lanes share the same durable reservation/result boundary.
    // Only the SDK adapter below accepts transport correlation metadata.
    const dispatch=async(id:string,tool:unknown,args:unknown):Promise<Result>=>{
      check()
      const reserved=await store.reserve(input.key,owner,id,tool,args,now())
      if(reserved.directive==='replay')return reserved.result!
      if(reserved.directive==='reconcile'){
        const result=await transport.reconcile(reserved.command!,requestContext(reserved.record))
        if(result)await store.result(input.key,owner,id,result)
        return result??{state:'uncertain',operationKey:String(reserved.command!.args.operationKey)}
      }
      check() // Reservation is durable; cancellation here leaves a pending call.
      // No intent lock or pool connection survives the reservation transaction.
      const result=await dispatcher.dispatch(tool,reserved.command!.args,requestContext(reserved.record))
      await store.result(input.key,owner,id,result) // Preserve late backend receipts.
      return result
    }
    const server=composeSdkServer({name:'dcc-request-action',instructions:'Bounded admitted request actions. Backend receipts alone establish effects.',source:'dcc-service',tools:()=>tools,dispatch:async(tool,args,meta)=>{
      check()
      const correlated=nativeRunner?meta?.hostCallId:expectedId
      if(typeof correlated!=='string'||(!nativeRunner&&meta?.nativeCallId!==expectedId))return {state:'rejected',code:'forbidden'}
      return dispatch(correlated,tool,args)
    }})
    const client=new Client({name:'dcc-request-host',version:'0.1.0'})
    const [clientWire,serverWire]=InMemoryTransport.createLinkedPair()
    const history:{id:string;result:Result}[]=[]
    const work=async():Promise<IntentSummary>=>{
      const guard=claim.record.guard
      // Only a new owner of an immutable, bound, fully resolved host checklist.
      // Existing active/uncertain/legacy claims returned above, never enter here.
      if(validGuard(guard)&&guard.binding&&guard.checklist&&!guard.questionOnly&&!guard.questionReason&&!guard.readOnly&&claim.record.allowedTools.includes('list_tasks')&&claim.record.allowedTools.includes('create_task')){
        check();await store.round(input.key,owner,now());check()
        const goals=guard.checklist.tasks
        const verified=async(record:IntentRecord)=>{
          const writes=record.calls.filter(c=>TOOLS[c.command.tool].write)
          if(writes.length!==goals.length||new Set(writes.map(c=>c.command.args.id)).size!==goals.length)return false
          for(const goal of goals){
            check()
            const call=writes.find(c=>c.command.tool==='create_task'&&c.command.args.title===goal.title&&c.command.args.date===goal.date)
            if(!call||call.result?.state!=='applied')return false
            const target=await transport.inspect(call.command,call.result,true)
            check()
            if(target.kind!=='task'||target.action!=='added'||target.id!==call.command.args.id||target.title!==goal.title||target.date!==goal.date||target.state!=='applied'||target.verification!=='verified')return false
          }
          return true
        }
        for(const [index,goal] of goals.entries()){
          // list_tasks exposes the global collection version independent of its
          // date filter/page. Item text is never used to choose another action.
          const read=await dispatch(`checklist_read_${index+1}`,'list_tasks',{from:'2000-01-01',to:'2000-01-02',limit:1})
          if(read.state!=='ok'||!plainRecord(read.data)||!Number.isInteger(read.data.collectionVersion))throw new IntentStoreError('checklist_read_failed')
          const result=await dispatch(`checklist_create_${index+1}`,'create_task',{title:goal.title,date:goal.date,expectedVersion:read.data.collectionVersion})
          if(result.state!=='applied')throw new IntentStoreError('checklist_incomplete')
          check()
        }
        const record=await store.read(input.key)
        if(record.phase!=='active'||record.ownerId!==owner||!await verified(record))throw new IntentStoreError('checklist_unverified')
        check()
        return summarizeIntent((await store.finish(input.key,owner)).record)
      }
      if(nativeRunner){
        check();await store.round(input.key,owner,now());check()
        const completion=await nativeRunner({server,prompt:input.prompt,signal:abort.signal,expiresAt:deadline,...(input.replyVersion===1?{replyVersion:1 as const}:{}),
          // Persisted call.id binds this transport ID within this ONE owner. A
          // restarted/reconnected invocation never receives a replacement owner.
          correlate:id=>'rpc_'+createHash('sha256').update(JSON.stringify([owner,typeof id,id])).digest('hex'),
          allowedTools:Object.freeze([...claim.record.allowedTools]),active:async()=>{
            if(abort.signal.aborted||now()>=deadline)return false
            const r=await store.read(input.key)
            return r.phase==='active'&&r.ownerId===owner
          }})
        check()
        const record=await store.read(input.key)
        if(record.phase!=='active'||record.ownerId!==owner)return summarizeIntent(record)
        const summary=summarizeIntent((await store.finish(input.key,owner)).record)
        // Ephemeral return only. Never persist display text in an intent/receipt.
        if(input.replyVersion===1&&summary.phase==='completed'){
          if(validRuntimeCompletion(completion)&&completion.assistantText!==undefined)return {...summary,assistantReply:{version:1 as const,text:completion.assistantText}}
          return {...summary,replyUnavailable:true}
        }
        return summary
      }
      await server.connect(serverWire);await client.connect(clientWire)
      await client.listTools()
      for(let round=0;round<REQUEST_LIMITS.maxRounds;round++){
        check();await store.round(input.key,owner,now());check()
        const response=await runner!({prompt:input.prompt,round:round+1,tools:structuredClone(tools),results:structuredClone(history),signal:abort.signal})
        check()
        if(!plainRecord(response)||!Array.isArray(response.calls)||response.calls.length>REQUEST_LIMITS.maxCalls||typeof response.done!=='boolean')throw new IntentStoreError('invalid_model_round')
        for(const call of response.calls){
          check()
          if(!plainRecord(call)||typeof call.id!=='string'||typeof call.tool!=='string'||!plainRecord(call.arguments))throw new IntentStoreError('invalid_model_call')
          expectedId=call.id
          // SDK framing and schema handling are real. _meta is correlation only;
          // actor, capabilities and owner are captured exclusively by the host.
          await client.callTool({name:call.tool,arguments:call.arguments,_meta:{nativeCallId:call.id}})
          expectedId=undefined
          const record=await store.read(input.key),stored=record.calls.find(c=>c.id===call.id)
          if(stored?.result)history.push({id:call.id,result:stored.result})
          if(record.phase!=='active')return summarizeIntent(record)
        }
        if(response.done){check();return summarizeIntent((await store.finish(input.key,owner)).record)}
        // response.final is intentionally never read, trusted or summarized.
      }
      throw new IntentStoreError('budget_exhausted')
    }
    let onAbort:(()=>void)|undefined
    const interrupted=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>reject(new IntentStoreError('interrupted'))
      abort.signal.addEventListener('abort',onAbort,{once:true})
      if(abort.signal.aborted)onAbort()
    })
    try{return await Promise.race([work(),interrupted])}
    catch{return await this.recover(input.key)}
    finally{
      abort.abort();clearTimeout(timer);signal?.removeEventListener('abort',stop)
      if(onAbort)abort.signal.removeEventListener('abort',onAbort)
      await client.close();await server.close()
    }
  }
}
