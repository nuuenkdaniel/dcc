import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {mergeTasks,type SharedTask} from './sharedTasks'
import {protectedFetch} from './auth'
function taskFetch(path:string,options:RequestInit={},lifecycle?:AbortSignal){return protectedFetch(path,{...options,signal:lifecycle?AbortSignal.any([lifecycle,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)})}
const KEY='dcc.manual-tasks.base.v1'
export function ManualTaskSync({tasks,onApply}:{tasks:SharedTask[];onApply:(tasks:SharedTask[])=>Promise<boolean>}){
 const inFlight=useRef(false),blocked=useRef(false),mounted=useRef(false),activeController=useRef<AbortController|null>(null),pending=useRef(false),pendingChoice=useRef<'local'|'remote'|undefined>(undefined)
 const latest=useRef(tasks);useLayoutEffect(()=>{latest.current=tasks},[tasks])
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false)
 async function sync(choice?:'local'|'remote'){
  if(!navigator.locks?.request){setMessage('Safe task sync requires browser Web Locks. Nothing was overwritten; use a supported browser.');return}
  if(blocked.current&&!choice)return
  if(inFlight.current){pending.current=true;if(choice)pendingChoice.current=choice;return}
  const controller=new AbortController();activeController.current=controller;inFlight.current=true;if(mounted.current)setBusy(true);let followUp=false
  try{followUp=await navigator.locks.request('daymark.manual-task-sync.v1',{signal:controller.signal},()=>syncLocked(choice,controller.signal))}
  catch(e){if(mounted.current&&!(e instanceof DOMException&&e.name==='AbortError'))setMessage(e instanceof Error?e.message:'Offline; tasks retained.')}
  finally{if(activeController.current===controller)activeController.current=null;inFlight.current=false;if(mounted.current)setBusy(false)}
  if(!mounted.current)return
  if(followUp)pending.current=true
  if(pending.current){const nextChoice=pendingChoice.current;pending.current=false;pendingChoice.current=undefined;queueMicrotask(()=>{if(mounted.current)void syncRef.current(nextChoice)})}
 }
 async function syncLocked(choice:'local'|'remote'|undefined,lifecycle:AbortSignal){
  try{
    const base=JSON.parse(localStorage.getItem(KEY)??'[]') as SharedTask[]
    const response=await taskFetch('/api/v1/planner/manual-tasks',{},lifecycle)
   if(!response.ok)throw Error(response.status===401?'Sign in to sync tasks.':'Task sync unavailable; local tasks retained.')
   const remote=await response.json() as {version:number;data:{tasks:SharedTask[]}}
   const captured=latest.current
   const merged=mergeTasks(base,captured,remote.data.tasks,choice)
    if(merged.conflicts.length&&!choice){blocked.current=true;if(mounted.current){setConflict(true);setMessage('Some tasks changed on both devices. Choose which conflicting edits to keep.')}return false}
    if(JSON.stringify(merged.tasks)!==JSON.stringify(remote.data.tasks)){
    const save=await taskFetch('/api/v1/planner/manual-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:remote.version,tasks:merged.tasks})},lifecycle)
   if(!save.ok)throw Error(save.status===409?'Tasks changed during sync. Retry; your local edits are retained.':'Save failed; local tasks retained.')
   }
    const readback=await taskFetch('/api/v1/planner/manual-tasks',{},lifecycle);if(!readback.ok)throw Error('Could not confirm sync. Retry safely.')
   const fresh=await readback.json() as {data:{tasks:SharedTask[]}}
   const combined=mergeTasks(captured,latest.current,fresh.data.tasks)
   if(combined.conflicts.length)throw Error('Tasks changed while syncing. Local edits retained; sync again to review.')
    const followUp=JSON.stringify(combined.tasks)!==JSON.stringify(fresh.data.tasks)
      if(lifecycle.aborted)return false
      if(JSON.stringify(combined.tasks)!==JSON.stringify(latest.current)&&!await onApply(combined.tasks))throw Error('Tasks changed in another tab while syncing. Newer saved edits were retained; review and retry.')
      if(lifecycle.aborted)return false
      localStorage.setItem(KEY,JSON.stringify(fresh.data.tasks));blocked.current=false;setConflict(false);setMessage('Tasks synced.')
     return followUp
  }catch(e){if(mounted.current&&!(e instanceof DOMException&&e.name==='AbortError'))setMessage(e instanceof Error?e.message:'Offline; tasks retained.');return false}
 }
 const syncRef=useRef(sync);useLayoutEffect(()=>{syncRef.current=sync})
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current=false;pendingChoice.current=undefined;activeController.current?.abort();activeController.current=null}},[])
 useEffect(()=>{void syncRef.current()},[tasks])
 useEffect(()=>{const retry=()=>void syncRef.current();const visible=()=>{if(document.visibilityState==='visible')retry()};window.addEventListener('online',retry);window.addEventListener('dcc-auth-changed',retry);document.addEventListener('visibilitychange',visible);const timer=setInterval(retry,30000);return()=>{clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('dcc-auth-changed',retry);document.removeEventListener('visibilitychange',visible)}},[])
 return <details className="planner-details"><summary>Task sync</summary><p>Changes sync automatically when connected. Offline edits stay on this device and retry when the connection returns.</p><button disabled={busy} onClick={()=>void sync()}>{busy?'Syncing tasks…':'Sync tasks'}</button><p role="status">{message}</p>{conflict&&<><button disabled={busy} onClick={()=>void sync('local')}>Keep local conflicting edits</button><button disabled={busy} onClick={()=>void sync('remote')}>Keep remote conflicting edits</button></>}</details>
}
