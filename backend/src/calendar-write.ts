import ICAL from 'ical.js'
import {createHash} from 'node:crypto'
import type {Pool} from 'pg'
import type {CalendarConfig} from './caldav.js'
import {sourceHash,type Snapshot} from './sync.js'
export type EventChange={id:string;calendarId?:string;eventId?:string;etag?:string;recurrenceId?:string|null;uid?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
export function buildEventResource(change:EventChange,original?:string) {
 const root=original?new ICAL.Component(ICAL.parse(original)):new ICAL.Component('vcalendar')
 if(!original){root.addPropertyWithValue('version','2.0');root.addPropertyWithValue('prodid','-//Daymark//Calendar//EN')}
 let event=root.getAllSubcomponents('vevent').find(e=>!e.hasProperty('recurrence-id'))
 if(!event){event=new ICAL.Component('vevent');root.addSubcomponent(event);event.addPropertyWithValue('uid',change.id+'@daymark')}
 if(change.recurrenceId){
  const master=event
  const rid=ICAL.Time.fromString(change.recurrenceId,undefined)
  event=root.getAllSubcomponents('vevent').find(e=>(e.getFirstPropertyValue('recurrence-id') as ICAL.Time | null)?.compare(rid)===0)
  if(!event){event=new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())));for(const key of ['rrule','rdate','exdate'])event.removeAllProperties(key);event.addPropertyWithValue('recurrence-id',rid);root.addSubcomponent(event)}
 }
 const time=(value:string)=>ICAL.Time.fromString(change.allDay?value:new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z'),undefined)
 event.removeAllProperties('dtstart');event.removeAllProperties('dtend');
 event.updatePropertyWithValue('dtstart',time(change.start));event.updatePropertyWithValue('dtend',time(change.end))
 event.removeAllProperties('duration')
 for(const [key,value] of Object.entries({summary:change.title,description:change.description,location:change.location,'x-daymark-mutation':change.id}))event.updatePropertyWithValue(key,value)
 event.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true))
 event.updatePropertyWithValue('sequence',Number(event.getFirstPropertyValue('sequence')??0)+1)
 return root.toString()
}
export async function applyChange(pool:Pool,config:CalendarConfig,change:EventChange) {
 const connection=await pool.connect()
 try {
  await connection.query('SELECT pg_advisory_lock(817332)')
  const fingerprint=createHash('sha256').update(JSON.stringify(change)).digest('hex')
  const previous=(await connection.query('SELECT * FROM calendar_mutations WHERE id=$1',[change.id])).rows[0]
  if(previous && previous.payload_hash!==fingerprint)return {code:409,error:'Mutation ID already used'}
  if(previous?.result)return {code:200,...previous.result}
  const state=(await connection.query('SELECT snapshot,source_hash FROM calendar_sync_state WHERE id=1')).rows[0]
  if(state.source_hash!==sourceHash(config))return {code:503,error:'Wait for calendar sync'}
  const snapshot:Snapshot=state.snapshot
  const calendar=snapshot.calendars.find(c=>c.id===change.calendarId)
  if(!calendar)return {code:400,error:'Unknown calendar'}
  const occurrence=change.eventId?snapshot.events.find(e=>e.id===change.eventId&&e.calendarId===calendar.id):undefined
  if(change.eventId&&!occurrence)return {code:409,error:'Event is no longer in cache. Refresh before editing.'}
  const resource=occurrence?.resource??new URL(change.id+'.ics',calendar.url.endsWith('/')?calendar.url:calendar.url+'/').href
  if(new URL(resource).origin!==new URL(config.url).origin)return {code:400,error:'Invalid event source'}
  const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')}
  const get=await fetch(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
  if(!get.ok && get.status!==404)return {code:502,error:'Nextcloud read failed'}
  const raw=get.ok?await get.text():undefined
  const original=raw?new ICAL.Component(ICAL.parse(raw)):undefined
  const alreadyApplied=original?.getAllSubcomponents('vevent').some(e=>e.getFirstPropertyValue('x-daymark-mutation')===change.id)
  if(!alreadyApplied){
   if(occurrence && (!raw||!change.etag||get.headers.get('etag')!==change.etag))return {code:409,error:'Event changed in Nextcloud. Refresh and review before retrying.'}
   if(!occurrence&&get.ok)return {code:409,error:'Event resource already exists'}
   await connection.query('INSERT INTO calendar_mutations(id,payload_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[change.id,fingerprint])
   const recurring=original?.getAllSubcomponents('vevent').some(e=>e.hasProperty('rrule')||e.hasProperty('rdate'))
   const recurrenceId=occurrence?(occurrence.recurrenceId??(recurring?occurrence.start:null)):null
   const data=buildEventResource({...change,recurrenceId},raw)
   const put=await fetch(resource,{method:'PUT',headers:{...headers,'Content-Type':'text/calendar; charset=utf-8',...(occurrence?{'If-Match':change.etag!}:{'If-None-Match':'*'})},body:data,redirect:'error',signal:AbortSignal.timeout(30000)})
   if(put.status===412)return {code:409,error:'Event changed during save. Refresh and review.'}
   if(!put.ok)return {code:502,error:'Nextcloud rejected the change'}
   const verify=await fetch(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
   if(!verify.ok)return {code:502,error:'Save verification pending; retry safely'}
   const saved=new ICAL.Component(ICAL.parse(await verify.text()))
   if(!saved.getAllSubcomponents('vevent').some(e=>e.getFirstPropertyValue('x-daymark-mutation')===change.id))return {code:502,error:'Save verification failed'}
  }
  const result={saved:true}
  await connection.query('INSERT INTO calendar_mutations(id,payload_hash,result) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET result=$3',[change.id,fingerprint,JSON.stringify(result)])
  await connection.query('UPDATE calendar_sync_state SET next_run=now() WHERE id=1')
  return {code:200,...result}
 } finally {await connection.query('SELECT pg_advisory_unlock(817332)');connection.release()}
}
