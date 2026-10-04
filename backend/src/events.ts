import ICAL from 'ical.js'
import {createHash} from 'node:crypto'
export type EventOccurrence={id:string;calendarId:string;resource:string;etag:string;uid:string;recurrenceId:string|null;title:string;description:string;location:string;start:string;end:string;allDay:boolean}
export function parseExpandedEvents(ics:string,calendarId:string,resource:string,etag:string):EventOccurrence[] {
 const root=new ICAL.Component(ICAL.parse(ics))
 for(const zone of root.getAllSubcomponents('vtimezone')) {
  const tzid=String(zone.getFirstPropertyValue('tzid'))
  ICAL.TimezoneService.register(new ICAL.Timezone({component:zone,tzid}),tzid)
 }
 return root.getAllSubcomponents('vevent').filter(c=>c.getFirstPropertyValue('status')!=='CANCELLED').map(c=>{
  if(c.hasProperty('rrule')) throw new Error('Server did not expand recurrence')
  const event=new ICAL.Event(c)
  const time=(value:ICAL.Time)=>value.isDate?value.toString():value.zone===ICAL.Timezone.localTimezone?value.toString():value.toJSDate().toISOString()
  const recurrence=c.getFirstPropertyValue('recurrence-id')?.toString()??null
  return {id:createHash('sha256').update(calendarId+'\0'+event.uid+'\0'+(recurrence??event.startDate.toString())).digest('hex'),calendarId,resource,etag,uid:event.uid,recurrenceId:recurrence,title:event.summary??'',description:event.description??'',location:event.location??'',start:time(event.startDate),end:time(event.endDate),allDay:event.startDate.isDate}
 })
}
