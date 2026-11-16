import {useCallback,useEffect,useRef,useState} from 'react'
import {protectedFetch} from './auth'
import {useWorkspaceSession} from './workspaceSession'

type Kind='task'|'planner'|'calendar'
type Receipt={state:'saving'|'saved'|'failed'|'unconfirmed';task?:unknown;entry?:unknown;event?:unknown;version?:number;code?:number;previousEventId?:string}
type Watch={id:string;key:string;started:number}
type Job<T>={watch:Watch;payload?:T;hidden?:boolean}
const endpoint='/api/v1/workspace/writes'
const activeDrafts=new Map<string,unknown>()

export function useOnline(){
 const [online,setOnline]=useState(()=>navigator.onLine)
 useEffect(()=>{
  const update=()=>setOnline(navigator.onLine)
  window.addEventListener('online',update)
  window.addEventListener('offline',update)
  return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}
 },[])
 return online
}

export function useWorkspaceWrites<T>(kind:Kind,onSettled:(receipt:Receipt,payload:T|undefined)=>void){
 const session=useWorkspaceSession()
 const owner=session?.owner
 const signal=session?.signal
 const key=owner?`dcc.write-receipts.${kind}.${owner}`:null
 const online=useOnline()
 const [jobs,setJobs]=useState(():Job<T>[]=>{
  if(!key)return []
  try{
   return Object.keys(localStorage).filter(item=>item.startsWith(key+'.')).flatMap(item=>{
    const watch=JSON.parse(localStorage.getItem(item)??'null') as Watch|null
    return watch&&/^[0-9a-f-]{36}$/.test(watch.id)&&typeof watch.key==='string'&&Number.isFinite(watch.started)?[{watch,payload:activeDrafts.get(item) as T|undefined}]:[]
   })
  }catch{return []}
 })
 const pending=useRef(jobs)
 const mounted=useRef(false)
 useEffect(()=>{
  mounted.current=true
  const clear=()=>{if(key)for(const draft of activeDrafts.keys())if(draft.startsWith(key+'.'))activeDrafts.delete(draft)}
  signal?.addEventListener('abort',clear,{once:true})
  return()=>{mounted.current=false;signal?.removeEventListener('abort',clear)}
 },[key,signal])
 const settled=useRef(onSettled)
 const busy=useRef(new Set<string>())
 const [message,setMessage]=useState('')
 const [failed,setFailed]=useState<T>()
 useEffect(()=>{settled.current=onSettled},[onSettled])
 const update=useCallback((next:Job<T>[])=>{
  pending.current=next
  setJobs(next)
 },[])
 const receive=useCallback(async(response:Response,job:Job<T>,isStatus:boolean)=>{
  if(!mounted.current||signal?.aborted||!pending.current.some(item=>item.watch.id===job.watch.id))return
  let receipt:Receipt
  if(response.status===404&&isStatus){
   if(Date.now()-job.watch.started<60000)return
   receipt={state:'failed'}
  }else{
   if(response.status===401||response.status>=500)return
   receipt=await response.json().catch(()=>({state:'failed'})) as Receipt
  }
  if(!mounted.current||signal?.aborted||!pending.current.some(item=>item.watch.id===job.watch.id))return
  if(!['saving','unconfirmed','saved','failed'].includes(receipt.state))return
  if(receipt.state==='saving'||receipt.state==='unconfirmed'){
   if(receipt.state==='unconfirmed'){
    setMessage('Save not confirmed yet. Checking automatically.')
    if(pending.current.some(item=>item.watch.id===job.watch.id&&!item.hidden)){
     update(pending.current.map(item=>item.watch.id===job.watch.id?{...item,hidden:true}:item))
    }
   }
   return
  }
  const finish=()=>{
   if(!mounted.current||signal?.aborted||!pending.current.some(item=>item.watch.id===job.watch.id))return
   if(key)activeDrafts.delete(key+'.'+job.watch.id)
   let announce=!!job.payload
   try{
    if(key&&localStorage.getItem(key+'.'+job.watch.id)){announce=true;localStorage.removeItem(key+'.'+job.watch.id)}
   }catch{/* The initiating tab can still show the result. */}
   if(announce)setMessage(receipt.state==='saved'?'Saved':receipt.code===409?'Changed elsewhere. Review and try again.':`Couldn’t sync this ${kind==='planner'?'change':kind==='calendar'?'event':'task'}.`)
   if(receipt.state!=='saved'&&job.payload)setFailed(job.payload)
   settled.current(receipt,job.payload)
   update(pending.current.filter(item=>item.watch.id!==job.watch.id))
  }
  if(navigator.locks?.request)await navigator.locks.request('dcc-write-receipt:'+job.watch.id,finish)
  else finish()
 },[key,kind,signal,update])
 useEffect(()=>{
  if(!online||!owner)return
  const check=()=>{
   for(const job of pending.current){
    const id=job.watch.id
    if(busy.current.has(id))continue
    busy.current.add(id)
    const timeout=AbortSignal.timeout(10000)
    const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout
    void protectedFetch(`${endpoint}/${id}`,{signal:requestSignal}).then(r=>receive(r,job,true))
     .catch(()=>{}).finally(()=>busy.current.delete(id))
   }
  }
  check()
  const timer=window.setInterval(check,2000)
  window.addEventListener('focus',check)
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',check)}
 },[online,owner,signal,receive])
 const submit=(entityKey:string,payload:T,id:string=crypto.randomUUID())=>{
  if(!owner||signal?.aborted||!navigator.onLine){setMessage('Connect to make changes');return false}
  if(pending.current.some(item=>item.watch.key===entityKey))return false
  const job={watch:{id,key:entityKey,started:Date.now()},payload}
  setMessage('')
  setFailed(undefined)
  if(key)activeDrafts.set(key+'.'+id,payload)
  try{if(key)localStorage.setItem(key+'.'+id,JSON.stringify(job.watch))}catch{/* The operation can still settle in this tab. */}
  update([...pending.current,job])
  busy.current.add(id)
  const timeout=AbortSignal.timeout(15000)
  void protectedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Dcc-Workspace-Owner':owner},
   signal:signal?AbortSignal.any([signal,timeout]):timeout,body:JSON.stringify({id,kind,payload})})
   .then(response=>receive(response,job,false)).catch(()=>{}).finally(()=>busy.current.delete(id))
  return true
 }
 return {submit,jobs:online?jobs.filter(job=>!job.hidden):[],message,failed,clearFailure:()=>setFailed(undefined),online}
}

export function useAutomaticRead(refresh:()=>void,events:string[],interval=15000){
 const latest=useRef(refresh)
 useEffect(()=>{latest.current=refresh},[refresh])
 const eventNames=events.join(' ')
 useEffect(()=>{
  const read=()=>{if(document.visibilityState!=='hidden')latest.current()}
  const subscriptions=[...eventNames.split(' ').filter(Boolean),'focus','online']
  const timer=window.setInterval(read,interval)
  subscriptions.forEach(event=>window.addEventListener(event,read))
  document.addEventListener('visibilitychange',read)
  queueMicrotask(read)
  return()=>{
   clearInterval(timer)
   subscriptions.forEach(event=>window.removeEventListener(event,read))
   document.removeEventListener('visibilitychange',read)
  }
 },[eventNames,interval])
}
