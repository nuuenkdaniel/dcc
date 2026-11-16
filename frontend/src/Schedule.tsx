import {PreparationPanel} from './PreparationPanel'
import type {Planner,Exam} from './usePlanner'
import {useState,useCallback,useRef,useEffect} from 'react'
import {CalendarEditor,type EditableEvent} from './CalendarEditor'
import {protectedFetch} from './auth'
import {pending,type Change} from './calendarOutbox'
import {useWorkspaceSession} from './workspaceSession'
import {useAutomaticRead,useWorkspaceWrites} from './workspaceWrites'
import {projectCalendarChanges,snapshotConfirmsChange,type CalendarEvent} from './calendarProjection'
type Calendar={id:string;name:string}
type Event=Exam&CalendarEvent
type Snapshot={calendars:Calendar[];events:Event[];lastSuccess:string|null;error?:string;coverageStart?:string;coverageEnd?:string}
const empty:Snapshot={calendars:[],events:[],lastSuccess:null}
export function Schedule({date,planner}:{date:string;planner:Planner}){
 const session=useWorkspaceSession()
 const key=session?.owner?`dcc.confirmed.calendar.${session.owner}`:null
 const [preparing,setPreparing]=useState<Event|null>(null)
 const [editing,setEditing]=useState<{event?:EditableEvent;draft?:Change}|null>(null)
 const [snapshot,setSnapshot]=useState<Snapshot>(()=>{try{return key?JSON.parse(localStorage.getItem(key)??'null')??empty:empty}catch{return empty}})
 const ref=useRef(snapshot)
 const generation=useRef(0)
 const [status,setStatus]=useState('Loading schedule…')
 const [ready,setReady]=useState(false)
 const [oldDrafts,setOldDrafts]=useState<Awaited<ReturnType<typeof pending>>>([])
 useEffect(()=>{
  if(!session?.owner||session.offline)return
  let mounted=true
  void pending().then(items=>{if(mounted)setOldDrafts(items)}).catch(()=>{})
  return()=>{mounted=false}
 },[session])
 const [hidden,setHidden]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('daymark.hidden-calendars')??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[]}catch{return []}})
 const publish=useCallback((data:Snapshot)=>{
  if(session?.signal.aborted)return
  ref.current=data
  setSnapshot(data)
  try{if(key)localStorage.setItem(key,JSON.stringify(data))}catch{/* The current view remains available. */}
 },[key,session])
 const refresh=useCallback(async()=>{
  if(!key)return
  const id=++generation.current
  try{
   const timeout=AbortSignal.timeout(12000)
   const r=await protectedFetch('/api/v1/calendar/snapshot',{signal:session?AbortSignal.any([timeout,session.signal]):timeout})
   if(!r.ok)throw Error()
   const data:Snapshot=await r.json()
   if(id!==generation.current||session?.signal.aborted)return
   if(!Array.isArray(data.events)||!Array.isArray(data.calendars))throw Error()
   publish(data);setStatus(data.error??'');setReady(true)
  }catch{if(id===generation.current&&!session?.signal.aborted){setStatus('Calendar connection unavailable');setReady(false)}}
 },[key,publish,session])
 useAutomaticRead(()=>void refresh(),['dcc-hermes-created','dcc-calendar-actions-saved'])
 const writes=useWorkspaceWrites<Change>('calendar',(receipt)=>{
  if(receipt.state==='saved'){
   const event=receipt.event as Event|null|undefined
   const data=ref.current
   publish({...data,events:[...data.events.filter(current=>current.id!==receipt.previousEventId&&current.id!==event?.id),...(event?[event]:[])]})
  }
  void refresh()
 })
 const canWrite=ready&&writes.online
 const submit=(change:Change)=>canWrite&&writes.submit(change.eventId??change.id,change,change.id)
 const pendingItems=writes.jobs.flatMap(job=>job.payload?[{change:job.payload}]:[])
 const reopen=(draft:Change)=>{
  const event=draft.eventId?snapshot.events.find(item=>item.id===draft.eventId):undefined
  if(draft.eventId&&!event){setStatus('The original event is unavailable. Your draft was retained.');return}
  setEditing({event,draft})
 }
 const dayStart=new Date(`${date}T00:00:00`),dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1)
  const projected=projectCalendarChanges(snapshot.events,pendingItems) as Event[]
  const events=projected.filter(e=>!hidden.includes(e.calendarId)&&(e.allDay?e.start<=date&&e.end>date:new Date(e.start)<dayEnd&&(new Date(e.end)>dayStart||e.start===e.end&&new Date(e.start)>=dayStart))).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.start.localeCompare(b.start))
 const covered=!snapshot.coverageStart||!snapshot.coverageEnd||dayStart>=new Date(snapshot.coverageStart)&&dayEnd<=new Date(snapshot.coverageEnd)
 return <section className="schedule-panel" aria-labelledby="schedule-heading"><div className="section-heading"><h2 id="schedule-heading">Schedule</h2><div className="schedule-actions">{snapshot.calendars.length>0&&<button className="secondary-action" disabled={!canWrite} onClick={()=>setEditing({})}>New event</button>}</div></div>
 {editing&&<CalendarEditor date={date} calendars={snapshot.calendars} event={editing.event} draft={editing.draft} onClose={()=>setEditing(null)} onSave={submit}/>}
 {preparing&&<PreparationPanel event={preparing} planner={planner} onClose={()=>setPreparing(null)}/>}
 <p className="local-note" role="status">{writes.message||(writes.jobs.length?'Saving…':!writes.online?'Connect to make changes':status)}</p>
 {writes.failed&&<button disabled={!canWrite} onClick={()=>reopen(writes.failed!)}>Edit failed event</button>}
 {oldDrafts.some(item=>!snapshotConfirmsChange(item,snapshot))&&<details><summary>Previous calendar drafts</summary>
 {oldDrafts.filter(item=>!snapshotConfirmsChange(item,snapshot)).map(item=><div key={item.change.id}><span>{item.change.title}</span>{!item.awaitingConfirmation&&item.change.operation!=='delete'&&<button disabled={!canWrite} onClick={()=>reopen(item.change)}>Review draft</button>}</div>)}
 </details>}
 {snapshot.calendars.length>0&&<details><summary>Calendars</summary><div className="calendar-options">{snapshot.calendars.map(c=><label key={c.id}><input type="checkbox" checked={!hidden.includes(c.id)} onChange={e=>{const next=e.target.checked?hidden.filter(id=>id!==c.id):[...hidden,c.id];setHidden(next);try{localStorage.setItem('daymark.hidden-calendars',JSON.stringify(next))}catch{setStatus('Calendar visibility could not be saved')}}}/>{c.name}</label>)}</div></details>}
  {!covered?<p className="local-note">This date is outside the cached calendar range.</p>:events.length===0?<p className="local-note">{snapshot.lastSuccess?'No visible events for this day.':'Your events will appear after the first sync.'}</p>:events.map(e=><details className="schedule-event" key={e.id}><summary><span>{e.allDay?'All day':`${new Date(e.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} – ${new Date(e.end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}${new Date(e.start).toDateString()!==new Date(e.end).toDateString()?` (${new Date(e.end).toLocaleDateString([],{month:'short',day:'numeric'})})`:''}`}</span><strong>{e.title||'Untitled event'}</strong></summary><p>{snapshot.calendars.find(c=>c.id===e.calendarId)?.name}</p>{e.pendingMutationId&&<p className="local-note">Saving…</p>}{!e.allDay&&<p>Ends {new Date(e.end).toLocaleString()}</p>}{e.location&&<p>{e.location}</p>}{e.description&&<p className="event-description">{e.description}</p>}<button disabled={!canWrite||!!e.pendingMutationId} onClick={()=>setEditing({event:e})}>Edit event</button> <button disabled={!canWrite||!!e.pendingMutationId} onClick={()=>setPreparing(e)}>Prepare for this event</button></details>)}
 </section>
}
