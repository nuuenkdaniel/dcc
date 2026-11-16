import {useCallback,useRef,useState} from 'react'
import {protectedFetch} from './auth'
import {validSharedTask,type SharedTask} from './sharedTasks'
import {useWorkspaceSession} from './workspaceSession'
import {useAutomaticRead,useWorkspaceWrites} from './workspaceWrites'

type Snapshot={version:number;data:{tasks:SharedTask[]}}
type Change={expected:SharedTask|null;task:SharedTask}
function readCache(key:string|null):Snapshot{
 try{
  const saved:Snapshot=key?JSON.parse(localStorage.getItem(key)??'null'):null
  if(Number.isSafeInteger(saved?.version)&&Array.isArray(saved?.data?.tasks)&&saved.data.tasks.every(validSharedTask))return saved
 }catch{/* The next server read can rebuild the confirmed cache. */}
 return {version:0,data:{tasks:[]}}
}

export function useServerTasks(){
 const session=useWorkspaceSession()
 const key=session?.owner?`dcc.confirmed.tasks.${session.owner}`:null
 const [confirmed,setConfirmed]=useState(()=>readCache(key))
 const snapshot=useRef(confirmed)
 const [ready,setReady]=useState(false)
 const [unavailable,setUnavailable]=useState(false)
 const apply=useCallback((fresh:Snapshot)=>{
  if(session?.signal.aborted||fresh.version<snapshot.current.version)return
  snapshot.current=fresh
  setConfirmed(fresh)
  try{if(key)localStorage.setItem(key,JSON.stringify(fresh))}catch{/* Keep the current view available. */}
 },[key,session])
 const refresh=useCallback(async()=>{
  if(!key||session?.signal.aborted)return
  try{
   const timeout=AbortSignal.timeout(8000)
   const response=await protectedFetch('/api/v1/planner/manual-tasks',{signal:session?AbortSignal.any([timeout,session.signal]):timeout})
   if(!response.ok)throw Error()
   const fresh:Snapshot=await response.json()
   if(!Number.isSafeInteger(fresh.version)||!Array.isArray(fresh.data?.tasks)||!fresh.data.tasks.every(validSharedTask))throw Error()
   if(!session?.signal.aborted){apply(fresh);setReady(true);setUnavailable(false)}
  }catch{if(!session?.signal.aborted)setUnavailable(true)}
 },[apply,key,session])
 useAutomaticRead(()=>void refresh(),['dcc-task-actions-applied','dcc-hermes-created'])
 const writes=useWorkspaceWrites<Change>('task',(receipt)=>{
  if(receipt.state==='saved'&&validSharedTask(receipt.task)&&receipt.version!==undefined&&receipt.version>snapshot.current.version){
   const task=receipt.task
   const tasks=snapshot.current.data.tasks
   apply({version:receipt.version,data:{tasks:tasks.some(current=>current.id===task.id)?tasks.map(current=>current.id===task.id?task:current):[...tasks,task]}})
  }
  void refresh()
 })
 const tasks=new Map(confirmed.data.tasks.map(task=>[task.id,task]))
 for(const job of writes.jobs)if(job.payload)tasks.set(job.payload.task.id,job.payload.task)
 const save=(task:SharedTask)=>writes.submit(task.id,{task,expected:snapshot.current.data.tasks.find(current=>current.id===task.id)??null})
 return {...writes,ready,unavailable,save,tasks:[...tasks.values()],confirmed:confirmed.data.tasks}
}
