import {test} from 'node:test'
import assert from 'node:assert/strict'
import {admitIntent,startIntent,beginIntentRound,reserveIntentCall,recordIntentResult,interruptIntent,finishIntent,requestContext,legacyFenceForIntent,legacyReceiptEvidence,REQUEST_LIMITS,CHAT_LIMITS,requestLimits} from '../../src/mcp/request-intent.js'
import {Dispatcher} from '../../src/mcp/dispatcher.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {ServicePool} from './service-pool.js'
import {tellHermes} from '../../src/tell-hermes.js'
import type {Pool} from 'pg'

const request={actorId:'dcc-account',purpose:'action' as const,key:'authenticated_request_01',prompt:'Add a checklist item for November 1'}
const policy={executor:'mcp-action-v1' as const,allowedTools:['list_tasks','create_task','set_task_completed','get_operation_status'] as const}
function accepted<T extends {ok:boolean}>(value:T):Extract<T,{ok:true}>{
  assert.equal(value.ok,true)
  if(!value.ok)throw Error('Expected accepted transition')
  return value as Extract<T,{ok:true}>
}
function active(){
  const admitted=accepted(admitIntent(undefined,request,policy)).record
  return accepted(beginIntentRound(accepted(startIntent(admitted,1000)).record,1001)).record
}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T

test('larger capacity belongs only to immutable explicitly marked chat journals',()=>{
  assert.equal(REQUEST_LIMITS.maxWrites,4);assert.equal(REQUEST_LIMITS.maxCalls,12)
  assert.equal(CHAT_LIMITS.maxWrites,16);assert.equal(CHAT_LIMITS.maxCalls,48)
  const guard={version:1 as const,binding:'a'.repeat(64),chatVersion:1 as const}
  assert.deepEqual(admitIntent(undefined,{...request,guard},{executor:'legacy-parser-v1',allowedTools:[]}),{ok:false,code:'invalid_arguments'})
  const admitted=accepted(admitIntent(undefined,{...request,guard},policy)).record
  let chat=accepted(beginIntentRound(accepted(startIntent(admitted,1000)).record,1001)).record
  for(let i=0;i<CHAT_LIMITS.maxWrites;i++){
    const reserved=accepted(reserveIntentCall(chat,`chat_write_${i}`,'create_task',{title:`Synthetic ${i}`,date:'2026-11-01',expectedVersion:i},1002+i))
    chat=accepted(recordIntentResult(reserved.record,`chat_write_${i}`,{state:'applied',id:String(reserved.command!.args.id),version:i+1})).record
  }
  assert.deepEqual(reserveIntentCall(chat,'chat_write_over_budget','create_task',{title:'Extra',date:'2026-11-01',expectedVersion:16},1020),{ok:false,code:'budget_exhausted'})
  const legacy=active()
  assert.equal(requestLimits(legacy),REQUEST_LIMITS)
  assert.deepEqual(admitIntent(legacy,{...request,guard},policy),{ok:false,code:'intent_conflict'})
  assert.deepEqual(admitIntent(chat,request,policy),{ok:false,code:'intent_conflict'})
  assert.equal(accepted(admitIntent(chat,{...request,guard},policy)).record.calls.length,16)
})

test('intent pins prompt, actor and executor before effects; feature flips and retry cannot select a second executor',()=>{
  const first=accepted(admitIntent(undefined,request,policy)).record
  const replay=accepted(admitIntent(clone(first),request,{executor:'legacy-parser-v1',allowedTools:[]}))
  assert.equal(replay.record.executor,'mcp-action-v1')
  assert.deepEqual(replay.record,first)
  assert.deepEqual(admitIntent(first,{...request,prompt:'Different request'},policy),{ok:false,code:'intent_conflict'})
  assert.deepEqual(admitIntent(first,{...request,actorId:'another-actor'},policy),{ok:false,code:'intent_conflict'})
  const legacy=accepted(admitIntent(undefined,request,{executor:'legacy-parser-v1',allowedTools:[]})).record
  assert.equal(accepted(admitIntent(legacy,request,policy)).record.executor,'legacy-parser-v1')
  assert.equal(accepted(startIntent(first,1000)).directive,'start_model')
  const running=accepted(startIntent(first,1000)).record
  assert.equal(accepted(startIntent(clone(running),1001)).directive,'receipts_only')
})

test('preexisting Tell Hermes receipt fences new MCP selection; an executor collision fails closed',()=>{
  const legacy=accepted(admitIntent(undefined,request,policy,{promptHash:accepted(admitIntent(undefined,request,policy)).record.promptHash,completed:true})).record
  assert.equal(legacy.executor,'legacy-parser-v1')
  assert.equal(legacy.phase,'completed')
  assert.equal(accepted(startIntent(legacy,1000)).directive,'receipts_only')
  const mcp=accepted(admitIntent(undefined,request,policy)).record
  assert.deepEqual(admitIntent(mcp,request,policy,{promptHash:mcp.promptHash,completed:false}),{ok:false,code:'executor_conflict'})
  assert.deepEqual(admitIntent(undefined,request,policy,{promptHash:'0'.repeat(64),completed:false}),{ok:false,code:'intent_conflict'})
})

