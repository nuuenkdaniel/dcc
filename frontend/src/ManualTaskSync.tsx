import {useLayoutEffect,useRef,useState} from 'react'
import {mergeTasks,type SharedTask} from './sharedTasks'
const KEY='dcc.manual-tasks.base.v1'
export function ManualTaskSync({tasks,onApply}:{tasks:SharedTask[];onApply:(tasks:SharedTask[])=>void}){
 const latest=useRef(tasks);useLayoutEffect(()=>{latest.current=tasks},[tasks])
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false)
 async function sync(choice?:'local'|'remote'){
  if(busy)return;setBusy(true)
  try{
   const base=JSON.parse(localStorage.getItem(KEY)??'[]') as SharedTask[]
   const response=await fetch('/api/v1/planner/manual-tasks')
   if(!response.ok)throw Error(response.status===401?'Sign in to sync tasks.':'Task sync unavailable; local tasks retained.')
   const remote=await response.json() as {version:number;data:{tasks:SharedTask[]}}
   const captured=latest.current
   const merged=mergeTasks(base,captured,remote.data.tasks,choice)
   if(merged.conflicts.length&&!choice){setConflict(true);setMessage('Some tasks changed on both devices. Choose which conflicting edits to keep.');return}
   const save=await fetch('/api/v1/planner/manual-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:remote.version,tasks:merged.tasks})})
   if(!save.ok)throw Error(save.status===409?'Tasks changed during sync. Retry; your local edits are retained.':'Save failed; local tasks retained.')
   const readback=await fetch('/api/v1/planner/manual-tasks');if(!readback.ok)throw Error('Could not confirm sync. Retry safely.')
   const fresh=await readback.json() as {data:{tasks:SharedTask[]}}
   const combined=mergeTasks(captured,latest.current,fresh.data.tasks)
   if(combined.conflicts.length)throw Error('Tasks changed while syncing. Local edits retained; sync again to review.')
   localStorage.setItem(KEY,JSON.stringify(fresh.data.tasks));onApply(combined.tasks);setConflict(false);setMessage('Tasks synced.')
  }catch(e){setMessage(e instanceof Error?e.message:'Offline; tasks retained.')}finally{setBusy(false)}
 }
 return <details className="planner-details"><summary>Task sync</summary><p>Sync manual tasks with your other devices. Existing local tasks are included.</p><button disabled={busy} onClick={()=>void sync()}>{busy?'Syncing tasks…':'Sync tasks'}</button><p role="status">{message}</p>{conflict&&<><button disabled={busy} onClick={()=>void sync('local')}>Keep local conflicting edits</button><button disabled={busy} onClick={()=>void sync('remote')}>Keep remote conflicting edits</button></>}</details>
}
