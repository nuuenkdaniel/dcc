import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {mergeTasks,type SharedTask} from './sharedTasks'
function taskFetch(path:string,options:RequestInit={}){return fetch(path,{...options,signal:AbortSignal.timeout(10000)})}
const KEY='dcc.manual-tasks.base.v1'
export function ManualTaskSync({tasks,onApply}:{tasks:SharedTask[];onApply:(tasks:SharedTask[])=>void}){
 const inFlight=useRef(false),blocked=useRef(false)
 const latest=useRef(tasks);useLayoutEffect(()=>{latest.current=tasks},[tasks])
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false)
 async function sync(choice?:'local'|'remote'){
  if(inFlight.current||blocked.current&&!choice)return;inFlight.current=true;setBusy(true);let followUp=false
  try{
   const base=JSON.parse(localStorage.getItem(KEY)??'[]') as SharedTask[]
   const response=await taskFetch('/api/v1/planner/manual-tasks')
   if(!response.ok)throw Error(response.status===401?'Sign in to sync tasks.':'Task sync unavailable; local tasks retained.')
   const remote=await response.json() as {version:number;data:{tasks:SharedTask[]}}
   const captured=latest.current
   const merged=mergeTasks(base,captured,remote.data.tasks,choice)
   if(merged.conflicts.length&&!choice){blocked.current=true;setConflict(true);setMessage('Some tasks changed on both devices. Choose which conflicting edits to keep.');return}
   if(JSON.stringify(merged.tasks)!==JSON.stringify(remote.data.tasks)){
   const save=await taskFetch('/api/v1/planner/manual-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:remote.version,tasks:merged.tasks})})
   if(!save.ok)throw Error(save.status===409?'Tasks changed during sync. Retry; your local edits are retained.':'Save failed; local tasks retained.')
   }
   const readback=await taskFetch('/api/v1/planner/manual-tasks');if(!readback.ok)throw Error('Could not confirm sync. Retry safely.')
   const fresh=await readback.json() as {data:{tasks:SharedTask[]}}
   const combined=mergeTasks(captured,latest.current,fresh.data.tasks)
   if(combined.conflicts.length)throw Error('Tasks changed while syncing. Local edits retained; sync again to review.')
   followUp=JSON.stringify(combined.tasks)!==JSON.stringify(fresh.data.tasks)
   localStorage.setItem(KEY,JSON.stringify(fresh.data.tasks));if(JSON.stringify(combined.tasks)!==JSON.stringify(latest.current))onApply(combined.tasks);blocked.current=false;setConflict(false);setMessage('Tasks synced.')
  }catch(e){setMessage(e instanceof Error?e.message:'Offline; tasks retained.')}finally{inFlight.current=false;setBusy(false);if(followUp)queueMicrotask(()=>void syncRef.current())}
 }
 const syncRef=useRef(sync);useLayoutEffect(()=>{syncRef.current=sync})
 useEffect(()=>{void syncRef.current()},[tasks])
 useEffect(()=>{const retry=()=>void syncRef.current();const visible=()=>{if(document.visibilityState==='visible')retry()};window.addEventListener('online',retry);window.addEventListener('dcc-auth-changed',retry);document.addEventListener('visibilitychange',visible);const timer=setInterval(retry,30000);return()=>{clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('dcc-auth-changed',retry);document.removeEventListener('visibilitychange',visible)}},[])
 return <details className="planner-details"><summary>Task sync</summary><p>Changes sync automatically when connected. Offline edits stay on this device and retry when the connection returns.</p><button disabled={busy} onClick={()=>void sync()}>{busy?'Syncing tasks…':'Sync tasks'}</button><p role="status">{message}</p>{conflict&&<><button disabled={busy} onClick={()=>void sync('local')}>Keep local conflicting edits</button><button disabled={busy} onClick={()=>void sync('remote')}>Keep remote conflicting edits</button></>}</details>
}
