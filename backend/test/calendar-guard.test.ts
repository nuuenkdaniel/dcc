import {test} from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {applyChange,createNonRecurringCalendarWriter} from '../src/calendar-write.js'
import {CalendarHarness,change,config} from './mcp/calendar-harness.js'

test('trusted nonrecurring guard rejects all source recurrence evidence after GET and before PUT',async()=>{
  for(const evidence of ['RRULE:FREQ=WEEKLY','RDATE:20261108T100000Z','RECURRENCE-ID:20261101T100000Z','EXDATE:20261108T100000Z','EXRULE:FREQ=WEEKLY']){
    const h=new CalendarHarness(),edit=h.seedEvent(evidence)
    const result=await applyChange(h.pool,config,edit,{nonRecurringOnly:true,fetch:h.fetch})
    assert.equal(result.safeFailure,'unsupported_recurrence',evidence)
    assert.equal(h.fetches.filter(f=>f.method==='GET').length,1)
    assert.equal(h.puts,0)
    assert.equal(h.connections,0)
  }
})

test('ordinary browser writer still edits a selected recurring occurrence by default',async()=>{
  const h=new CalendarHarness(),edit=h.seedEvent('RRULE:FREQ=WEEKLY')
  assert.deepEqual(await applyChange(h.pool,config,edit,{fetch:h.fetch}),{code:200,saved:true})
  const resource=[...h.resources.values()][0]!
  const events=new ICAL.Component(ICAL.parse(resource.body)).getAllSubcomponents('vevent')
  assert.equal(events.length,2)
  assert.ok(events.some(event=>event.hasProperty('rrule')))
  assert.ok(events.some(event=>event.hasProperty('recurrence-id')))
})

test('ordinary Tell Hermes/browser create and replay keep the original response contract',async()=>{
  const h=new CalendarHarness()
  assert.deepEqual(await applyChange(h.pool,config,change,{fetch:h.fetch}),{code:200,saved:true})
  const calls=h.fetches.length
  assert.deepEqual(await applyChange(h.pool,config,change,{fetch:h.fetch}),{code:200,saved:true})
  assert.equal(h.fetches.length,calls)
  assert.deepEqual(await applyChange(h.pool,config,{...change,title:'Changed'},{fetch:h.fetch}),{code:409,error:'Mutation ID already used'})
})

test('guarded create/update/cancel report provider completion without inventing snapshot identity',async()=>{
  for(const operation of ['create','update','cancel']){
    const h=new CalendarHarness(),writer=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
    const input=operation==='create'?change:h.seedEvent()
    const command=operation==='cancel'?{...input,operation:'delete' as const}:input
    const result=await writer.write(command)
    assert.equal(result.saved,true)
    assert.equal(result.completion?.mutationId,command.id)
    assert.equal(result.completion?.snapshot,'pending')
    assert.equal(result.completion?.readback,'verified')
    assert.equal(result.completion?.providerEtag,'"provider-1"')
    assert.equal(Object.hasOwn(result.completion??{},'eventId'),false)
    assert.equal(h.puts,1)
    const put=h.fetches.find(f=>f.method==='PUT')!
    assert.equal(put.headers.get(operation==='create'?'if-none-match':'if-match'),operation==='create'?'*':'"original"')
    if(operation==='cancel')assert.match([...h.resources.values()][0]!.body,/STATUS:CANCELLED/)
    const requests=h.fetches.length
    assert.equal((await writer.reconcile(command)).saved,true)
    assert.equal(h.fetches.length,requests,'ledger reconciliation never reads a provider or unrelated cache')
    assert.equal((await writer.write(command)).saved,true)
    assert.equal(h.puts,1)
  }
})

test('lost PUT response reconciles immutable marker without duplicate write; changed payload cannot reuse key',async()=>{
  const h=new CalendarHarness(),writer=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
  h.losePutResponse=true
  assert.equal((await writer.write(change)).uncertain,true)
  assert.equal((await writer.reconcile(change)).uncertain,true)
  assert.equal((await writer.write(change)).saved,true)
  assert.equal(h.puts,1)
  assert.equal((await writer.write({...change,title:'Changed'})).safeFailure,'operation_key_mismatch')
  assert.equal(h.puts,1)
})

test('provider success with readback/ETag pending is saved, whereas ambiguous PUT failures remain uncertain',async()=>{
  const h=new CalendarHarness();h.failVerify=true;h.omitEtags=true
  const writer=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
  const result=await writer.write(change)
  assert.equal(result.saved,true)
  assert.equal(result.completion?.readback,'pending')
  assert.equal(result.completion?.providerEtag,null)
  assert.equal((await writer.reconcile(change)).saved,true)
  const failed=new CalendarHarness();failed.failPut=true
  assert.equal((await createNonRecurringCalendarWriter(failed.pool,config,failed.fetch).write(change)).uncertain,true)
  assert.equal(failed.ledger.get(change.id)?.result.saved,false)
})

test('prepared-but-never-dispatched ledger resumes; lost completion SQL resumes via marker',async()=>{
  for(const point of ['prepared','completion','prepared-zero','completion-zero']){
    const h=new CalendarHarness(),writer=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
    if(point==='prepared')h.failBeforePut=true
    else if(point==='completion')h.failCompletion=true
    else h.zeroLedgerUpdate=point==='prepared-zero'?'attempted':'saved'
    assert.equal((await writer.write(change)).uncertain,true)
    assert.equal(h.puts,point.startsWith('prepared')?0:1)
    assert.equal((await writer.write(change)).saved,true)
    assert.equal(h.puts,1)
  }
})

test('concurrent same-ID guarded writers serialize and apply exactly one synthetic conditional PUT',async()=>{
  const h=new CalendarHarness(),a=createNonRecurringCalendarWriter(h.pool,config,h.fetch),b=createNonRecurringCalendarWriter(h.pool,config,h.fetch)
  const results=await Promise.all([a.write(change),b.write(change)])
  assert.ok(results.every(result=>result.saved===true))
  assert.equal(h.puts,1)
  assert.equal(h.appliedPuts,1)
  assert.equal(h.connections,0)
})

test('source can become recurring after GET, but changed strong ETag prevents guarded PUT from applying',async()=>{
  const h=new CalendarHarness(),edit=h.seedEvent()
  const request:typeof fetch=async(input,init)=>{
    if(init?.method==='PUT'){
      const resource=h.resources.get(String(input))!
      resource.body=resource.body.replace('END:VEVENT','RRULE:FREQ=WEEKLY\r\nEND:VEVENT')
      resource.etag='"external-recurring-edit"'
    }
    return h.fetch(input,init)
  }
  assert.equal((await createNonRecurringCalendarWriter(h.pool,config,request).write(edit)).uncertain,true)
  assert.equal(h.appliedPuts,0)
  assert.match([...h.resources.values()][0]!.body,/RRULE:FREQ=WEEKLY/)
})
