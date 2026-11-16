import {useRef,useState,useCallback} from 'react'
import {protectedFetch} from './auth'
import {useWorkspaceSession} from './workspaceSession'
import {useAutomaticRead,useWorkspaceWrites} from './workspaceWrites'
export type Project={origin?:'hermes';planSummary?:string;planError?:string;kind?:'assignment'|'project';resources?:{name:string;text:string}[];id:string;title:string;category:string;description:string;deadline:string;importance:number;remainingMinutes:number;progress:string;status:string}
export type Exam={id:string;calendarId:string;uid:string;recurrenceId:string|null;start:string;allDay:boolean;title:string}
export type Topic={id:string;title:string;notes:string;minutes:number}
export type Preparation={id:string;title:string;event:Exam;startDate:string;status:string;topics:Topic[];progress:string}
export type Action={source?:'manual-project';origin?:'hermes';needsRescheduling?:boolean;assignmentStep?:boolean;id:string;projectId:string;preparationId?:string;topicId?:string;feedback?:string;important?:boolean;title:string;notes:string;minutes:number;date:string;completed:boolean;dismissed:boolean}
export type Entry<T>={kind:string;version:number;data:T}
type Change={kind:'project'|'action'|'preparation';version:number;data:Project|Action|Preparation}
type Snapshot={preparations?:Entry<Preparation>[];projects:Entry<Project>[];actions:Entry<Action>[];status:{summary?:string;error?:string;requested?:boolean;last_success?:string}}
type Cache={snapshot:Snapshot;pending:Change[]}
async function plannerFetch(path:string,options:RequestInit={}){return protectedFetch(path,{...options,signal:AbortSignal.timeout(10000)})}
const key='daymark.planner.v1'
const empty:Cache={snapshot:{projects:[],actions:[],status:{}},pending:[]}
function read():Cache{const text=localStorage.getItem(key);if(!text)return empty;const c=JSON.parse(text);if(!Array.isArray(c.pending)||!Array.isArray(c.snapshot?.projects)||!Array.isArray(c.snapshot?.actions))throw Error('Invalid cache');return c}
export function usePlanner(){
 const session=useWorkspaceSession()
 const keyForOwner=session?.owner?`dcc.confirmed.planner.${session.owner}`:null
 const [snapshot,setSnapshot]=useState<Snapshot>(()=>{
  try{return keyForOwner?JSON.parse(localStorage.getItem(keyForOwner)??'null')??empty.snapshot:empty.snapshot}catch{return empty.snapshot}
 })
 const [legacy]=useState(()=>{try{return read().pending}catch{return []}})
 const ref=useRef(snapshot),generation=useRef(0)
 const [loadState,setLoadState]=useState<'loading'|'ready'|'offline'|'signed-out'|'storage-error'>('loading')
 const [message,setMessage]=useState('')
 const publish=useCallback((fresh:Snapshot)=>{
  if(session?.signal.aborted)return
  ref.current=fresh
  setSnapshot(fresh)
  try{if(keyForOwner)localStorage.setItem(keyForOwner,JSON.stringify(fresh))}catch{/* Keep the confirmed view in memory. */}
 },[keyForOwner,session])
 const sync=useCallback(async(_silent=false)=>{
  if(!keyForOwner)return
  const id=++generation.current
  try{
   const timeout=AbortSignal.timeout(10000)
   const response=await protectedFetch('/api/v1/planner/snapshot',{signal:session?AbortSignal.any([session.signal,timeout]):timeout})
   if(!response.ok)throw Error()
   const fresh:Snapshot=await response.json()
   if(id!==generation.current||session?.signal.aborted)return
   if(!Array.isArray(fresh.projects)||!Array.isArray(fresh.actions))throw Error()
   publish(fresh)
   setLoadState('ready')
  }catch{if(id===generation.current&&!session?.signal.aborted)setLoadState('offline')}
 },[keyForOwner,publish,session])
 useAutomaticRead(()=>void sync(true),['dcc-project-actions-applied','dcc-hermes-created'])
 const writes=useWorkspaceWrites<Change>('planner',(receipt)=>{
  if(receipt.state==='saved'&&receipt.entry){
   const entry=receipt.entry as Entry<Project|Action|Preparation>
   const previous=ref.current
   const merge=<T,>(items:Entry<T>[])=>items.some(row=>row.data===entry.data||((row.data as {id:string}).id===entry.data.id&&row.version>entry.version))?items:[...items.filter(row=>(row.data as {id:string}).id!==entry.data.id),entry as Entry<T>]
   if(entry.kind==='project')publish({...previous,projects:merge(previous.projects)})
   if(entry.kind==='action')publish({...previous,actions:merge(previous.actions)})
   if(entry.kind==='preparation')publish({...previous,preparations:merge(previous.preparations??[])})
  }
  void sync(true)
 })
 const all=[...(snapshot.preparations??[]),...snapshot.projects,...snapshot.actions]
 const versionOf=(id:string)=>all.find(e=>e.data.id===id)?.version??0
 const disabled=!writes.online||loadState!=='ready'
 const save=(kind:Change['kind'],data:Change['data'],baseVersion?:number)=>{
  if(disabled){setMessage('Connect to make changes');return false}
  setMessage('')
  return writes.submit(data.id,{kind,version:baseVersion??versionOf(data.id),data})
 }
 const preparations=new Map((snapshot.preparations??[]).map(e=>[e.data.id,e.data]))
 const projects=new Map(snapshot.projects.map(e=>[e.data.id,e.data]))
 const actions=new Map(snapshot.actions.map(e=>[e.data.id,e.data]))
 for(const {payload} of writes.jobs){
  if(payload?.kind==='project')projects.set(payload.data.id,payload.data as Project)
  if(payload?.kind==='preparation')preparations.set(payload.data.id,payload.data as Preparation)
  if(payload?.kind==='action')actions.set(payload.data.id,payload.data as Action)
 }
 const refresh=async()=>{
  if(disabled){setMessage('Connect to make changes');return}
  try{
   const response=await plannerFetch('/api/v1/planner/refresh',{method:'POST'})
   if(!response.ok)throw Error()
   setMessage('Plan requested.')
   await sync(true)
  }catch{setMessage('Could not request a plan.')}
 }
 const legacyChanges=legacy.filter(change=>!all.some(entry=>entry.data.id===change.data.id&&Object.entries(change.data).every(([key,value])=>JSON.stringify(entry.data[key as keyof typeof entry.data])===JSON.stringify(value))))
 return {loadState,versionOf,preparations:[...preparations.values()],projects:[...projects.values()],actions:[...actions.values()],status:snapshot.status??{},pending:writes.jobs.length,message:message||writes.message,save,sync,refresh,disabled,legacyChanges,failed:writes.failed,pendingIds:new Set(writes.jobs.map(job=>job.watch.key))}
}
export type Planner=ReturnType<typeof usePlanner>

