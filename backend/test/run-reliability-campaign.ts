// Explicit finite synthetic source runner. NO startup/env loader, real Pool,
// listener, model/provider invocation or external fallback is imported.
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {TOOLS,ACTIVE_TOOLS,type ToolName} from '../src/mcp/contracts.js'
import {Dispatcher} from '../src/mcp/dispatcher.js'
import {validateServiceArguments} from '../src/mcp/service-contracts.js'
import {ServiceTransport} from '../src/mcp/service-transport.js'
import {ProductPool,projectId,preparationId} from './mcp/product-pool.js'
import {createScopedCalendarWriter} from '../src/calendar-write.js'
import {config} from './mcp/calendar-harness.js'
import {admitIntent,startIntent,beginIntentRound,reserveIntentCall,recordIntentResult} from '../src/mcp/request-intent.js'
import {runTimerCampaign} from '../../frontend/src/timerCampaign.js'
import {CLARIFICATION_QUESTIONS,clarification} from '../src/mcp/clarification.js'

export async function runSourceCampaign(seed:number){
  if(![20261105,20261106].includes(seed))throw Error('unapproved_seed')
  const observations:{scenario:string;evidence:string;assertions:number}[]=[]
  let stage='catalog-refusal'
  try{
  for(const name of ACTIVE_TOOLS){
    stage=`TOOL.${name}.refusal`
    assert.deepEqual(await new Dispatcher().dispatch(name,{}, {purpose:'action',capabilities:[]}),{state:'rejected',code:'forbidden'})
    assert.equal(validateServiceArguments(name,{shell:'forbidden'}).valid,false)
    observations.push({scenario:`TOOL.${name}.refusal`,evidence:'executed-capability-and-unknown-field-guards',assertions:2})
  }
  stage='timer-replay-compaction';const timer=runTimerCampaign(seed)
  observations.push({scenario:'WF02/WF27/WF37/WF38',evidence:timer.evidence,assertions:timer.assertions})
  stage='intent-idempotency';const policy={executor:'mcp-action-v1' as const,allowedTools:ACTIVE_TOOLS}
  const admission={actorId:'synthetic-campaign',purpose:'action' as const,key:`synthetic_campaign_${seed}`,prompt:'Synthetic bounded task'}
  const admitted=admitIntent(undefined,admission,policy);assert.ok(admitted.ok)
  const started=startIntent(admitted.record,1000);assert.ok(started.ok)
  const round=beginIntentRound(started.record,1000);assert.ok(round.ok)
  const args={title:'Synthetic task',date:'2026-11-02',expectedVersion:0}
  const call=reserveIntentCall(round.record,'same-call','create_task',args,1001);assert.ok(call.ok&&call.command)
  const recorded=recordIntentResult(call.record,'same-call',{state:'applied',id:String(call.command.args.id),version:1});assert.ok(recorded.ok)
  const repeat=reserveIntentCall(recorded.record,'same-call','create_task',args,1002);assert.ok(repeat.ok&&repeat.directive==='replay')
  assert.equal(admitIntent(recorded.record,{...admission,prompt:'Changed prompt'},policy).ok,false)
  assert.equal(reserveIntentCall(recorded.record,'late-call','create_task',args,130000).ok,false)
  observations.push({scenario:'WF16/WF17/WF25',evidence:'executed-pure-intent-key-replay-prompt-and-expiry-fences',assertions:8})
  stage='service-task-readback';const db=new ProductPool(),dispatcher=new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'synthetic-campaign',calendarSnapshot:async()=>db.snapshot,guardedCalendarWriter:createScopedCalendarWriter(db.pool,config,db.fetch)}))
  const context={purpose:'action' as const,capabilities:[...new Set(ACTIVE_TOOLS.map(name=>TOOLS[name].capability))]}
  stage='clarification-readback'
  for(const reason of Object.keys(CLARIFICATION_QUESTIONS) as (keyof typeof CLARIFICATION_QUESTIONS)[])assert.deepEqual(await dispatcher.dispatch('request_clarification',{reason},context),{state:'ok',data:clarification(reason)})
  observations.push({scenario:'TOOL.request_clarification.readback',evidence:'executed-exact-allowlisted-questions-no-domain-effects',assertions:8})
  stage='service-task-readback'
  const suffix=String(seed),taskId='seeded_'+suffix
  const create={id:taskId,operationKey:'campaign_create_'+suffix,title:'Synthetic homework',date:'2026-11-02',expectedVersion:0}
  assert.equal((await dispatcher.dispatch('create_task',create,context)).state,'applied')
  assert.equal((await dispatcher.dispatch('create_task',create,context)).state,'applied')
  assert.equal((await dispatcher.dispatch('set_task_completed',{id:taskId,operationKey:'campaign_done_'+suffix,expectedVersion:1,completed:true},context)).state,'applied')
  const tasks=await dispatcher.dispatch('list_tasks',{from:'2026-11-01',to:'2026-11-04',limit:100},context)
  assert.equal(tasks.state,'ok');if(tasks.state!=='ok')throw Error('task_readback_failed')
  assert.ok((tasks.data as {items:{id:string;completed:boolean}[]}).items.some(t=>t.id===taskId&&t.completed))
  assert.equal(db.rows.get(projectId)!.data.status,'active')
  observations.push({scenario:'TOOL.create_task.readback/TOOL.set_task_completed.readback',evidence:'executed-service-query-fake-readback-and-parent-invariant',assertions:6})
  stage='service-project-readback';assert.equal((await dispatcher.dispatch('archive_project',{id:projectId,operationKey:'campaign_archive_'+suffix,expectedVersion:1},context)).state,'applied')
  assert.equal(db.rows.get(projectId)!.data.status,'archived')
  assert.equal((await dispatcher.dispatch('restore_project',{id:projectId,operationKey:'campaign_restore_'+suffix,expectedVersion:2},context)).state,'applied')
  assert.equal(db.rows.get(projectId)!.data.status,'active')
  observations.push({scenario:'WF32',evidence:'executed-service-query-fake-archive-restore-readback',assertions:4})
  stage='service-preparation-readback';const before=structuredClone(db.rows.get(preparationId)!.data.topics)
  assert.equal((await dispatcher.dispatch('insert_preparation_topic',{id:preparationId,expectedVersion:1,title:'Synthetic practice',notes:'',minutes:30,operationKey:'campaign_topic_'+suffix},context)).state,'applied')
  assert.deepEqual(db.rows.get(preparationId)!.data.topics[0],before[0])
  const inserted=db.rows.get(preparationId)!.data.topics[1].id
  assert.equal((await dispatcher.dispatch('remove_preparation_topic',{id:preparationId,expectedVersion:2,topicId:inserted,operationKey:'campaign_remove_'+suffix},context)).state,'applied')
  assert.deepEqual(db.rows.get(preparationId)!.data.topics,before)
  observations.push({scenario:'WF31',evidence:'executed-service-query-fake-topic-identity-readback',assertions:4})
  for(const [tool,args] of [['search_inbox',{query:'Synthetic',account:'all',importantOnly:false,limit:1}],['get_calendar_series',{calendarId:'Calendar_A',eventId:'snapshot-event-id'}]] as const){
    stage=`TOOL.${tool}.readback`
    assert.equal((await dispatcher.dispatch(tool,args,context)).state,'ok')
    observations.push({scenario:`TOOL.${tool}.readback`,evidence:'executed-query-fake-safe-projection',assertions:1})
  }
  return {seed,status:'source-campaign-pass',evidence:'synthetic-source-only',timer,observations,coverage:observations.map(o=>({scenarioIds:o.scenario.split('/'),scope:'partial-source-seam',evidence:o.evidence,assertions:o.assertions})),pendingInventoryCases:265,notProven:['real PostgreSQL','authenticated HTTP/TLS callback','rendered browser','production run_action model','real CalDAV','complete matrix campaign']}
  }catch{throw Object.assign(new Error('source_campaign_failed'),{stage,completedObservations:observations.length})}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const seed=Number(process.argv[2])
  runSourceCampaign(seed).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({seed,status:'source-campaign-failed',stage:error?.stage??'seed-validation',completedObservations:error?.completedObservations??0,code:'assertion_or_fixture_failure'}));process.exitCode=1})
}
