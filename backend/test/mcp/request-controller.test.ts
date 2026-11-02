import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {RequestController,summarizeIntent,type ModelRunner} from '../../src/mcp/request-controller.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {REQUEST_LIMITS} from '../../src/mcp/request-intent.js'
import {IntentPool} from './intent-pool.js'
import {ServicePool} from './service-pool.js'
import {CalendarHarness,config} from './calendar-harness.js'
import {createNonRecurringCalendarWriter} from '../../src/calendar-write.js'

const input={key:'controller_request_01',prompt:'Synthetic private text not for summary'}
const policy={executor:'mcp-action-v1' as const,allowedTools:['list_tasks','create_task','set_task_completed'] as const}
const args={title:'Synthetic confidential title',date:'2026-11-01',expectedVersion:0}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
function setup(runner:ModelRunner,now=()=>1000){
  const journal=new IntentPool(),effects=new ServicePool(),store=new SqlIntentStore(journal.pool,'actor-A'),transport=new ServiceTransport({pool:effects.pool,actorId:'actor-A'})
  return {journal,effects,store,transport,controller:new RequestController({store,transport,runner,now})}
}

test('host bounded runner uses official SDK/service reads and planned writes, ignoring model-final claims',async()=>{
  let rounds=0
  const h=setup(async request=>{
    rounds++
    const schema=request.tools.find(t=>t.name==='create_task')!.inputSchema
    assert.equal(Object.hasOwn(schema.properties??{},'operationKey'),false)
    assert.equal(Object.hasOwn(schema.properties??{},'id'),false)
    assert.equal(request.prompt,input.prompt)
    assert.equal(h.journal.connections,0);assert.equal(h.effects.connections,0)
    if(request.round===1)return {calls:[{id:'read1',tool:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:1}}],done:false}
    assert.equal(request.results[0].result.state,'ok')
    return {calls:[{id:'write1',tool:'create_task',arguments:args}],done:true,final:{state:'rejected',message:'untrusted model claims no work'}}
  })
  const summary=await h.controller.run(input,policy)
  assert.equal(rounds,2);assert.equal(summary.phase,'completed');assert.equal(summary.outcome,'effects_recorded')
  assert.equal(summary.effects[0].state,'applied')
  assert.equal(h.effects.rows.get(COLLECTION)!.data.tasks.length,1)
  const json=JSON.stringify(summary)
  for(const forbidden of [input.prompt,args.title,'ownerId','capabilities','operationKey','untrusted'])assert.equal(json.includes(forbidden),false)
  assert.deepEqual(await h.controller.run(input,policy),summary)
  assert.equal(rounds,2,'retry must not restart model')
})

test('model-final JSON alone cannot establish an effect; actor injection and unrelated tools never execute',async()=>{
  const h=setup(async()=>({calls:[],done:true,final:{state:'applied',id:'invented',version:99}}))
  assert.equal((await h.controller.run(input,policy)).outcome,'no_effects_recorded')
  assert.equal(h.effects.rows.size,0)
  for(const call of [
    {id:'injected',tool:'create_task',arguments:{...args,actorId:'actor-B'}},
    {id:'injected',tool:'create_task',arguments:{...args,operationKey:'model_selected_key_01'}},
    {id:'recurring',tool:'create_task',arguments:{...args,recurrence:{frequency:'weekly'}}},
    {id:'unscoped',tool:'remove_task',arguments:{id:'unrelated',expectedVersion:1}},
  ]){
    const bad=setup(async()=>({calls:[call],done:true}))
    const summary=await bad.controller.run(input,policy)
    assert.equal(summary.phase,'uncertain');assert.equal(bad.effects.rows.size,0)
  }
  assert.throws(()=>new RequestController({store:h.store,transport:new ServiceTransport({pool:h.effects.pool,actorId:'actor-B'}),runner:async()=>({calls:[],done:true})}),/actor_mismatch/)
})

