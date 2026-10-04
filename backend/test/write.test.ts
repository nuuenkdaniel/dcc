import {test} from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {buildEventResource} from '../src/calendar-write.js'
test('new event has stable UID and mutation marker; editing preserves unknown fields',()=>{
 const input={id:'12345678-1234-1234-1234-123456789abc',title:'Test',start:'2026-10-04T10:00:00.000Z',end:'2026-10-04T11:00:00.000Z',allDay:false,description:'Notes',location:'Office'}
 const created=buildEventResource(input)
 const root=new ICAL.Component(ICAL.parse(created));const event=root.getFirstSubcomponent('vevent')!
 assert.equal(event.getFirstPropertyValue('uid'),input.id+'@daymark')
 event.addPropertyWithValue('x-custom-field','preserved')
 const edited=buildEventResource({...input,title:'Updated'},root.toString())
 const next=new ICAL.Component(ICAL.parse(edited)).getFirstSubcomponent('vevent')!
 assert.equal(next.getFirstPropertyValue('summary'),'Updated')
 assert.equal(next.getFirstPropertyValue('x-custom-field'),'preserved')
 assert.equal(next.getFirstPropertyValue('x-daymark-mutation'),input.id)
})

test('editing one recurring occurrence preserves master and another exception',()=>{
 const original=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:series','DTSTART:20261004T100000Z','DTEND:20261004T110000Z','RRULE:FREQ=DAILY;COUNT=3','SUMMARY:Original','END:VEVENT','BEGIN:VEVENT','UID:series','RECURRENCE-ID:20261006T100000Z','DTSTART:20261006T120000Z','DTEND:20261006T130000Z','SUMMARY:Other exception','END:VEVENT','END:VCALENDAR'].join('\r\n')
 const result=buildEventResource({id:'change',title:'Edited occurrence',start:'2026-10-05T14:00:00.000Z',end:'2026-10-05T15:00:00.000Z',allDay:false,description:'',location:'',recurrenceId:'2026-10-05T10:00:00Z'},original)
 const events=new ICAL.Component(ICAL.parse(result)).getAllSubcomponents('vevent')
 assert.equal(events.length,3)
 assert.equal(events[0]!.getFirstPropertyValue('summary'),'Original')
 assert.ok(events[0]!.hasProperty('rrule'))
 assert.equal(events[1]!.getFirstPropertyValue('summary'),'Other exception')
 assert.equal(events[2]!.getFirstPropertyValue('summary'),'Edited occurrence')
 assert.equal(events[2]!.hasProperty('rrule'),false)
})
