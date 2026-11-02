import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createNonRecurringCalendarWriter} from '../../src/calendar-write.js'
import {parseExpandedEvents} from '../../src/events.js'
import {Dispatcher,type Context} from '../../src/mcp/dispatcher.js'
import {ServiceTransport,RECEIPT_KIND} from '../../src/mcp/service-transport.js'
import {CalendarHarness,config,mutation} from './calendar-harness.js'

const context:Context={purpose:'action',capabilities:['calendars:write','calendars:read','operations:read']}
const create={operationKey:'guarded_service_create_01',id:mutation,calendarId:'Calendar_A',scope:'single',title:'Synthetic guarded event',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',allDay:false}
const receipts=(h:CalendarHarness)=>[...h.rows.values()].filter(row=>row.kind===RECEIPT_KIND)
const service=(h:CalendarHarness,actorId='actor-A')=>new Dispatcher(new ServiceTransport({pool:h.pool,actorId,calendarSnapshot:async()=>h.snapshot,guardedCalendarWriter:createNonRecurringCalendarWriter(h.pool,config,h.fetch)}))

test('guarded service create/update/cancel complete durable receipts as saved, not fake snapshot applied',async()=>{
  for(const operation of ['create','update','cancel']){
    const h=new CalendarHarness(),dispatcher=service(h)
    if(operation!=='create')h.seedEvent()
    const selector={operationKey:`guarded_service_${operation}_01`,calendarId:'Calendar_A',eventId:'snapshot-event-id',scope:'single',expectedEtag:'"original"'}
    const args=operation==='create'?create:operation==='update'?{...selector,title:'Synthetic edit',start:'2026-11-01T14:00:00Z',end:'2026-11-01T15:00:00Z',allDay:false}:selector
    const tool=operation==='create'?'create_calendar_event':operation==='update'?'update_calendar_event':'cancel_calendar_event'
    const result=await dispatcher.dispatch(tool,args,context)
    assert.equal(result.state,'saved')
    if(result.state!=='saved')throw Error('Expected saved completion')
    assert.equal(result.confirmation,'snapshot_pending')
    assert.equal(result.readback,'verified')
    assert.equal(result.providerEtag,'"provider-1"')
    assert.equal(Object.hasOwn(result,'id'),false)
    assert.equal(Object.hasOwn(result,'eventId'),false)
    assert.equal(Object.hasOwn(result,'etag'),false)
    assert.equal(receipts(h)[0]?.data.state,'saved')
    assert.equal(h.puts,1)
    assert.deepEqual(await service(h).dispatch(tool,args,context),result)
    assert.equal(h.puts,1)
    const fetches=h.fetches.length
    const status=await new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'actor-A'})).dispatch('get_operation_status',{operationKey:args.operationKey},context)
    assert.deepEqual(status,{state:'ok',data:{operationKey:args.operationKey,status:'saved',result}})
    assert.equal(h.fetches.length,fetches)
    if(operation==='create'){
      const [resource,value]=[...h.resources.entries()][0]!
      const refreshed=parseExpandedEvents(value.body,'Calendar_A',resource,value.etag)
      assert.notEqual(refreshed[0]?.id,result.mutationId,'real cache identity is not the submitted mutation UUID')
      assert.equal(h.snapshot.events.length,0,'writer does not pretend a snapshot refresh happened')
    }
  }
})

test('lost provider response resumes exact stored JSON across JSONB reorder/restart, never duplicates PUT',async()=>{
  const h=new CalendarHarness();h.losePutResponse=true
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  const receipt=receipts(h)[0]!,serialized=receipt.data.writerPayloadJson as string
  const byteHash=createHash('sha256').update(serialized).digest('hex')
  assert.equal(h.ledger.get(create.id)?.payload_hash,byteHash)
  // Simulate JSONB object-key reorder without altering strings containing JSON.
  const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value
  receipt.data=reorder(receipt.data)
  const restarted=new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'actor-A',calendarSnapshot:async()=>{throw Error('Synthetic cache unavailable')},guardedCalendarWriter:createNonRecurringCalendarWriter(h.pool,config,h.fetch)}))
  const result=await restarted.dispatch('create_calendar_event',Object.fromEntries(Object.entries(create).reverse()),context)
  assert.equal(result.state,'saved')
  assert.equal(h.puts,1)
  assert.equal(receipts(h)[0]?.data.writerPayloadJson,serialized)
  const requests=h.fetches.length
  assert.deepEqual(await restarted.dispatch('create_calendar_event',{...create,title:'Changed payload'},context),{state:'conflict',code:'operation_key_mismatch'})
  assert.equal(h.fetches.length,requests)
  assert.deepEqual(await service(h,'actor-B').dispatch('get_operation_status',{operationKey:create.operationKey},context),{state:'ok',data:{operationKey:create.operationKey,status:'unknown'}})
})

