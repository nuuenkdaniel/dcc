import type {Pool} from 'pg'
import {createHash} from 'node:crypto'
import {calendarClient,type CalendarConfig} from './caldav.js'
import {parseExpandedEvents,type EventOccurrence} from './events.js'
export type Snapshot={calendars:{id:string;name:string;url:string}[];events:EventOccurrence[];coverageStart?:string;coverageEnd?:string}
export const sourceHash=(config:CalendarConfig)=>createHash('sha256').update(config.url+'\0'+config.username).digest('hex')
export async function fetchSnapshot(config:CalendarConfig):Promise<Snapshot> {
 const client=calendarClient(config);await client.login()
 const calendars=(await client.fetchCalendars()).filter(c=>c.components?.includes('VEVENT'))
 const start=new Date();start.setUTCDate(start.getUTCDate()-config.past)
 const end=new Date();end.setUTCMonth(end.getUTCMonth()+config.future)
 const snapshot:Snapshot={calendars:[],events:[],coverageStart:start.toISOString(),coverageEnd:end.toISOString()}
 for(const calendar of calendars) {
  const id=createHash('sha256').update(calendar.url).digest('hex')
  snapshot.calendars.push({id,name:String(calendar.displayName??'Calendar'),url:calendar.url})
  const objects=await client.fetchCalendarObjects({calendar,timeRange:{start:start.toISOString(),end:end.toISOString()},expand:true})
  for(const object of objects) {
   if(typeof object.data!=='string') throw new Error('Missing event data')
   snapshot.events.push(...parseExpandedEvents(object.data,id,object.url,object.etag??''))
  }
 }
 return snapshot
}
export async function runSync(pool:Pool,interval:number,source:string,fetcher:()=>Promise<Snapshot>,force=false,cooldownSeconds=0) {
 const connection=await pool.connect();let locked=false
 try {
  locked=(await connection.query('SELECT pg_try_advisory_lock(817332) AS locked')).rows[0].locked
  if(!locked) return 'busy'
  const state=(await connection.query('SELECT *,next_run<=now() AS due FROM calendar_sync_state WHERE id=1')).rows[0]
  if(force && cooldownSeconds>0 && state.last_attempt && Date.now()-new Date(state.last_attempt).getTime()<cooldownSeconds*1000) return 'waiting'
  if(!force && !state.due && state.source_hash===source) return 'waiting'
  await connection.query('UPDATE calendar_sync_state SET last_attempt=now() WHERE id=1')
  try {
   const snapshot=await fetcher()
   await connection.query(`UPDATE calendar_sync_state SET snapshot=$1,source_hash=$2,last_success=now(),error=NULL,failures=0,next_run=now()+$3*interval '1 second' WHERE id=1`,[JSON.stringify(snapshot),source,interval])
   return 'synced'
  } catch(error) {
   const auth=error instanceof Error && error.message==='CALDAV_AUTH'
   const delay=auth?86400:Math.min(3600,60*2**Math.min(state.failures,6))
   await connection.query(`UPDATE calendar_sync_state SET error=$1,failures=failures+1,next_run=now()+$2*interval '1 second' WHERE id=1`,[auth?'Nextcloud authentication failed':'Calendar sync failed; previous cache retained',delay])
   return 'failed'
  }
 } finally {if(locked) await connection.query('SELECT pg_advisory_unlock(817332)');connection.release()}
}
