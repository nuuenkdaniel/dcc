import {useEffect,useRef,useState,useCallback} from 'react'
import {protectedFetch} from './auth'
export type Project={planSummary?:string;planError?:string;kind?:'assignment'|'project';resources?:{name:string;text:string}[];id:string;title:string;category:string;description:string;deadline:string;importance:number;remainingMinutes:number;progress:string;status:string}
export type Exam={id:string;calendarId:string;uid:string;recurrenceId:string|null;start:string;allDay:boolean;title:string}
export type Topic={id:string;title:string;notes:string;minutes:number}
export type Preparation={id:string;title:string;event:Exam;startDate:string;status:string;topics:Topic[];progress:string}
export type Action={needsRescheduling?:boolean;assignmentStep?:boolean;id:string;projectId:string;preparationId?:string;topicId?:string;feedback?:string;important?:boolean;title:string;notes:string;minutes:number;date:string;completed:boolean;dismissed:boolean}
export type Entry<T>={kind:string;version:number;data:T}
type Change={kind:'project'|'action'|'preparation';version:number;data:Project|Action|Preparation}
type Snapshot={preparations?:Entry<Preparation>[];projects:Entry<Project>[];actions:Entry<Action>[];status:{summary?:string;error?:string;requested?:boolean;last_success?:string}}
type Cache={snapshot:Snapshot;pending:Change[]}
async function plannerFetch(path:string,options:RequestInit={}){return protectedFetch(path,{...options,signal:AbortSignal.timeout(10000)})}
const key='daymark.planner.v1'
const empty:Cache={snapshot:{projects:[],actions:[],status:{}},pending:[]}
function read():Cache{const text=localStorage.getItem(key);if(!text)return empty;const c=JSON.parse(text);if(!Array.isArray(c.pending)||!Array.isArray(c.snapshot?.projects)||!Array.isArray(c.snapshot?.actions))throw Error('Invalid cache');return c}
export function usePlanner(){
 const [initial]=useState(()=>{try{return {cache:read(),error:false}}catch{return {cache:empty,error:true}}})
 const [syncing,setSyncing]=useState(false)
 const [loadState,setLoadState]=useState<'loading'|'ready'|'offline'|'signed-out'|'storage-error'>(initial.error?'storage-error':'loading')
 const [lastSynced,setLastSynced]=useState<string|null>(null)
 const [cache,setCache]=useState(initial.cache),ref=useRef(initial.cache),busy=useRef(false)
 const [message,setMessage]=useState(initial.error?'Planner storage cannot be read; editing paused to protect it.':''),[conflict,setConflict]=useState<Change|null>(null)
 const commit=useCallback((next:Cache)=>{try{localStorage.setItem(key,JSON.stringify(next));if(JSON.stringify(ref.current)!==JSON.stringify(next)){ref.current=next;setCache(next);}return true}catch{setMessage('Could not save in this browser. Free storage before editing.');return false}},[])
 const sync=useCallback(async(silent=false)=>{
  if(busy.current||initial.error)return
  busy.current=true
  if(!silent){setSyncing(true);setMessage('Syncing projects and tasks…')}
  try{
   const response=await plannerFetch('/api/v1/planner/snapshot',{credentials:'same-origin'})
   if(response.status===401){setLoadState('signed-out');setMessage('Sign in once to sync projects and curated actions.');return}
   if(!response.ok)throw Error()
   let snapshot:Snapshot=await response.json()
   if(!commit({...ref.current,snapshot})){setLoadState('storage-error');return}
   setLoadState('ready')
   while(ref.current.pending.length){
    const next=ref.current.pending[0]
    const r=await plannerFetch('/api/v1/planner/entity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)})
    if(r.status===409){setConflict(next);setMessage('A record changed elsewhere. Review both versions before resolving.');return}
    if(!r.ok){setMessage(r.status===400?'Draft has invalid fields. Edit it before syncing.':'Offline or signed out. Saved drafts will retry.');return}
    const fresh=await plannerFetch('/api/v1/planner/snapshot');if(!fresh.ok)throw Error();snapshot=await fresh.json()
    const saved=[...(snapshot.preparations??[]),...snapshot.projects,...snapshot.actions].find(e=>e.data.id===next.data.id)
    const pending=ref.current.pending.flatMap(p=>p===next?[]:p.data.id===next.data.id?[{...p,version:saved?.version??p.version}]:[p])
    if(!commit({snapshot,pending}))return
   }
   setConflict(null);if(!silent)setLastSynced(new Date().toLocaleTimeString());setMessage('Projects and curated actions are up to date.')
  }catch{setLoadState('offline');setMessage('Offline — cached projects and actions remain available. Drafts will retry.')}finally{busy.current=false;setSyncing(false)}
 },[commit,initial.error])
 useEffect(()=>{queueMicrotask(()=>void sync(true));const timer=setInterval(()=>void sync(true),30000);const online=()=>void sync(true);const visible=()=>{if(document.visibilityState==='visible')online()};window.addEventListener('online',online);window.addEventListener('focus',online);window.addEventListener('dcc-auth-changed',online);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('focus',online);window.removeEventListener('dcc-auth-changed',online);document.removeEventListener('visibilitychange',visible)}},[sync])
 const save=(kind:Change['kind'],data:Change['data'],baseVersion?:number)=>{
  if(initial.error)return false
  const old=ref.current.pending.find(p=>p.data.id===data.id),entry=[...(ref.current.snapshot.preparations??[]),...ref.current.snapshot.projects,...ref.current.snapshot.actions].find(e=>e.data.id===data.id)
  const next={kind,version:old?.version??baseVersion??entry?.version??0,data}
  const ok=commit({...ref.current,pending:[...ref.current.pending.filter(p=>p.data.id!==data.id),next]});if(ok)void sync();return ok
 }
 const preparations=new Map((cache.snapshot.preparations??[]).map(e=>[e.data.id,e.data]))
 const projects=new Map(cache.snapshot.projects.map(e=>[e.data.id,e.data])),actions=new Map(cache.snapshot.actions.map(e=>[e.data.id,e.data]))
 for(const p of cache.pending){if(p.kind==='project')projects.set(p.data.id,p.data as Project);else if(p.kind==='preparation')preparations.set(p.data.id,p.data as Preparation);else actions.set(p.data.id,p.data as Action)}
 const resolve=(keep:boolean)=>{if(!conflict)return;const latest=[...(ref.current.snapshot.preparations??[]),...ref.current.snapshot.projects,...ref.current.snapshot.actions].find(e=>e.data.id===conflict.data.id);commit({...ref.current,pending:ref.current.pending.flatMap(p=>p.data.id!==conflict.data.id?[p]:keep?[{...p,version:latest?.version??0}]:[])});setConflict(null);void sync()}
 const refresh=async()=>{await sync();if(ref.current.pending.length){setMessage('Sync or resolve saved drafts before generating a plan.');return}try{const r=await plannerFetch('/api/v1/planner/refresh',{method:'POST'});if(!r.ok)throw Error();setMessage('Plan requested. The worker will pick it up shortly.');await sync()}catch{setMessage('Could not request a plan. Sign in and check the backend connection.')}}
 const versionOf=(id:string)=>ref.current.pending.find(e=>e.data.id===id)?.version??[...(ref.current.snapshot.preparations??[]),...ref.current.snapshot.projects,...ref.current.snapshot.actions].find(e=>e.data.id===id)?.version??0
 return {loadState,syncing,lastSynced,versionOf,preparations:[...preparations.values()],projects:[...projects.values()],actions:[...actions.values()],status:cache.snapshot.status,pending:cache.pending.length,message,save,sync,refresh,conflict,latest:conflict?[...(cache.snapshot.preparations??[]),...cache.snapshot.projects,...cache.snapshot.actions].find(e=>e.data.id===conflict.data.id)?.data:null,resolve,disabled:initial.error}
}
export type Planner=ReturnType<typeof usePlanner>

