import ICAL from 'ical.js'
import {createHash} from 'node:crypto'
import type {Pool} from 'pg'
import type {CalendarConfig} from './caldav.js'
import {sourceHash,type Snapshot} from './sync.js'
import type {Result} from './mcp/contracts.js'
export type EventChange={operation?:'delete';id:string;calendarId?:string;eventId?:string;etag?:string;recurrenceId?:string|null;sourceOccurrenceStart?:string;scope?:'single'|'series';rrule?:string;timezone?:string;timezoneSourceEventId?:string;clearRecurrence?:true;exceptionPolicy?:'reject'|'discard';rdates?:string[];exdates?:string[];uid?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
export type CalendarCompletion={version:1;nonRecurringOnly:boolean;mutationId:string;payloadHash:string;snapshot:'pending';readback:'verified'|'pending';providerEtag:string|null}
export type CalendarWriteResult={code:number;error?:string;saved?:boolean;uncertain?:true;safeFailure?:'unsupported_recurrence'|'revision_mismatch'|'already_exists'|'not_found'|'operation_key_mismatch'|'cache_unavailable';completion?:CalendarCompletion}
// Trusted source-only options, never EventChange fields or runtime route schema.
export type CalendarWriteOptions={nonRecurringOnly?:true;fetch?:typeof fetch}
export type NonRecurringCalendarWriter={readonly mode:'nonrecurring-v1'|'scoped-v1';write:(change:EventChange)=>Promise<CalendarWriteResult>;reconcile:(change:EventChange)=>Promise<CalendarWriteResult>;readSeries?:(calendarId:string,eventId:string)=>Promise<Result>}
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
 if(change.operation==='delete')event.updatePropertyWithValue('status','CANCELLED')
 event.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true))
 event.updatePropertyWithValue('sequence',Number(event.getFirstPropertyValue('sequence')??0)+1)
 return root.toString()
}
export async function applyChange(pool:Pool,config:CalendarConfig,change:EventChange,options:CalendarWriteOptions={}):Promise<CalendarWriteResult> {
  if(options.nonRecurringOnly)return applyNonRecurringChange(pool,config,change,options.fetch??fetch)
  const request=options.fetch??fetch
 const connection=await pool.connect()
 try {
  await connection.query('SELECT pg_advisory_lock(817332)')
  const fingerprint=createHash('sha256').update(JSON.stringify(change)).digest('hex')
  const previous=(await connection.query('SELECT * FROM calendar_mutations WHERE id=$1',[change.id])).rows[0]
  if(previous && previous.payload_hash!==fingerprint)return {code:409,error:'Mutation ID already used'}
   if(previous?.result?.guardVersion===1&&!previous.result.saved)return {code:409,error:'This mutation requires the trusted nonrecurring writer'}
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
   const get=await request(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
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
    const put=await request(resource,{method:'PUT',headers:{...headers,'Content-Type':'text/calendar; charset=utf-8',...(occurrence?{'If-Match':change.etag!}:{'If-None-Match':'*'})},body:data,redirect:'error',signal:AbortSignal.timeout(30000)})
   if(put.status===412)return {code:409,error:'Event changed during save. Refresh and review.'}
   if(!put.ok)return {code:502,error:'Nextcloud rejected the change'}
    const verify=await request(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
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

const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
type MutationRow={id:string;payload_hash:string;result:unknown}
const uncertain=():CalendarWriteResult=>({code:202,uncertain:true})
function strongEtag(value:unknown):value is string {return typeof value==='string'&&/^"[\x21\x23-\x7e]{1,128}"$(?![\s\S])/.test(value)}
export function validCalendarCompletion(value:unknown):value is CalendarCompletion {
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const c=value as Record<string,unknown>
  return Object.keys(c).sort().join(',')==='mutationId,nonRecurringOnly,payloadHash,providerEtag,readback,snapshot,version'&&c.version===1&&typeof c.nonRecurringOnly==='boolean'&&typeof c.mutationId==='string'&&typeof c.payloadHash==='string'&&/^[a-f0-9]{64}$(?![\s\S])/.test(c.payloadHash)&&c.snapshot==='pending'&&(c.readback==='verified'||c.readback==='pending')&&(c.providerEtag===null||strongEtag(c.providerEtag))
}
function completed(result:unknown,change:EventChange,fingerprint:string):CalendarWriteResult|undefined {
  const r=result as {saved?:unknown;completion?:unknown}|null
  if(r?.saved!==true||!validCalendarCompletion(r.completion)||r.completion.mutationId!==change.id||r.completion.payloadHash!==fingerprint)return undefined
  // Explicit projection: never spread internal ledger data into a tool response.
  return {code:200,saved:true,completion:{...r.completion}}
}
// A narrow DB-only status query: never fetches a provider or unrelated snapshot.
export async function reconcileCalendarMutation(pool:Pool,change:EventChange):Promise<CalendarWriteResult> {
  try {
    const fingerprint=digest(JSON.stringify(change)),row=(await pool.query<MutationRow>('SELECT * FROM calendar_mutations WHERE id=$1',[change.id])).rows[0]
    if(row&&row.payload_hash!==fingerprint)return {code:409,safeFailure:'operation_key_mismatch'}
    return row?completed(row.result,change,fingerprint)??uncertain():uncertain()
  }catch{return uncertain()}
}
export function createNonRecurringCalendarWriter(pool:Pool,config:CalendarConfig,request:typeof fetch=fetch):NonRecurringCalendarWriter {
  return {mode:'nonrecurring-v1',write:change=>applyChange(pool,config,change,{nonRecurringOnly:true,fetch:request}),reconcile:change=>reconcileCalendarMutation(pool,change)}
}
export function createScopedCalendarWriter(pool:Pool,config:CalendarConfig,request:typeof fetch=fetch):NonRecurringCalendarWriter {
  return {mode:'scoped-v1',write:change=>applyNonRecurringChange(pool,config,change,request,true),reconcile:change=>reconcileCalendarMutation(pool,change),readSeries:(calendarId,eventId)=>readCalendarSeries(pool,config,calendarId,eventId,request)}
}

async function readCalendarSeries(pool:Pool,config:CalendarConfig,calendarId:string,eventId:string,request:typeof fetch):Promise<Result>{
  try{
    const state=(await pool.query('SELECT snapshot,source_hash FROM calendar_sync_state WHERE id=1')).rows[0]
    if(!state||state.source_hash!==sourceHash(config))return {state:'rejected',code:'cache_unavailable'}
    const snapshot=state.snapshot as Snapshot,selected=snapshot.events.find(e=>e.id===eventId&&e.calendarId===calendarId)
    if(!selected)return {state:'rejected',code:'not_found'}
    const resource=new URL(selected.resource)
    if(resource.origin!==new URL(config.url).origin||resource.username||resource.password)return {state:'rejected',code:'cache_unavailable'}
    const response=await request(resource.href,{headers:{Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')},redirect:'error',signal:AbortSignal.timeout(15000)})
    if(!response.ok||!strongEtag(response.headers.get('etag')))return {state:'rejected',code:'cache_unavailable'}
    const raw=await response.text()
    if(raw.length>2000000)return {state:'rejected',code:'operation_capacity'}
    const root=new ICAL.Component(ICAL.parse(raw))
    for(const component of root.getAllSubcomponents('vtimezone')){const tzid=String(component.getFirstPropertyValue('tzid'));ICAL.TimezoneService.register(new ICAL.Timezone({component,tzid}),tzid)}
    const masters=root.getAllSubcomponents('vevent').filter(e=>!e.hasProperty('recurrence-id'))
    if(masters.length!==1)return {state:'rejected',code:'cache_unavailable'}
    const master=masters[0]!,event=new ICAL.Event(master)
    if(event.uid!==selected.uid)return {state:'rejected',code:'cache_unavailable'}
    if(!event.startDate.isDate&&event.startDate.zone===ICAL.Timezone.localTimezone)return {state:'rejected',code:'cache_unavailable'}
    if(root.getAllSubcomponents('vevent').some(e=>e.getFirstPropertyValue('uid')!==event.uid))return {state:'rejected',code:'cache_unavailable'}
    const time=(t:ICAL.Time)=>t.isDate?t.toString():t.toJSDate().toISOString().replace('.000Z','Z')
    const values=(name:string)=>master.getAllProperties(name).flatMap(p=>p.getValues().map(v=>String(v)))
    return {state:'ok',data:{calendarId,eventId,etag:response.headers.get('etag'),uid:event.uid,title:event.summary??'',start:time(event.startDate),end:time(event.endDate),allDay:event.startDate.isDate,timezone:String(master.getFirstProperty('dtstart')?.getParameter('tzid')??(event.startDate.isDate?'date':'UTC')),rrule:master.getFirstPropertyValue('rrule')?.toString()??null,rdates:values('rdate'),exdates:values('exdate'),recurrenceIds:root.getAllSubcomponents('vevent').filter(e=>e.hasProperty('recurrence-id')).map(e=>String(e.getFirstPropertyValue('recurrence-id')))}}
  }catch{return {state:'rejected',code:'transport_failure'}}
}

// Only the guarded writer uses explicit scope. The ordinary browser writer above
// deliberately retains its existing occurrence-editing behavior.
export function buildScopedEventResource(change:EventChange,raw?:string,timezoneDefinition?:string):string {
  if(change.scope!=='single'&&change.scope!=='series')throw Error('Explicit scope required')
  const root=raw?new ICAL.Component(ICAL.parse(raw)):new ICAL.Component(ICAL.parse(buildEventResource(change)))
  if(change.timezone){
    if(raw||change.allDay||!timezoneDefinition)throw Error('Trusted creation timezone required')
    const zone=new ICAL.Component(ICAL.parse(timezoneDefinition))
    if(zone.name!=='vtimezone'||zone.getFirstPropertyValue('tzid')!==change.timezone)throw Error('Wrong timezone definition')
    root.addSubcomponent(zone)
  }
  for(const component of root.getAllSubcomponents('vtimezone')){
    const tzid=String(component.getFirstPropertyValue('tzid'))
    ICAL.TimezoneService.register(new ICAL.Timezone({component,tzid}),tzid)
  }
  const masters=root.getAllSubcomponents('vevent').filter(e=>!e.hasProperty('recurrence-id'))
  if(masters.length!==1)throw Error('Ambiguous calendar resource')
  const master=masters[0]!,start=master.getFirstPropertyValue('dtstart') as ICAL.Time
  if(!start||change.uid!==undefined&&master.getFirstPropertyValue('uid')!==change.uid)throw Error('Source identity mismatch')
  if(raw&&!start.isDate&&start.zone===ICAL.Timezone.localTimezone)throw Error('Floating source requires timezone clarification')
  if(root.getAllSubcomponents('vevent').some(e=>e.getFirstPropertyValue('uid')!==master.getFirstPropertyValue('uid')))throw Error('Mixed series identity')
  // Recurrence identities/exclusions are typed relative to the original master.
  // Converting only DTSTART/DTEND would silently invalidate those relationships.
  if(raw&&recurringSource(root)&&change.operation!=='delete'&&change.allDay!==start.isDate)throw Error('Recurring date type conversion is unsupported')
  if(change.scope!=='series'&&[change.rrule,change.rdates,change.exdates,change.clearRecurrence,change.exceptionPolicy].some(v=>v!==undefined))throw Error('Series mutation requires series scope')
  let event=master
  if(change.scope==='single'&&raw&&recurringSource(root)){
    const selector=change.recurrenceId??change.sourceOccurrenceStart
    if(!selector||change.rrule!==undefined)throw Error('Occurrence required')
    const rid=ICAL.Time.fromString(selector.replace(/\.000Z$/,'Z'),undefined)
    if(rid.isDate!==start.isDate)throw Error('Recurrence date type mismatch')
    if(!rid.isDate&&rid.zone!==ICAL.Timezone.utcTimezone)rid.zone=start.zone
    const localRid=rid.isDate?rid:rid.convertToZone(start.zone)
    event=root.getAllSubcomponents('vevent').find(e=>{
      const value=e.getFirstPropertyValue('recurrence-id') as ICAL.Time|null
      return !!value&&value.compare(localRid)===0
    })!
    if(!event){
      // Bound expansion before accepting an arbitrary exception target. RDATE and
      // EXDATE are interpreted by ICAL, never discarded or reconstructed.
      const expansion=new ICAL.RecurExpansion({component:master,dtstart:start})
      let found=false
      for(let i=0;i<10000;i++){
        const value=expansion.next()
        if(!value||value.compare(localRid)>0)break
        if(value.compare(localRid)===0){found=true;break}
      }
      if(!found)throw Error('Occurrence not in source')
      event=new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())))
      for(const field of ['rrule','rdate','exdate','exrule'])event.removeAllProperties(field)
      event.addPropertyWithValue('recurrence-id',localRid)
      if(!localRid.isDate&&start.zone!==ICAL.Timezone.utcTimezone&&start.zone!==ICAL.Timezone.localTimezone)event.getFirstProperty('recurrence-id')!.setParameter('tzid',start.zone.tzid)
      root.addSubcomponent(event)
    }
  }else if(change.recurrenceId)throw Error('Unexpected occurrence selector')
  if(change.clearRecurrence){
    if(change.rrule!==undefined||change.rdates!==undefined||change.exdates!==undefined)throw Error('Conflicting recurrence mutation')
    const exceptions=root.getAllSubcomponents('vevent').filter(e=>e.hasProperty('recurrence-id'))
    if(exceptions.length&&change.exceptionPolicy!=='discard')throw Error('Existing exceptions require explicit discard')
    for(const component of exceptions)root.removeSubcomponent(component)
    for(const name of ['rrule','rdate','exdate','exrule'])master.removeAllProperties(name)
  }else if(change.exceptionPolicy!==undefined)throw Error('Exception policy requires recurrence clearing')
  if(change.rrule!==undefined){
    if(change.scope!=='series'||change.rrule.length>512)throw Error('Series rule requires series scope')
    const rule=ICAL.Recur.fromString(change.rrule)
    if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(String(rule.freq)))throw Error('Unsupported recurrence')
    if(rule.until&&rule.until.isDate!==change.allDay)throw Error('UNTIL must match DTSTART date type')
    event.removeAllProperties('rrule');event.addPropertyWithValue('rrule',rule)
  }
  const selectedStart=event.getFirstPropertyValue('dtstart') as ICAL.Time
  const selectedEnd=event.getFirstPropertyValue('dtend') as ICAL.Time|null
  const creationZone=change.timezone?ICAL.TimezoneService.get(change.timezone):undefined
  const startZone=creationZone??(selectedStart.isDate?ICAL.Timezone.utcTimezone:selectedStart.zone),endZone=creationZone??(selectedEnd?.isDate?ICAL.Timezone.utcTimezone:selectedEnd?.zone)??startZone
  if(!change.allDay&&(startZone===ICAL.Timezone.localTimezone||endZone===ICAL.Timezone.localTimezone))throw Error('Floating selected exception requires clarification')
  const time=(value:string,zone:ICAL.Timezone)=>{
    const parsed=ICAL.Time.fromString(change.allDay?value:new Date(value).toISOString().replace(/\.\d{3}Z$/,'Z'),undefined)
    // Preserve the original local wall-time recurrence zone and VTIMEZONE data.
    // Timed tool inputs are UTC instants, so no ambiguous local DST guessing occurs.
    return !change.allDay?parsed.convertToZone(zone):parsed
  }
  const recurrenceZone=creationZone??(start.isDate?ICAL.Timezone.utcTimezone:start.zone)
  for(const [name,values] of [['rdate',change.rdates],['exdate',change.exdates]] as const){
    if(values===undefined)continue
    if(values.length>100)throw Error('Too many recurrence dates')
    event.removeAllProperties(name)
    for(const value of values){
      const parsed=ICAL.Time.fromString(value,undefined)
      if(parsed.isDate!==change.allDay||!parsed.isDate&&parsed.zone!==ICAL.Timezone.utcTimezone)throw Error('Recurrence date type/zone mismatch')
      const property=new ICAL.Property(name)
      if(parsed.isDate)property.resetType('date')
      property.setValue(parsed.isDate?parsed:parsed.convertToZone(recurrenceZone))
      if(!parsed.isDate&&recurrenceZone!==ICAL.Timezone.utcTimezone&&recurrenceZone!==ICAL.Timezone.localTimezone)property.setParameter('tzid',recurrenceZone.tzid)
      event.addProperty(property)
    }
  }
  if(change.operation!=='delete'){
    event.removeAllProperties('dtstart');event.removeAllProperties('dtend');event.removeAllProperties('duration')
    event.addPropertyWithValue('dtstart',time(change.start,startZone));event.addPropertyWithValue('dtend',time(change.end,endZone))
    for(const [name,zone] of [['dtstart',startZone],['dtend',endZone]] as const)if(!change.allDay&&zone!==ICAL.Timezone.utcTimezone&&zone!==ICAL.Timezone.localTimezone)event.getFirstProperty(name)!.setParameter('tzid',zone.tzid)
    for(const [key,value] of Object.entries({summary:change.title,description:change.description,location:change.location}))event.updatePropertyWithValue(key,value)
  }else{
    const selected=change.scope==='series'?root.getAllSubcomponents('vevent'):[event]
    for(const component of selected){
      component.updatePropertyWithValue('status','CANCELLED')
      if(component!==event){
        component.updatePropertyWithValue('sequence',Number(component.getFirstPropertyValue('sequence')??0)+1)
        component.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true))
      }
    }
  }
  event.updatePropertyWithValue('x-daymark-mutation',change.id)
  event.updatePropertyWithValue('sequence',Math.max(Number(master.getFirstPropertyValue('sequence')??0),Number(event.getFirstPropertyValue('sequence')??0))+1)
  event.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true))
  return root.toString()
}
type PendingMutation={guardVersion:1;saved:false;phase:'prepared'|'attempted';source:string;calendarId:string;eventId:string|null;resource:string;timezoneDefinition?:string}
function pendingMutation(value:unknown):value is PendingMutation {
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const r=value as Partial<PendingMutation>
  return r.guardVersion===1&&r.saved===false&&(r.phase==='prepared'||r.phase==='attempted')&&typeof r.source==='string'&&typeof r.calendarId==='string'&&(r.eventId===null||typeof r.eventId==='string')&&typeof r.resource==='string'
}
function recurringSource(root:ICAL.Component){
  const events=root.getAllSubcomponents('vevent')
  // Multiple components (including exceptions), exclusions and legacy EXRULE
  // are recurring/ambiguous evidence. VTIMEZONE rules are not event recurrence.
  return events.length!==1||events.some(event=>['rrule','rdate','recurrence-id','exdate','exrule'].some(name=>event.hasProperty(name)))
}
function hasMutation(root:ICAL.Component,id:string){return root.getAllSubcomponents('vevent').some(event=>event.getFirstPropertyValue('x-daymark-mutation')===id)}
async function applyNonRecurringChange(pool:Pool,config:CalendarConfig,input:EventChange,request:typeof fetch,scoped=false):Promise<CalendarWriteResult> {
  // Preserve the exact byte-hash convention of the existing writer across awaits.
  const serialized=JSON.stringify(input),change=JSON.parse(serialized) as EventChange,fingerprint=digest(serialized)
  const c=await pool.connect();let locked=false
  try {
    await c.query('SELECT pg_advisory_lock(817332)');locked=true
    const previous=(await c.query<MutationRow>('SELECT * FROM calendar_mutations WHERE id=$1',[change.id])).rows[0]
    if(previous&&previous.payload_hash!==fingerprint)return {code:409,safeFailure:'operation_key_mismatch'}
    const priorCompletion=completed(previous?.result,change,fingerprint)
    if(priorCompletion)return priorCompletion
    const pending=pendingMutation(previous?.result)?previous.result:undefined
    // Null legacy receipts may already have issued a PUT. Never call them prepared.
    const attempted=!!previous&&(!pending||pending.phase==='attempted')
    const failure=(code:NonNullable<CalendarWriteResult['safeFailure']>):CalendarWriteResult=>attempted?uncertain():{code:409,safeFailure:code}
    const state=(await c.query('SELECT snapshot,source_hash FROM calendar_sync_state WHERE id=1')).rows[0]
    const source=sourceHash(config)
    if(!state||state.source_hash!==source)return failure('cache_unavailable')
    const snapshot=state.snapshot as Snapshot,calendar=snapshot.calendars.find(item=>item.id===change.calendarId)
    if(!calendar)return failure('not_found')
    const occurrence=change.eventId?snapshot.events.find(event=>event.id===change.eventId&&event.calendarId===change.calendarId):undefined
    if(!pending&&change.eventId&&!occurrence)return failure('not_found')
    if(pending&&(pending.source!==source||pending.calendarId!==change.calendarId||pending.eventId!==(change.eventId??null)))return uncertain()
    const resource=pending?.resource??occurrence?.resource??new URL(change.id+'.ics',calendar.url.endsWith('/')?calendar.url:calendar.url+'/').href
    const url=new URL(resource)
    if(url.origin!==new URL(config.url).origin||url.username||url.password)return failure('cache_unavailable')
    const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')}
    const get=await request(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
    if(!get.ok&&get.status!==404)return uncertain()
    const raw=get.ok?await get.text():undefined,original=raw?new ICAL.Component(ICAL.parse(raw)):undefined
    if(!scoped&&(change.recurrenceId!=null||occurrence?.recurrenceId||original&&recurringSource(original)))return failure('unsupported_recurrence')
    if(scoped&&(change.scope!=='single'&&change.scope!=='series'||change.scope==='single'&&occurrence?.recurrenceId&&occurrence.recurrenceId!==change.recurrenceId))return failure('unsupported_recurrence')
    const alreadyApplied=!!original&&hasMutation(original,change.id)
    const record=async(result:unknown)=>{
      const updated=await c.query('UPDATE calendar_mutations SET result=$3 WHERE id=$1 AND payload_hash=$2 RETURNING id',[change.id,fingerprint,JSON.stringify(result)])
      if(updated.rowCount!==1)throw Error('Mutation ledger update failed')
    }
    const finish=async(readback:'verified'|'pending',etag:unknown):Promise<CalendarWriteResult>=>{
      const completion:CalendarCompletion={version:1,nonRecurringOnly:!scoped,mutationId:change.id,payloadHash:fingerprint,snapshot:'pending',readback,providerEtag:strongEtag(etag)?etag:null}
      await record({saved:true,completion})
      await c.query('UPDATE calendar_sync_state SET next_run=now() WHERE id=1')
      return {code:200,saved:true,completion}
    }
    if(alreadyApplied){
      if(!previous)return uncertain() // A marker alone does not bind a payload.
      return await finish('verified',get.headers.get('etag'))
    }
    if(change.eventId){
      if(!original)return failure('not_found')
      if(!strongEtag(change.etag)||get.headers.get('etag')!==change.etag)return failure('revision_mismatch')
    }else{
      if(get.ok)return failure('already_exists')
      // A missing resource after an ambiguous create may have been deleted by
      // somebody else. Do not resurrect it. Prepared/no-ledger creates can resume.
      if(attempted)return uncertain()
    }
    let data:string
    let timezoneDefinition=pending?.timezoneDefinition
    if(scoped&&change.timezone&&!timezoneDefinition){
      if(previous)return failure('unsupported_recurrence')
      const selected=snapshot.events.find(e=>e.calendarId===change.calendarId&&e.id===change.timezoneSourceEventId)
      if(!selected)return failure('cache_unavailable')
      const zoneUrl=new URL(selected.resource)
      if(zoneUrl.origin!==new URL(config.url).origin||zoneUrl.username||zoneUrl.password)return failure('cache_unavailable')
      const response=await request(zoneUrl.href,{headers,redirect:'error',signal:AbortSignal.timeout(15000)})
      if(!response.ok)return failure('cache_unavailable')
      const zoneRaw=await response.text()
      if(zoneRaw.length>2000000)return failure('unsupported_recurrence')
      const zones=new ICAL.Component(ICAL.parse(zoneRaw)).getAllSubcomponents('vtimezone').filter(z=>z.getFirstPropertyValue('tzid')===change.timezone)
      if(zones.length!==1)return failure('unsupported_recurrence')
      timezoneDefinition=zones[0]!.toString()
    }
    try{data=scoped?buildScopedEventResource(change,raw,timezoneDefinition):buildEventResource(change,raw)}catch{return failure('unsupported_recurrence')}
    const reservation:PendingMutation=pending??{guardVersion:1,saved:false,phase:'prepared',source,calendarId:calendar.id,eventId:change.eventId??null,resource,...(timezoneDefinition?{timezoneDefinition}:{})}
    if(!previous){
      const inserted=await c.query('INSERT INTO calendar_mutations(id,payload_hash,result) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',[change.id,fingerprint,JSON.stringify(reservation)])
      if(inserted.rowCount!==1)throw Error('Mutation ledger reservation failed')
    }
    // Persist the dispatch boundary before the request. A crash before this update
    // leaves a demonstrably prepared operation; after it, absence is ambiguous.
    await record({...reservation,phase:'attempted'})
    const put=await request(resource,{method:'PUT',headers:{...headers,'Content-Type':'text/calendar; charset=utf-8',...(change.eventId?{'If-Match':change.etag!}:{'If-None-Match':'*'})},body:data,redirect:'error',signal:AbortSignal.timeout(30000)})
    // Even an HTTP error can arrive after a provider partially applied a PUT.
    if(!put.ok)return uncertain()
    let readback:'verified'|'pending'='pending',etag=put.headers.get('etag')
    try {
      const verify=await request(resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)})
      if(verify.ok){
        const saved=new ICAL.Component(ICAL.parse(await verify.text()))
        if((scoped||!recurringSource(saved))&&hasMutation(saved,change.id)){readback='verified';etag=verify.headers.get('etag')}
      }
    }catch{/* Definite successful PUT is saved even when readback is unavailable. */}
    return await finish(readback,etag)
  }catch{return uncertain()}
   finally{
     let destroy=false
     try{if(locked)await c.query('SELECT pg_advisory_unlock(817332)')}catch{destroy=true}
     if(destroy)c.release(true);else c.release()
   }
}