export function studyCardCount(actions:Action[]){return actions.filter(a=>!a.preparationId&&!a.assignmentStep).length+new Set(actions.filter(a=>a.preparationId||a.assignmentStep).map(a=>a.preparationId??a.projectId)).size}

export function visiblePlanGroups(p:Planner,date:string,filter:string,search:string){
 return visibleActionGroups(p,p.actions.filter(a=>a.date===date&&!a.dismissed),filter,search)
}

export function visibleActionGroups(p:Planner,actions:Action[],filter:string,search:string){
 const groups=new Map<string,Action[]>()
 for(const a of actions){const key=a.preparationId??(a.assignmentStep?a.projectId:a.id);groups.set(key,[...(groups.get(key)??[]),a])}
 return [...groups.values()].filter(group=>{
 const done=group.every(a=>a.completed),important=group.some(a=>a.important)
 const title=group[0].preparationId?'Study for '+(p.preparations.find(x=>x.id===group[0].preparationId)?.title??'Exam'):group[0].assignmentStep?'Work on '+(p.projects.find(x=>x.id===group[0].projectId)?.title??'Assignment'):group[0].title
 const text=[title,...group.map(a=>a.title+' '+a.notes)].join(' ').toLowerCase()
 return text.includes(search.toLowerCase())&&(filter==='All'||filter==='Open'&&!done||filter==='Completed'&&done||filter==='Important'&&important)
 }).sort((a,b)=>Number(b.some(x=>x.important))-Number(a.some(x=>x.important)))
}