export function studyCardCount(actions:Action[]){return actions.filter(a=>!a.preparationId&&!a.assignmentStep).length+new Set(actions.filter(a=>a.preparationId||a.assignmentStep).map(a=>a.preparationId??a.projectId)).size}

export function visiblePlanGroups(p:Planner,date:string,filter:string,search:string){
 const groups=new Map<string,Action[]>()
 for(const a of p.actions.filter(a=>a.date===date&&!a.dismissed)){const key=a.preparationId??(a.assignmentStep?a.projectId:a.id);groups.set(key,[...(groups.get(key)??[]),a])}
 return [...groups.values()].filter(group=>{
 const done=group.every(a=>a.completed),important=group.some(a=>a.important)
 const title=group[0].preparationId?'Study for '+(p.preparations.find(x=>x.id===group[0].preparationId)?.title??'Exam'):group[0].assignmentStep?'Work on '+(p.projects.find(x=>x.id===group[0].projectId)?.title??'Assignment'):group[0].title
 const text=[title,...group.map(a=>a.title+' '+a.notes)].join(' ').toLowerCase()
 return text.includes(search.toLowerCase())&&(filter==='All'||filter==='Open'&&!done||filter==='Completed'&&done||filter==='Important'&&important)
 }).sort((a,b)=>Number(b.some(x=>x.important))-Number(a.some(x=>x.important)))
}