test('MCP sentinel is honored by the actual existing Tell Hermes implementation without model or write calls',async()=>{
  const record=accepted(admitIntent(undefined,request,policy)).record,fence=legacyFenceForIntent(record)
  const evidence=accepted(legacyReceiptEvidence(fence)).evidence
  assert.equal(accepted(admitIntent(clone(record),request,policy,evidence)).record.executor,'mcp-action-v1')
  assert.deepEqual(admitIntent(undefined,request,policy,evidence),{ok:false,code:'executor_conflict'})
  const queries:string[]=[]
  const client={query:async(sql:string,args:unknown[])=>{
    queries.push(sql)
    if(sql.startsWith('SELECT pg_advisory_')){assert.equal(args[0],record.legacyReceiptId);return {rows:[]}}
    if(sql.includes("kind='hermes-command'")){assert.equal(args[0],record.legacyReceiptId);return {rows:[{data:fence}]}}
    throw Error('Legacy executor must not write or read unrelated data')
  },release(){}}
  const result=await tellHermes({key:request.key,prompt:request.prompt},{pool:{connect:async()=>client} as unknown as Pool,curator:async()=>{throw Error('Must not call the parser')}})
  assert.deepEqual(result,fence.result)
  assert.equal(queries.length,3)
  assert.ok(queries.every(sql=>sql.startsWith('SELECT ')))
})