test('partial receipts remain authoritative when a later validated write conflicts',async()=>{
  const h=setup(async r=>{
    if(r.round===1)return {calls:[{id:'create1',tool:'create_task',arguments:args}],done:false}
    const first=r.results[0].result
    assert.equal(first.state,'applied')
    if(first.state!=='applied')throw Error('Missing receipt')
    return {calls:[{id:'complete1',tool:'set_task_completed',arguments:{id:first.id,expectedVersion:99,completed:true}}],done:true}
  })
  const summary=await h.controller.run(input,policy)
  assert.equal(summary.outcome,'partial')
  assert.deepEqual(summary.effects.map(e=>e.state),['applied','conflict'])
  assert.equal(h.effects.rows.get(COLLECTION)!.data.tasks[0].completed,false)
})

test('cancel a noncooperative runner promptly, persist interruption and never restart it',async()=>{
  const entered=deferred(),release=deferred(),abort=new AbortController()
  let calls=0
  const h=setup(async()=>{calls++;entered.resolve();await release.promise;return {calls:[{id:'late',tool:'create_task',arguments:args}],done:true}})
  const running=h.controller.run(input,policy,abort.signal)
  await entered.promise;abort.abort()
  assert.equal((await running).phase,'uncertain')
  release.resolve()
  await h.controller.run(input,policy)
  assert.equal(calls,1);assert.equal(h.effects.rows.size,0)
})

test('deadline and round limits fence new work without throwing away committed effects',async()=>{
  let clock=1000
  const deadline=setup(async()=>{clock+=REQUEST_LIMITS.timeoutMs;return {calls:[{id:'late',tool:'create_task',arguments:args}],done:true}},()=>clock)
  assert.equal((await deadline.controller.run(input,policy)).phase,'uncertain')
  assert.equal(deadline.effects.rows.size,0)
  let rounds=0
  const bounded=setup(async()=>{rounds++;return {calls:[],done:false}})
  assert.equal((await bounded.controller.run(input,policy)).phase,'uncertain')
  assert.equal(rounds,REQUEST_LIMITS.maxRounds)
})

test('wall-clock deadline races a runner which ignores its cancellation signal',async()=>{
  let clockReads=0,runners=0
  const h=setup(async()=>{runners++;return new Promise(()=>{/* Deliberately never settles. */})},()=>clockReads++===0?1000:1000+REQUEST_LIMITS.timeoutMs-10)
  assert.equal((await h.controller.run(input,policy)).phase,'uncertain')
  assert.equal(runners,1);assert.equal(h.effects.rows.size,0)
})

test('unknown frozen operation is pending; receipts-only recovery never executes it',async()=>{
  let runners=0
  const h=setup(async()=>{runners++;return {calls:[],done:true}})
  await h.store.admit({...input,purpose:'action'},policy)
  const owner=(await h.store.start(input.key,1000)).owner!
  await h.store.round(input.key,owner,1000)
  await h.store.reserve(input.key,owner,'reserved1','create_task',args,1000)
  const summary=await h.controller.run(input,policy)
  assert.equal(summary.phase,'uncertain');assert.equal(summary.pending,1)
  assert.equal(runners,0);assert.equal(h.effects.rows.size,0)
})

test('concurrent controller retry fences the existing runner without creating another executor',async()=>{
  const entered=deferred(),release=deferred()
  let runners=0
  const h=setup(async()=>{runners++;entered.resolve();await release.promise;return {calls:[{id:'late1',tool:'create_task',arguments:args}],done:true}})
  const first=h.controller.run(input,policy)
  await entered.promise
  const retry=new RequestController({store:new SqlIntentStore(h.journal.pool,'actor-A'),transport:h.transport,runner:async()=>{throw Error('Must not start another model')},now:()=>1000})
  assert.equal((await retry.run(input,policy)).phase,'uncertain')
  release.resolve()
  assert.equal((await first).phase,'uncertain')
  assert.equal(runners,1);assert.equal(h.effects.rows.size,0)
})

test('reservation commit/row-count failure cannot reach service execution',async()=>{
  for(const fault of ['zero','commit-before','commit-after'] as const){
    const h=setup(async()=>{
      if(fault==='zero')h.journal.zero='entity-update'
      else h.journal.fail=fault
      return {calls:[{id:'write1',tool:'create_task',arguments:args}],done:true}
    })
    const summary=await h.controller.run(input,policy)
    assert.equal(summary.phase,'uncertain');assert.equal(h.effects.rows.size,0)
    if(fault==='commit-after')assert.equal(summary.pending,1,'durable reservation with lost ACK stays pending')
  }
})

