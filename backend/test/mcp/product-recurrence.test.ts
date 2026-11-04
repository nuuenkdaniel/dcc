import {test} from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {Dispatcher} from '../../src/mcp/dispatcher.js'
import {createScopedCalendarWriter,buildScopedEventResource} from '../../src/calendar-write.js'
import {CalendarHarness,config,change} from './calendar-harness.js'
import {ServicePool} from './service-pool.js'
import {validateServiceArguments} from '../../src/mcp/service-contracts.js'

const context={purpose:'action' as const,capabilities:['tasks:read','tasks:write','calendars:read','calendars:write']}
test('weekly templates create/edit/pause/resume and occurrence completion/skip retain source identity and unknown metadata',async()=>{
  const db=new ServicePool(),d=new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'synthetic'}))
  const create={id:'weekly',operationKey:'weekly_create_0001',title:'Weekly synthetic',date:'2026-11-06',expectedVersion:0,recurrenceFrequency:'weekly',recurrenceWeekday:5,recurrenceStartDate:'2026-11-06'}
  assert.equal((await d.dispatch('create_task',create,context)).state,'applied')
  for(const [key,paused,version] of [['weekly_pause_0001',true,1],['weekly_resume_0001',false,2]] as const){
    assert.equal((await d.dispatch('update_task',{id:'weekly',operationKey:key,expectedVersion:version,recurrencePaused:paused},context)).state,'applied')
  }
  const row=db.rows.get(COLLECTION)!
  row.data.tasks.push({id:'occ.weekly.2026-11-13',title:'Occurrence',date:'2026-11-13',notes:'',completed:false,custom:'keep',recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-11-13'}})
  assert.equal((await d.dispatch('set_task_completed',{id:'occ.weekly.2026-11-13',operationKey:'occ_complete_0001',expectedVersion:3,completed:true},context)).state,'applied')
  assert.equal((await d.dispatch('remove_task',{id:'occ.weekly.2026-11-13',operationKey:'occ_skip_00000001',expectedVersion:4},context)).state,'applied')
  const saved=db.rows.get(COLLECTION)!.data.tasks[1]
  assert.equal(saved.custom,'keep');assert.equal(saved.completed,true);assert.equal(saved.deleted,true)
  assert.deepEqual(saved.recurrence,{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-11-13'})
  assert.equal((await d.dispatch('update_task',{id:'weekly',operationKey:'weekly_stale_0001',expectedVersion:1,title:'Stale overwrite'},context)).state,'conflict')
})

test('scoped provider series create/readback and lost-response same-key recovery issue one conditional PUT',async()=>{
  const h=new CalendarHarness(),writer=createScopedCalendarWriter(h.pool,config,h.fetch)
  const input={...change,scope:'series' as const,rrule:'FREQ=WEEKLY;COUNT=8'}
  h.losePutResponse=true
  assert.equal((await writer.write(input)).uncertain,true)
  assert.equal((await writer.write(input)).saved,true)
  assert.equal(h.appliedPuts,1);assert.equal(h.puts,1)
  const raw=[...h.resources.values()][0].body
  assert.equal(new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent')!.getFirstPropertyValue('rrule')!.toString(),'FREQ=WEEKLY;COUNT=8')
  assert.equal((await writer.write({...input,rrule:'FREQ=DAILY;COUNT=2'})).safeFailure,'operation_key_mismatch')
})

test('single occurrence cancellation retains RRULE/RDATE/EXDATE and UID; series cancellation is explicit',async()=>{
  const h=new CalendarHarness(),selected=h.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4\r\nRDATE:20261102T100000Z\r\nEXDATE:20261108T100000Z')
  const input={...selected,scope:'single' as const,recurrenceId:'2026-11-01T10:00:00Z',uid:'original@daymark',operation:'delete' as const}
  const body=buildScopedEventResource(input,[...h.resources.values()][0].body)
  const root=new ICAL.Component(ICAL.parse(body)),events=root.getAllSubcomponents('vevent')
  assert.equal(events.length,2);assert.ok(events[0].hasProperty('rrule'));assert.ok(events[0].hasProperty('rdate'));assert.ok(events[0].hasProperty('exdate'))
  assert.equal(events[0].getFirstPropertyValue('status'),null)
  assert.equal(events[1].getFirstPropertyValue('status'),'CANCELLED')
  assert.equal(events[1].getFirstPropertyValue('uid'),'original@daymark')
  assert.throws(()=>buildScopedEventResource({...input,recurrenceId:undefined},[...h.resources.values()][0].body))
  const series=new ICAL.Component(ICAL.parse(buildScopedEventResource({...input,scope:'series',recurrenceId:undefined},body)))
  assert.ok(series.getAllSubcomponents('vevent').every(e=>e.getFirstPropertyValue('status')==='CANCELLED'))
})

test('scoped service calendar path rejects stale ETags and ambiguous occurrence selection before PUT',async()=>{
  const h=new CalendarHarness();h.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4')
  h.snapshot.events[0].recurrenceId='2026-11-01T10:00:00Z'
  const d=new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'synthetic',calendarSnapshot:async()=>h.snapshot,guardedCalendarWriter:createScopedCalendarWriter(h.pool,config,h.fetch)}))
  const base={operationKey:'scoped_cancel_0001',calendarId:'Calendar_A',eventId:'snapshot-event-id',expectedEtag:'"original"',scope:'single'}
  assert.equal((await d.dispatch('cancel_calendar_event',base,context)).state,'rejected')
  assert.equal((await d.dispatch('cancel_calendar_event',{...base,operationKey:'scoped_stale_0001',recurrenceId:'2026-11-01T10:00:00Z',expectedEtag:'"stale"'},context)).state,'conflict')
  assert.equal(h.puts,0)
})

