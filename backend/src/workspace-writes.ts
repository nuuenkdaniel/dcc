import {createHash} from 'node:crypto'
import type {FastifyInstance,FastifyRequest} from 'fastify'
import type {Pool} from 'pg'
import {saveTaskInTransaction,type ManualTask} from './manual-tasks.js'
import {saveEntityInTransaction,type Entity} from './planner.js'
import {type CalendarWriteResult,type EventChange} from './calendar-write.js'
import {type Snapshot} from './sync.js'

type Write={id:string;kind:'task'|'planner'|'calendar';payload:Record<string,unknown>}
type Receipt={state:'saving'|'saved'|'failed'|'unconfirmed';task?:ManualTask;version?:number;entry?:unknown;event?:unknown;previousEventId?:string;code?:number}
export type CalendarOperations={
 write:(change:EventChange)=>Promise<CalendarWriteResult>
 refresh:()=>Promise<string>
 snapshot:()=>Promise<Snapshot & {error?:string|null}>
}
const path='/api/v1/workspace/writes'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const text=(value:unknown,limit:number)=>typeof value==='string'&&value.length<=limit
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex')
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const validWrite=(value:unknown):value is Write=>object(value)&&typeof value.id==='string'&&uuid.test(value.id)&&['task','planner','calendar'].includes(String(value.kind))&&object(value.payload)
function calendarChange(id:string,input:Record<string,unknown>):EventChange|null{
 const {calendarId,eventId,etag,operation,title,start,end,allDay,description,location}=input
 if(![calendarId,title,start,end,description,location].every(value=>typeof value==='string')||typeof allDay!=='boolean')return null
 if(!text(calendarId,64)||!calendarId||!text(title,500)||!String(title).trim()||!text(description,20000)||!text(location,1000))return null
 if(eventId!==undefined&&(!text(eventId,64)||!eventId||!text(etag,512)||!etag))return null
 if(operation!==undefined&&(operation!=='delete'||!eventId))return null
 const from=String(start),to=String(end)
 const datePattern=allDay?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
 const valid=(date:string)=>datePattern.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date.slice(0,10)
 if(!valid(from)||!valid(to)||Date.parse(to)<=Date.parse(from))return null
 return {id,scope:'single',calendarId:String(calendarId),...(eventId?{eventId:String(eventId),etag:String(etag)}:{}),...(operation==='delete'?{operation}:{}),title:String(title),start:from,end:to,allDay,description:String(description),location:String(location)}
}

