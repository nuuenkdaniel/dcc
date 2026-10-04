import {test} from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {buildEventResource,type EventChange} from '../src/calendar-write.js'
test('delete cancels only selected occurrence and preserves recurrence master',()=>{
 const change:EventChange={id:'synthetic',title:'Weekly',start:'2026-10-04T13:00:00Z',end:'2026-10-04T14:00:00Z',allDay:false,description:'',location:''}
 const root=new ICAL.Component(ICAL.parse(buildEventResource(change)));root.getFirstSubcomponent('vevent')!.addPropertyWithValue('rrule',ICAL.Recur.fromString('FREQ=WEEKLY'))
 const result=new ICAL.Component(ICAL.parse(buildEventResource({...change,operation:'delete',recurrenceId:'2026-10-11T13:00:00Z'},root.toString())))
 const events=result.getAllSubcomponents('vevent');assert.equal(events.length,2);assert.equal(events.find(e=>e.hasProperty('recurrence-id'))!.getFirstPropertyValue('status'),'CANCELLED');assert.equal(events.find(e=>!e.hasProperty('recurrence-id'))!.hasProperty('status'),false)
})
