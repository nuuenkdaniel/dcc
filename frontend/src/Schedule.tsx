import {PreparationPanel} from './PreparationPanel'
import type {Planner,Exam} from './usePlanner'
import {useEffect,useState,useCallback,useRef} from 'react'
import {CalendarEditor,PendingChanges,type EditableEvent} from './CalendarEditor'
import {pending} from './calendarOutbox'
import {protectedFetch,reportAuthRequired} from './auth'
type Calendar={id:string;name:string}
type Event=Exam&{etag?:string;id:string;calendarId:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
type Snapshot={calendars:Calendar[];events:Event[];lastSuccess:string|null;error?:string;coverageStart?:string;coverageEnd?:string}
const empty:Snapshot={calendars:[],events:[],lastSuccess:null}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('daymark-calendar',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function cache(value?:Snapshot|null):Promise<Snapshot|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('cache',value===undefined?'readonly':'readwrite');const store=tx.objectStore('cache');const r=value===undefined?store.get('snapshot'):value===null?store.delete('snapshot'):store.put(value,'snapshot');tx.oncomplete=()=>resolve(value===undefined?r.result:undefined);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
export function Schedule({date,planner}:{date:string;planner:Planner}){
 const [preparing,setPreparing]=useState<Event|null>(null)
 const [syncing,setSyncing]=useState(false)
 const generation=useRef(0)
 const [snapshot,setSnapshot]=useState(empty)
 const [editing,setEditing]=useState<EditableEvent|null|undefined>(undefined)
 const [revision,setRevision]=useState(0)
 const [status,setStatus]=useState('Loading schedule…')
 const [session,setSession]=useState<boolean|null>(null)
 const [hidden,setHidden]=useState<string[]>(()=>{try{const v=JSON.parse(localStorage.getItem('daymark.hidden-calendars')??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[]}catch{return []}})
 const refresh=useCallback(async(force=false)=>{
  const current=++generation.current
  try{
    const auth=await fetch('/api/v1/auth/session',{credentials:'same-origin',signal:AbortSignal.timeout(8000)});if(!auth.ok)throw Error()
   const identity=await auth.json();if(current!==generation.current&&!force)return;setSession(identity.authenticated)
   if(!identity.authenticated){setStatus(identity.configured?'Sign in to dcc to reconnect. Cached events remain on this device.':'Calendar connection is not configured.');return}
   let syncNotice=''
    if(force){setSyncing(true);setStatus('Syncing with Nextcloud…');try{const response=await protectedFetch('/api/v1/calendar/refresh',{method:'POST',signal:AbortSignal.timeout(90000)});if(!response.ok)syncNotice='Nextcloud refresh failed · showing cached schedule';else{const result=await response.json();if(result.status==='busy')syncNotice='Calendar sync already running; cached events shown until it finishes';if(result.status==='waiting')syncNotice='Recently requested sync · showing latest cache'}}catch{syncNotice='Nextcloud refresh unavailable · showing cached schedule'}finally{setSyncing(false)}}
    const r=await protectedFetch('/api/v1/calendar/snapshot',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error()
   const data:Snapshot=await r.json();if(!Array.isArray(data.calendars)||!Array.isArray(data.events))throw Error()
   if(current!==generation.current)return
   setSnapshot(data);setStatus(syncNotice||data.error||(data.lastSuccess?'Synced':'Waiting for first sync'))
   await cache(data).catch(()=>setStatus('Synced, but browser caching is unavailable'))
  }catch{setStatus('Backend unavailable · showing cached schedule')}
 },[])
 useEffect(()=>{let active=true;void cache().then(value=>{if(value&&active)setSnapshot(value)}).catch(()=>{}).finally(()=>{if(active)void refresh(true)});const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},60000);const online=()=>void refresh();window.addEventListener('online',online);return()=>{active=false;clearInterval(timer);window.removeEventListener('online',online)}},[refresh])
 const readSnapshot=useCallback(()=>{void refresh()},[refresh])
 const dayStart=new Date(`${date}T00:00:00`),dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1)
 const events=snapshot.events.filter(e=>!hidden.includes(e.calendarId)&&(e.allDay?e.start<=date&&e.end>date:new Date(e.start)<dayEnd&&(new Date(e.end)>dayStart||e.start===e.end&&new Date(e.start)>=dayStart))).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.start.localeCompare(b.start))
 const covered=!snapshot.coverageStart||!snapshot.coverageEnd||dayStart>=new Date(snapshot.coverageStart)&&dayEnd<=new Date(snapshot.coverageEnd)
  return <section className="schedule-panel" aria-labelledby="schedule-heading"><div className="section-heading"><h2 id="schedule-heading">Schedule</h2><div className="schedule-actions">{session&&<button disabled={syncing} onClick={()=>void refresh(true)}>{syncing?'Syncing…':'Sync calendar'}</button>}{snapshot.calendars.length>0&&<button onClick={()=>setEditing(null)}>New event</button>}{session===null?null:!session?<a href="/login">Sign in</a>:<button onClick={async()=>{try{if((await pending()).length){setStatus('Sync or discard pending calendar drafts before signing out.');return}generation.current++;const r=await protectedFetch('/api/v1/auth/logout',{method:'POST'});if(!r.ok)throw Error();generation.current++;await cache(null);setSnapshot(empty);setSession(false);reportAuthRequired()}catch{setStatus('Could not sign out. Reconnect and try again.')}}}>Sign out</button>}</div></div>
 {editing!==undefined&&<CalendarEditor date={date} calendars={snapshot.calendars} {...(editing?{event:editing}:{})} onClose={()=>setEditing(undefined)} onSaved={()=>setRevision(v=>v+1)}/>}
 {preparing&&<PreparationPanel event={preparing} planner={planner} onClose={()=>setPreparing(null)}/>}
 <PendingChanges revision={revision} onSent={readSnapshot}/>
 <p className="local-note" role="status">{status}{snapshot.lastSuccess?` · ${new Date(snapshot.lastSuccess).toLocaleString()}`:''}</p>
 {snapshot.calendars.length>0&&<details><summary>Calendars</summary><div className="calendar-options">{snapshot.calendars.map(c=><label key={c.id}><input type="checkbox" checked={!hidden.includes(c.id)} onChange={e=>{const next=e.target.checked?hidden.filter(id=>id!==c.id):[...hidden,c.id];setHidden(next);try{localStorage.setItem('daymark.hidden-calendars',JSON.stringify(next))}catch{setStatus('Calendar visibility could not be saved')}}}/>{c.name}</label>)}</div></details>}
 {!covered?<p className="local-note">This date is outside the cached calendar range.</p>:events.length===0?<p className="local-note">{snapshot.lastSuccess?'No visible events for this day.':'Your events will appear after the first sync.'}</p>:events.map(e=><details className="schedule-event" key={e.id}><summary><span>{e.allDay?'All day':`${new Date(e.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} – ${new Date(e.end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}${new Date(e.start).toDateString()!==new Date(e.end).toDateString()?` (${new Date(e.end).toLocaleDateString([],{month:'short',day:'numeric'})})`:''}`}</span><strong>{e.title||'Untitled event'}</strong></summary><p>{snapshot.calendars.find(c=>c.id===e.calendarId)?.name}</p>{!e.allDay&&<p>Ends {new Date(e.end).toLocaleString()}</p>}{e.location&&<p>{e.location}</p>}{e.description&&<p className="event-description">{e.description}</p>}<button onClick={()=>setEditing(e)}>Edit event</button> <button onClick={()=>setPreparing(e)}>Prepare for this event</button></details>)}
 </section>
}