test('lost service response after writer completion resolves via DB-only status, including failed MCP completion transaction',async()=>{
  for(const fault of ['lost-response','receipt-update','zero-row']){
    const h=new CalendarHarness(),writer=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
    const dispatcher=new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'actor-A',calendarSnapshot:async()=>h.snapshot,guardedCalendarWriter:{...writer,write:async payload=>{
      const result=await writer.write(payload)
      if(fault==='lost-response')throw Error('Synthetic lost service reply')
      if(fault==='zero-row')h.zero='receipt-update';else h.fail='receipt-update'
      return result
    }}}))
    assert.deepEqual(await dispatcher.dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
    assert.equal(receipts(h)[0]?.data.state,'uncertain')
    const requests=h.fetches.length
    const status=await new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'actor-A'})).dispatch('get_operation_status',{operationKey:create.operationKey},context)
    assert.equal(status.state,'ok')
    if(status.state==='ok')assert.equal((status.data as {status:string}).status,'saved')
    assert.equal(receipts(h)[0]?.data.state,'saved')
    assert.equal(h.fetches.length,requests,'status uses only the immutable mutation ledger, not provider/cache reads')
    assert.equal(h.puts,1)
    assert.equal(h.connections,0)
  }
})

test('committed but never dispatched MCP reservation has a safe same-key recovery path',async()=>{
  const h=new CalendarHarness();h.fail='commit-after'
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.equal(h.puts,0)
  assert.equal(h.ledger.size,0)
  assert.equal(receipts(h)[0]?.data.state,'uncertain')
  assert.equal((await service(h).dispatch('create_calendar_event',create,context)).state,'saved')
  assert.equal(h.puts,1)
})

test('known saved with no new ETag/readback remains explicit saved-awaiting-confirmation across restart',async()=>{
  const h=new CalendarHarness();h.failVerify=true;h.omitEtags=true
  const result=await service(h).dispatch('create_calendar_event',create,context)
  assert.equal(result.state,'saved')
  if(result.state==='saved'){
    assert.equal(result.providerEtag,null)
    assert.equal(result.readback,'pending')
    assert.equal(result.confirmation,'snapshot_pending')
  }
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),result)
  assert.equal(h.puts,1)
})

test('live recurrence and ETag guards reject before PUT; ambiguous provider failures never become definitive rejection',async()=>{
  for(const evidence of ['RRULE:FREQ=WEEKLY','']){
    const h=new CalendarHarness();h.seedEvent(evidence)
    if(!evidence)h.resources.values().next().value!.etag='"external-edit"'
    const result=await service(h).dispatch('cancel_calendar_event',{operationKey:'guarded_service_cancel_01',calendarId:'Calendar_A',eventId:'snapshot-event-id',scope:'single',expectedEtag:'"original"'},context)
    assert.deepEqual(result,evidence?{state:'rejected',code:'unsupported_recurrence'}:{state:'conflict',code:'revision_mismatch'})
    assert.equal(h.puts,0)
  }
  const h=new CalendarHarness();h.failPut=true
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.equal(h.puts,1,'ambiguous attempted create with missing resource must not resurrect/recreate')
})

test('tampered stored payload or tool scope cannot dispatch a recovered mutation',async()=>{
  const h=new CalendarHarness();h.fail='commit-after'
  await service(h).dispatch('create_calendar_event',create,context)
  receipts(h)[0]!.data.writerPayloadJson=JSON.stringify({id:create.id,url:'https://not-allowed.invalid'})
  assert.deepEqual(await service(h).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.equal(h.puts,0)
  assert.equal(h.fetches.length,0)
})