test('all-day series creation retains date types and exclusive end dates',async()=>{
  const h=new CalendarHarness(),writer=createScopedCalendarWriter(h.pool,config,h.fetch)
  assert.equal((await writer.write({...change,scope:'series',rrule:'FREQ=DAILY;COUNT=3',allDay:true,start:'2026-11-02',end:'2026-11-03'})).saved,true)
  const event=new ICAL.Component(ICAL.parse([...h.resources.values()][0].body)).getFirstSubcomponent('vevent')!
  assert.equal((event.getFirstPropertyValue('dtstart') as ICAL.Time).isDate,true)
  assert.equal(event.getFirstPropertyValue('dtend')!.toString(),'2026-11-03')
})

test('existing timezone and DST rules survive a scoped occurrence edit without UTC-floating conversion',()=>{
  const raw=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VTIMEZONE','TZID:America/New_York',
    'BEGIN:STANDARD','DTSTART:19701101T020000','TZOFFSETFROM:-0400','TZOFFSETTO:-0500','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','END:STANDARD',
    'BEGIN:DAYLIGHT','DTSTART:19700308T020000','TZOFFSETFROM:-0500','TZOFFSETTO:-0400','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','END:DAYLIGHT',
    'END:VTIMEZONE','BEGIN:VEVENT','UID:zone-series','DTSTART;TZID=America/New_York:20261026T090000','DTEND;TZID=America/New_York:20261026T100000',
    'RRULE:FREQ=WEEKLY;COUNT=4','SEQUENCE:7','END:VEVENT','END:VCALENDAR'].join('\r\n')
  const edited=new ICAL.Component(ICAL.parse(buildScopedEventResource({...change,scope:'single',uid:'zone-series',recurrenceId:'2026-11-02T09:00:00',start:'2026-11-02T15:00:00Z',end:'2026-11-02T16:00:00Z'},raw)))
  assert.equal(edited.getAllSubcomponents('vtimezone').length,1)
  const events=edited.getAllSubcomponents('vevent'),exception=events[1]
  assert.equal(events[0].getFirstPropertyValue('rrule')!.toString(),'FREQ=WEEKLY;COUNT=4')
  assert.equal(exception.getFirstProperty('dtstart')!.getParameter('tzid'),'America/New_York')
  assert.equal(exception.getFirstPropertyValue('dtstart')!.toString(),'2026-11-02T10:00:00')
  assert.equal(exception.getFirstPropertyValue('recurrence-id')!.toString(),'2026-11-02T09:00:00')
  assert.equal(exception.getFirstPropertyValue('uid'),'zone-series');assert.equal(exception.getFirstPropertyValue('sequence'),8)
})