test('natural read then write planning needs no preapproved payload; host owns creation ID and operation key',async()=>{
  const db=new ServicePool(),dispatcher=new Dispatcher(new ServiceTransport({pool:db.pool,actorId:request.actorId}))
  let state=active()
  const read=accepted(reserveIntentCall(state,'native_read_01','list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1002))
  const readResult=await dispatcher.dispatch(read.command!.tool,read.command!.args,requestContext(read.record))
  state=accepted(recordIntentResult(read.record,'native_read_01',readResult)).record
  assert.equal(readResult.state,'ok')
  const write=accepted(reserveIntentCall(state,'native_write_01','create_task',{title:'Synthetic planned item',date:'2026-11-01',expectedVersion:0},1003))
  assert.equal(write.directive,'dispatch')
  assert.match(String(write.command!.args.id),/^[0-9a-f-]{36}$/)
  assert.match(String(write.command!.args.operationKey),/^dcc_op_/)
  const result=await dispatcher.dispatch(write.command!.tool,write.command!.args,requestContext(write.record))
  state=accepted(recordIntentResult(write.record,'native_write_01',result)).record
  const finish=accepted(finishIntent(state))
  assert.equal(finish.record.outcome,'effects_recorded')
  assert.equal(finish.record.phase,'completed')
  const replay=accepted(reserveIntentCall(clone(finish.record),'native_write_01','create_task',{title:'Synthetic planned item',date:'2026-11-01',expectedVersion:0},999999))
  assert.equal(replay.directive,'replay')
  assert.deepEqual(replay.result,result)
  assert.deepEqual(replay.command,write.command)
})

test('first-use binding rejects changed payload/tool, injected authority/keys and unsupported recurrence',()=>{
  const state=active(),input={title:'Synthetic item',date:'2026-11-01',expectedVersion:0}
  const reserved=accepted(reserveIntentCall(state,'native_write_01','create_task',input,1002))
  assert.deepEqual(reserveIntentCall(reserved.record,'native_write_01','create_task',{...input,title:'Changed'},1003),{ok:false,code:'call_mismatch'})
  assert.deepEqual(reserveIntentCall(reserved.record,'native_write_01','list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1003),{ok:false,code:'call_mismatch'})
  for(const extra of [{actorId:'caller-selected'},{capabilities:['tasks:write']},{purpose:'action'},{operationKey:'caller_selected_key_01'},{id:'caller-selected-id'}])assert.equal(reserveIntentCall(state,'native_write_01','create_task',{...input,...extra},1002).ok,false)
  assert.deepEqual(reserveIntentCall(state,'native_write_01','create_task',{...input,recurrence:{frequency:'weekly'}},1002),{ok:false,code:'unsupported_recurrence'})
  assert.deepEqual(reserveIntentCall(state,'native_remove_01','remove_task',{id:'some-task',expectedVersion:1},1002),{ok:false,code:'forbidden'})
  assert.deepEqual(reserveIntentCall(state,'native_status_01','get_operation_status',{operationKey:'unowned_operation_key_01'},1002),{ok:false,code:'forbidden'})
})

test('unknown write outcomes/interruption cannot fall back or start a fresh model plan; only bound receipts can resolve',()=>{
  const reserved=accepted(reserveIntentCall(active(),'native_write_01','create_task',{title:'Synthetic item',date:'2026-11-01',expectedVersion:0},1002))
  const pending=clone(reserved.record)
  assert.equal(accepted(startIntent(pending,1003)).directive,'receipts_only')
  assert.equal(accepted(reserveIntentCall(pending,'native_write_01','create_task',{title:'Synthetic item',date:'2026-11-01',expectedVersion:0},1003)).directive,'reconcile')
  assert.deepEqual(reserveIntentCall(pending,'another_write_01','create_task',{title:'Another item',date:'2026-11-01',expectedVersion:0},1003),{ok:false,code:'pending_operation'})
  const uncertain=accepted(recordIntentResult(pending,'native_write_01',{state:'uncertain',operationKey:String(reserved.command!.args.operationKey)})).record
  assert.equal(uncertain.phase,'uncertain')
  assert.deepEqual(reserveIntentCall(uncertain,'another_read_01','list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1004),{ok:false,code:'inactive'})
  const resolved=accepted(recordIntentResult(uncertain,'native_write_01',{state:'applied',id:String(reserved.command!.args.id),version:1})).record
  assert.equal(accepted(finishIntent(resolved)).record.outcome,'effects_recorded')
  assert.equal(interruptIntent(active()).phase,'uncertain')
})

test('limits and role checks are bound to the request, not reset by a retried admission',()=>{
  for(const purpose of ['parser','planner','extraction','read'] as const)assert.deepEqual(admitIntent(undefined,{...request,purpose},policy),{ok:false,code:'forbidden'})
  let record=accepted(startIntent(accepted(admitIntent(undefined,request,policy)).record,1000)).record
  for(let i=0;i<REQUEST_LIMITS.maxRounds;i++)record=accepted(beginIntentRound(record,1001+i)).record
  assert.deepEqual(beginIntentRound(record,1010),{ok:false,code:'budget_exhausted'})
  assert.equal(accepted(admitIntent(record,request,policy)).record.rounds,REQUEST_LIMITS.maxRounds)
  assert.deepEqual(reserveIntentCall(record,'late_read_01','list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1000+REQUEST_LIMITS.timeoutMs),{ok:false,code:'budget_exhausted'})
  let writes=active()
  for(let i=0;i<REQUEST_LIMITS.maxWrites;i++){
    const reserved=accepted(reserveIntentCall(writes,`write_${i}`,'create_task',{title:`Synthetic ${i}`,date:'2026-11-01',expectedVersion:i},1002+i))
    writes=accepted(recordIntentResult(reserved.record,`write_${i}`,{state:'applied',id:String(reserved.command!.args.id),version:i+1})).record
  }
  assert.deepEqual(reserveIntentCall(writes,'write_over_budget','create_task',{title:'Too many',date:'2026-11-01',expectedVersion:4},1010),{ok:false,code:'budget_exhausted'})
  let reads=active()
  for(let i=0;i<REQUEST_LIMITS.maxCalls;i++){
    const reserved=accepted(reserveIntentCall(reads,`read_${i}`,'list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1002))
    reads=accepted(recordIntentResult(reserved.record,`read_${i}`,{state:'ok',data:{items:[],nextOffset:null,collectionVersion:0}})).record
  }
  assert.deepEqual(reserveIntentCall(reads,'read_over_budget','list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:1},1003),{ok:false,code:'budget_exhausted'})
})

test('structural service-result checks preserve partial/no-effect outcomes; backend provenance is a caller responsibility',()=>{
  const reserved=accepted(reserveIntentCall(active(),'native_write_01','create_task',{title:'Synthetic item',date:'2026-11-01',expectedVersion:0},1002))
  assert.deepEqual(recordIntentResult(reserved.record,'native_write_01',{state:'applied',id:'wrong-id',version:1}),{ok:false,code:'invalid_result'})
  const applied=accepted(recordIntentResult(reserved.record,'native_write_01',{state:'applied',id:String(reserved.command!.args.id),version:1})).record
  const second=accepted(reserveIntentCall(applied,'second_write','set_task_completed',{id:String(reserved.command!.args.id),expectedVersion:1,completed:true},1003))
  const partial=accepted(recordIntentResult(second.record,'second_write',{state:'conflict',code:'revision_mismatch'})).record
  assert.equal(accepted(finishIntent(partial)).record.outcome,'partial')
  assert.equal(accepted(finishIntent(active())).record.outcome,'no_effects_recorded')
  assert.equal(accepted(finishIntent(reserved.record)).record.phase,'uncertain')
})