test('service commit followed by intent-result persistence failure recovers DB receipt without replaying write',async()=>{
  let runners=0
  const h=setup(async()=>{runners++;return {calls:[{id:'write1',tool:'create_task',arguments:args}],done:true}})
  const execute=h.transport.execute.bind(h.transport)
  h.transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    h.journal.zero='entity-update' // Fail the next journal result UPDATE only.
    return result
  }
  const summary=await h.controller.run(input,policy)
  assert.equal(summary.effects[0].state,'applied');assert.equal(summary.pending,0)
  assert.equal(summary.phase,'uncertain','interrupted planning is not claimed fulfilled')
  assert.equal(h.effects.rows.get(COLLECTION)!.version,1)
  await h.controller.run(input,policy)
  assert.equal(runners,1);assert.equal(h.effects.rows.get(COLLECTION)!.version,1)
})

test('cancellation during a service call keeps its late authoritative receipt',async()=>{
  const entered=deferred(),release=deferred(),abort=new AbortController()
  const h=setup(async()=>({calls:[{id:'write1',tool:'create_task',arguments:args}],done:true}))
  const execute=h.transport.execute.bind(h.transport)
  h.transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    entered.resolve();await release.promise;return result
  }
  const running=h.controller.run(input,policy,abort.signal)
  await entered.promise;abort.abort()
  const summary=await running
  assert.equal(summary.effects[0].state,'applied','DB reconciliation sees the committed receipt')
  release.resolve()
  assert.equal((await h.controller.run(input,policy)).effects[0].state,'applied')
  assert.equal(h.effects.rows.get(COLLECTION)!.version,1)
})

test('safe saved calendar summary reports snapshot pending, never a fabricated snapshot event ID',async()=>{
  const h=setup(async()=>({calls:[],done:true}))
  const record=await h.store.admit({...input,purpose:'action'},policy)
  // Projection-only fixture; not a synthetic claim of provider execution.
  record.calls=[{id:'calendar1',fingerprint:'synthetic',command:{tool:'create_calendar_event',args:{}},result:{state:'saved',operationKey:'synthetic_operation_01',mutationId:'synthetic-mutation',confirmation:'snapshot_pending',readback:'pending',providerEtag:null}}]
  const summary=summarizeIntent(record)
  assert.deepEqual(summary.effects,[{tool:'create_calendar_event',state:'saved',confirmation:'snapshot_pending'}])
  assert.equal(JSON.stringify(summary).includes('mutation'),false)
})

test('SDK calendar action and DB-only recovery retain saved/snapshot-pending without new provider calls',async()=>{
  const journal=new IntentPool(),calendar=new CalendarHarness(),store=new SqlIntentStore(journal.pool,'actor-A')
  const transport=new ServiceTransport({pool:calendar.pool,actorId:'actor-A',calendarSnapshot:async()=>calendar.snapshot,guardedCalendarWriter:createNonRecurringCalendarWriter(calendar.pool,config,calendar.fetch)})
  let runners=0
  const controller=new RequestController({store,transport,now:()=>1000,runner:async()=>{
    runners++
    return {calls:[{id:'calendar1',tool:'create_calendar_event',arguments:{calendarId:'Calendar_A',scope:'single',title:'Synthetic calendar item',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false}}],done:true}
  }})
  const execute=transport.execute.bind(transport)
  transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    journal.zero='entity-update' // Lose journal result, not the durable service receipt.
    return result
  }
  const summary=await controller.run(input,{executor:'mcp-action-v1',allowedTools:['create_calendar_event']})
  assert.deepEqual(summary.effects,[{tool:'create_calendar_event',state:'saved',confirmation:'snapshot_pending'}])
  assert.equal(summary.pending,0);assert.equal(calendar.puts,1)
  const fetches=calendar.fetches.length
  await controller.run(input,{executor:'mcp-action-v1',allowedTools:['create_calendar_event']})
  assert.equal(calendar.fetches.length,fetches);assert.equal(runners,1)
})