test('expanded first occurrence without RECURRENCE-ID still edits only its frozen selected instance',async()=>{
  const h=new CalendarHarness();h.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4')
  const d=new Dispatcher(new ServiceTransport({pool:h.pool,actorId:'synthetic',calendarSnapshot:async()=>h.snapshot,guardedCalendarWriter:createScopedCalendarWriter(h.pool,config,h.fetch)}))
  const result=await d.dispatch('update_calendar_event',{operationKey:'first_occurrence_01',calendarId:'Calendar_A',eventId:'snapshot-event-id',expectedEtag:'"original"',scope:'single',title:'Only first occurrence',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',allDay:false},context)
  assert.equal(result.state,'saved')
  const events=new ICAL.Component(ICAL.parse([...h.resources.values()][0].body)).getAllSubcomponents('vevent')
  assert.equal(events.length,2);assert.equal(events[0].getFirstPropertyValue('summary'),change.title)
  assert.equal(events[1].getFirstPropertyValue('summary'),'Only first occurrence')
  assert.equal(events[1].getFirstPropertyValue('recurrence-id')!.toString(),'2026-11-01T10:00:00Z')
  assert.equal(events[0].getFirstPropertyValue('rrule')!.toString(),'FREQ=WEEKLY;COUNT=4')
})

test('recurring DATE/date-time conversions reject both scopes/directions before PUT with exclusions and exceptions',async()=>{
  for(const allDay of [true,false])for(const scope of ['single','series'] as const){
    const h=new CalendarHarness(),selected=h.seedEvent(),resource=[...h.resources.keys()][0]!
    const property=(name:string,date:string,time:string)=>`${name}${allDay?';VALUE=DATE':''}:${allDay?date:time}`
    const raw=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:original@daymark',property('DTSTART','20261101','20261101T100000Z'),property('DTEND','20261102','20261101T110000Z'),'RRULE:FREQ=WEEKLY;COUNT=4',property('RDATE','20261103','20261103T100000Z'),property('EXDATE','20261108','20261108T100000Z'),'END:VEVENT','BEGIN:VEVENT','UID:original@daymark',property('RECURRENCE-ID','20261115','20261115T100000Z'),property('DTSTART','20261115','20261115T120000Z'),property('DTEND','20261116','20261115T130000Z'),'END:VEVENT','END:VCALENDAR'].join('\r\n')
    h.resources.set(resource,{body:raw,etag:'"original"'})
    const result=await createScopedCalendarWriter(h.pool,config,h.fetch).write({...selected,scope,allDay:!allDay,start:allDay?'2026-11-01T10:00:00Z':'2026-11-01',end:allDay?'2026-11-01T11:00:00Z':'2026-11-02',...(scope==='single'?{recurrenceId:allDay?'2026-11-01':'2026-11-01T10:00:00Z'}:{})})
    assert.equal(result.safeFailure,'unsupported_recurrence');assert.equal(h.puts,0);assert.equal(h.resources.get(resource)!.body,raw)
  }
})

const easternZone=['BEGIN:VTIMEZONE','TZID:America/New_York',
  'BEGIN:STANDARD','DTSTART:19701101T020000','TZOFFSETFROM:-0400','TZOFFSETTO:-0500','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','END:STANDARD',
  'BEGIN:DAYLIGHT','DTSTART:19700308T020000','TZOFFSETFROM:-0500','TZOFFSETTO:-0400','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','END:DAYLIGHT','END:VTIMEZONE'].join('\r\n')

test('existing exception DTSTART/DTEND zones survive independently from master recurrence identity',()=>{
  const raw=['BEGIN:VCALENDAR','VERSION:2.0',easternZone,'BEGIN:VEVENT','UID:original@daymark','DTSTART:20261026T140000Z','DTEND:20261026T150000Z','RRULE:FREQ=WEEKLY;COUNT=4','END:VEVENT',
    'BEGIN:VEVENT','UID:original@daymark','RECURRENCE-ID:20261102T140000Z','DTSTART;TZID=America/New_York:20261102T100000','DTEND:20261102T160000Z','END:VEVENT','END:VCALENDAR'].join('\r\n')
  const root=new ICAL.Component(ICAL.parse(buildScopedEventResource({...change,scope:'single',recurrenceId:'2026-11-02T14:00:00Z',start:'2026-11-02T16:00:00Z',end:'2026-11-02T17:00:00Z'},raw)))
  const exception=root.getAllSubcomponents('vevent')[1]!
  assert.equal(exception.getFirstProperty('dtstart')!.getParameter('tzid'),'America/New_York')
  assert.equal(exception.getFirstPropertyValue('dtstart')!.toString(),'2026-11-02T11:00:00')
  assert.equal(exception.getFirstProperty('dtend')!.getParameter('tzid'),undefined)
  assert.equal(exception.getFirstPropertyValue('dtend')!.toString(),'2026-11-02T17:00:00Z')
  assert.equal(exception.getFirstPropertyValue('recurrence-id')!.toString(),'2026-11-02T14:00:00Z')
})

test('named-zone creation copies trusted source VTIMEZONE and freezes it across prepared retries',async()=>{
  const h=new CalendarHarness();h.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4')
  const resource=[...h.resources.keys()][0]!,original=h.resources.get(resource)!
  original.body=original.body.replace('BEGIN:VEVENT',easternZone+'\r\nBEGIN:VEVENT')
  const input={...change,scope:'series' as const,rrule:'FREQ=WEEKLY;COUNT=4',timezone:'America/New_York',timezoneSourceEventId:'snapshot-event-id',start:'2026-11-02T14:00:00Z',end:'2026-11-02T15:00:00Z',rdates:['2026-11-04T14:00:00Z'],exdates:['2026-11-09T14:00:00Z']}
  const writer=createScopedCalendarWriter(h.pool,config,h.fetch)
  h.failBeforePut=true
  assert.equal((await writer.write(input)).uncertain,true);assert.equal(h.puts,0)
  assert.ok([...h.ledger.values()][0]!.result.timezoneDefinition.includes('America/New_York'))
  h.resources.delete(resource);h.snapshot.events=[]
  assert.equal((await writer.write(input)).saved,true);assert.equal(h.puts,1)
  const root=new ICAL.Component(ICAL.parse([...h.resources.values()][0]!.body)),master=root.getFirstSubcomponent('vevent')!
  assert.equal(root.getAllSubcomponents('vtimezone').length,1)
  assert.equal(master.getFirstProperty('dtstart')!.getParameter('tzid'),'America/New_York')
  assert.equal(master.getFirstPropertyValue('dtstart')!.toString(),'2026-11-02T09:00:00')
  assert.equal(master.getFirstProperty('rdate')!.getParameter('tzid'),'America/New_York')
  assert.equal((await writer.write(input)).saved,true);assert.equal(h.puts,1)
  assert.throws(()=>buildScopedEventResource(input))
})

test('typed recurrence lists replace explicitly; clearing rejects exceptions unless discard is explicit',async()=>{
  const h=new CalendarHarness(),selected=h.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4\r\nRDATE:20261103T100000Z\r\nEXDATE:20261108T100000Z')
  const resource=[...h.resources.keys()][0]!,source=h.resources.get(resource)!.body
  const historicalEditId='32345678-1234-4234-a234-123456789abc'
  // This is a historical edit, not the pending clear operation. Reusing
  // selected.id would trigger marker-without-ledger uncertainty before the guard.
  const withException=buildScopedEventResource({...selected,id:historicalEditId,scope:'single',recurrenceId:'2026-11-01T10:00:00Z'},source)
  const replace=new ICAL.Component(ICAL.parse(buildScopedEventResource({...selected,scope:'series',rdates:['2026-11-04T10:00:00Z'],exdates:[]},withException)))
  assert.equal(replace.getFirstSubcomponent('vevent')!.getFirstPropertyValue('rdate')!.toString(),'2026-11-04T10:00:00Z')
  assert.equal(replace.getFirstSubcomponent('vevent')!.hasProperty('exdate'),false)
  h.resources.set(resource,{body:withException,etag:'"original"'})
  const writer=createScopedCalendarWriter(h.pool,config,h.fetch)
  const guardedClear={...selected,scope:'series' as const,clearRecurrence:true as const}
  assert.equal(new ICAL.Component(ICAL.parse(withException)).getAllSubcomponents('vevent').filter(e=>e.hasProperty('recurrence-id')).length,1)
  assert.equal(h.ledger.size,0)
  // A provider marker alone must still fail closed, not assert receipt recovery.
  assert.equal((await writer.write({...guardedClear,id:historicalEditId})).uncertain,true)
  assert.equal(h.puts,0);assert.equal(h.ledger.size,0)
  for(let retry=0;retry<2;retry++){
    assert.equal((await writer.write(guardedClear)).safeFailure,'unsupported_recurrence')
    assert.equal(h.puts,0);assert.equal(h.appliedPuts,0)
    assert.deepEqual(h.resources.get(resource),{body:withException,etag:'"original"'})
    assert.equal(h.ledger.size,0)
  }
  const discard={...guardedClear,id:'22345678-1234-4234-a234-123456789abc',exceptionPolicy:'discard' as const}
  const saved=await writer.write(discard)
  assert.equal(saved.saved,true);assert.equal(h.puts,1)
  assert.deepEqual(await writer.write(discard),saved)
  assert.equal(h.puts,1);assert.equal(h.appliedPuts,1)
  const cleared=new ICAL.Component(ICAL.parse(h.resources.get(resource)!.body))
  assert.equal(cleared.getAllSubcomponents('vevent').length,1)
  for(const name of ['rrule','rdate','exdate'])assert.equal(cleared.getFirstSubcomponent('vevent')!.hasProperty(name),false)
  const args={id:change.id,operationKey:'typed_calendar_001',calendarId:'Calendar_A',scope:'series',title:'Series',start:change.start,end:change.end,allDay:false,rrule:'FREQ=WEEKLY;COUNT=4',rdates:['2026-11-04T10:00:00Z']}
  assert.equal(validateServiceArguments('create_calendar_event',args).valid,true)
  assert.equal(validateServiceArguments('create_calendar_event',{...args,rdates:['2026-11-04']}).valid,false)
  assert.equal(validateServiceArguments('create_calendar_event',{...args,rdates:['2026-11-04T10:00:00']}).valid,false)
  assert.equal(validateServiceArguments('create_calendar_event',{...args,scope:'single'}).valid,false)
})