export function workspaceWriteRoutes(app:FastifyInstance,pool:Pool,ownerOf:(request:FastifyRequest)=>string|undefined,calendar?:CalendarOperations){
 app.get<{Params:{id:string}}>(path+'/:id',async(request,reply)=>{
  const owner=ownerOf(request)
  if(!owner)return reply.code(401).send()
  if(!uuid.test(request.params.id))return reply.code(404).send()
  const {rows}=await pool.query('SELECT receipt FROM workspace_writes WHERE owner=$1 AND id=$2',[owner,request.params.id])
  return rows[0]?.receipt??reply.code(404).send()
 })
 app.post(path,async(request,reply)=>{
  const owner=ownerOf(request)
  if(!owner)return reply.code(401).send()
  if(request.headers['x-dcc-workspace-owner']!==owner)return reply.code(409).send({state:'failed',code:409})
  if(!validWrite(request.body))return reply.code(400).send()
  const {id,kind,payload}=request.body
  const fingerprint=hash({kind,payload})
  const client=await pool.connect()
  try{
   await client.query('BEGIN')
   await client.query("SET LOCAL lock_timeout='8s'")
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[owner+id])
   const previous=(await client.query('SELECT fingerprint,receipt FROM workspace_writes WHERE owner=$1 AND id=$2',[owner,id])).rows[0]
   let receipt:Receipt
   if(previous){
    receipt=previous.fingerprint===fingerprint?previous.receipt:{state:'failed',code:409}
   }else{
    let change:EventChange|null=null
    if(kind==='calendar'){
     change=calendar?calendarChange(id,payload):null
     let code=calendar?400:503
     if(change){
      const snapshot=(await client.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0]?.snapshot as Snapshot|undefined
      const occurrence=change.eventId?snapshot?.events.find(event=>event.id===change!.eventId&&event.calendarId===change!.calendarId):undefined
      const start=Date.parse(change.start)
      if(change.eventId&&!occurrence){code=409;change=null}
      else if(!snapshot?.calendars.some(item=>item.id===change?.calendarId)){code=503;change=null}
      else if(!snapshot.coverageStart||!snapshot.coverageEnd||start<Date.parse(snapshot.coverageStart)||start>=Date.parse(snapshot.coverageEnd)){
       change=null
      }else if(occurrence){
       change={...change,uid:occurrence.uid,sourceOccurrenceStart:occurrence.start,recurrenceId:occurrence.recurrenceId}
      }
     }
     receipt=change?{state:'saving'}:{state:'failed',code}
    }else if(kind==='task'){
     const result=await saveTaskInTransaction(client,payload.expected as ManualTask|null,payload.task as ManualTask)
     receipt=result.code===200?{state:'saved',task:result.task,version:result.version}:{state:'failed',code:result.code}
    }else{
     const result=await saveEntityInTransaction(client,String(payload.kind),typeof payload.version==='number'?payload.version:-1,payload.data as Entity)
     receipt=result.code===200?{state:'saved',entry:result.entry}:{state:'failed',code:result.code}
    }
    await client.query('INSERT INTO workspace_writes(owner,id,fingerprint,calendar_change,receipt) VALUES($1,$2,$3,$4,$5)',[owner,id,fingerprint,change,receipt])
   }
   await client.query('COMMIT')
   return reply.code(receipt.state==='saving'?202:receipt.state==='failed'?receipt.code??400:200).send(receipt)
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 })
}

export function confirmedCalendarChange(change:EventChange,snapshot:Snapshot & {error?:string|null}){
 if(change.operation!=='delete')return snapshot.events.find(event=>event.calendarId===change.calendarId&&event.mutationId===change.id)
 if(snapshot.error||!snapshot.coverageStart||!snapshot.coverageEnd)return undefined
 const start=Date.parse(change.start)
 if(start<Date.parse(snapshot.coverageStart)||start>=Date.parse(snapshot.coverageEnd))return undefined
 return snapshot.events.some(event=>event.calendarId===change.calendarId&&event.id===change.eventId)?undefined:null
}

export async function processCalendarWrite(pool:Pool,calendar:CalendarOperations){
 const client=await pool.connect()
 let locked=false,destroy=false
 try{
  locked=(await client.query('SELECT pg_try_advisory_lock(817357) AS locked')).rows[0].locked
  if(!locked)return
  const row=(await client.query(`SELECT owner,id,attempts,calendar_change FROM workspace_writes
    WHERE calendar_change IS NOT NULL AND next_attempt<=now() ORDER BY next_attempt,id LIMIT 1`)).rows[0]
  if(!row)return
  const change=row.calendar_change as EventChange
  let receipt:Receipt={state:row.attempts>=4?'unconfirmed':'saving'}
  try{
   const result=await calendar.write(change)
   if(result.safeFailure)receipt={state:'failed',code:result.code}
   if(result.saved){
    if(confirmedCalendarChange(change,await calendar.snapshot())===undefined)await calendar.refresh()
    const event=confirmedCalendarChange(change,await calendar.snapshot())
    if(event!==undefined)receipt={state:'saved',event,...(change.eventId?{previousEventId:change.eventId}:{})}
   }
  }catch{/* Retry only through the guarded writer and its durable provider identity. */}
  const finished=receipt.state==='saved'||receipt.state==='failed'
  await client.query(`UPDATE workspace_writes SET receipt=$3, attempts=attempts+1, updated_at=now(),
    next_attempt=now()+$4*interval '1 second', calendar_change=CASE WHEN $5 THEN NULL ELSE calendar_change END WHERE owner=$1 AND id=$2`,
   [row.owner,row.id,receipt,Math.min(300,2**Math.min(row.attempts,9)),finished])
 }finally{
  try{if(locked)await client.query('SELECT pg_advisory_unlock(817357)')}catch{destroy=true}
  client.release(destroy)
 }
}
