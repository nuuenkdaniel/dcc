import {assertRecurrencePreserved,equalSharedTask,validSharedTask,type SharedTask} from './sharedTasks'

export const TASK_STORAGE_KEY='productivity-app.tasks.v1'
const LOCK_NAME='daymark.manual-tasks.v1'
export const PENDING_RESTORE_KEY='dcc.manual-tasks.pending-undo.v1'

export class TaskWriteConflict extends Error{}

// Only an Undo of an already-confirmed tombstone is staged. This tab-local
// intent survives reload; it is not permission to overwrite a changed record.
const validOwner=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value)
export type RestoreAccess={owner:string;signal:AbortSignal;isCurrent:()=>boolean}
export function readPendingTaskRestore():{expected:SharedTask;owner:string|null}|null{
 const raw=sessionStorage.getItem(PENDING_RESTORE_KEY)
 if(raw===null)return null
 const value:unknown=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Pending Undo is unreadable; it was retained.')
 const v=value as Record<string,unknown>
 const keys=Object.keys(v).sort().join(',')
 if(!(v.version===1&&keys==='expected,version'||v.version===2&&keys==='expected,owner,version'&&validOwner(v.owner))||!validSharedTask(v.expected)||v.expected.deleted!==true)throw Error('Pending Undo is unreadable; it was retained.')
 return {expected:v.expected,owner:v.version===2?String(v.owner):null}
}
export function stageTaskRestore(expected:SharedTask,owner:string){
 if(!validOwner(owner))throw new TaskWriteConflict('Verify this workspace by signing in before restoring a task.')
 if(!validSharedTask(expected)||expected.deleted!==true)throw Error('Undo requires a confirmed deleted task.')
 const pending=readPendingTaskRestore()
 if(pending&&(pending.owner!==null&&pending.owner!==owner||!equalSharedTask(pending.expected,expected)))throw new TaskWriteConflict('A pending Undo from another workspace or task is retained; return to its original workspace to review it.')
 // Only an explicit user action may bind an older, unverified v1 intent.
 sessionStorage.setItem(PENDING_RESTORE_KEY,JSON.stringify({version:2,owner,expected}))
}
export async function commitPendingTaskRestore(access:RestoreAccess):Promise<SharedTask[]>{
 const ensureCurrent=()=>{if(access.signal.aborted||!access.isCurrent())throw new DOMException('Undo cancelled; intent retained.','AbortError')}
 ensureCurrent()
 const pending=readPendingTaskRestore(),raw=sessionStorage.getItem(PENDING_RESTORE_KEY)
 if(!pending)return readStoredTasks()
 const ensureOwner=()=>{if(!validOwner(access.owner)||pending.owner!==access.owner)throw new TaskWriteConflict('Pending Undo belongs to another or unverified workspace; retained without applying it.')}
 ensureOwner()
 const expected=pending.expected
 if(!navigator.locks?.request)throw new TaskWriteConflict('Safe task editing requires browser Web Locks. Pending Undo retained; use a supported browser.')
 return navigator.locks.request(LOCK_NAME,{signal:access.signal},()=>{
  ensureCurrent()
  ensureOwner()
  const tasks=readStoredTasks(),current=tasks.find(task=>task.id===expected.id),restored={...expected,deleted:false}
  const latest=sessionStorage.getItem(PENDING_RESTORE_KEY)
  if(latest!==raw&&!(latest===null&&equalSharedTask(current,restored)))throw new TaskWriteConflict('Pending Undo changed while waiting; no task was overwritten.')
  // An interrupted commit may already have applied this exact result. No stale
  // retry may adopt other external edits or strip forward-compatible metadata.
  const saved=equalSharedTask(current,restored)?tasks:apply(tasks,{kind:'restore',id:expected.id,expected})
  ensureCurrent() // Inside the acquired lock, immediately before mutation.
  ensureOwner()
  if(saved!==tasks)localStorage.setItem(TASK_STORAGE_KEY,JSON.stringify(saved))
  ensureCurrent()
  ensureOwner()
  if(sessionStorage.getItem(PENDING_RESTORE_KEY)===raw)sessionStorage.removeItem(PENDING_RESTORE_KEY)
  return saved
 })
}

export type TaskIntent=
 | {kind:'put';task:SharedTask;expected:SharedTask|null}
 | {kind:'delete'|'restore';id:string;expected:SharedTask}

export function readStoredTasks():SharedTask[]{
 const parsed=JSON.parse(localStorage.getItem(TASK_STORAGE_KEY)??'[]')
 if(!Array.isArray(parsed)||parsed.length>10000||!parsed.every(validSharedTask)||new Set(parsed.map(task=>task.id)).size!==parsed.length)throw Error('Invalid task storage; existing data was not changed.')
 return parsed
}

function apply(tasks:SharedTask[],intent:TaskIntent){
 const map=new Map(tasks.map(task=>[task.id,task]))
 const current=map.get(intent.kind==='put'?intent.task.id:intent.id)
 if(!equalSharedTask(current,intent.expected))throw new TaskWriteConflict('Tasks changed in another tab. The newer saved change was retained; review and retry.')
 if(intent.kind==='put'){assertRecurrencePreserved(current,intent.task);map.set(intent.task.id,{...current,...intent.task})}
 else if(intent.kind==='delete')map.set(intent.id,{...intent.expected,deleted:true})
 else map.set(intent.id,{...intent.expected,deleted:false})
 return [...map.values()]
}

export async function applyTaskIntents(intents:TaskIntent[]):Promise<SharedTask[]>{
 if(!navigator.locks?.request)throw new TaskWriteConflict('Safe task editing requires browser Web Locks. No changes were written; use a supported browser or review the task in another tab.')
 if(intents.some(intent=>(intent.expected!==null&&!validSharedTask(intent.expected))||(intent.kind==='put'&&!validSharedTask(intent.task))))throw Error('Invalid task change; existing data was not changed.')
 return navigator.locks.request(LOCK_NAME,()=>{
  let tasks=readStoredTasks()
  for(const intent of intents)tasks=apply(tasks,intent)
  if(tasks.length>10000)throw Error('Task collection exceeds 10000 records; existing data was not changed.')
  localStorage.setItem(TASK_STORAGE_KEY,JSON.stringify(tasks))
  return tasks
 })
}

export const applyTaskIntent=(intent:TaskIntent)=>applyTaskIntents([intent])

export function taskIntents(previous:SharedTask[],requested:SharedTask[]):TaskIntent[]{
 const before=new Map(previous.map(task=>[task.id,task]))
 // Last entry wins so the existing Undo UI can append the restored record.
 const after=new Map(requested.filter(task=>!task.sample).map(task=>[task.id,task]))
 const intents:TaskIntent[]=[]
 for(const [id,old] of before){
  const next=after.get(id)
  if(!next){if(!old.deleted)intents.push({kind:'delete',id,expected:old});continue}
  if(equalSharedTask(old,next))continue
  if(next.deleted&&!old.deleted)intents.push({kind:'delete',id,expected:old})
  else if(old.deleted&&!next.deleted)intents.push({kind:'restore',id,expected:old})
  else intents.push({kind:'put',task:next,expected:old})
 }
 for(const [id,task] of after)if(!before.has(id))intents.push({kind:'put',task,expected:null})
 return intents
}

export function requestedTasks(previous:SharedTask[],requested:SharedTask[]){
 const map=new Map(previous.map(task=>[task.id,task]))
 const wanted=new Map(requested.filter(task=>!task.sample).map(task=>[task.id,task]))
 for(const [id,old] of map)if(!wanted.has(id)&&!old.deleted)map.set(id,{...old,deleted:true})
 for(const task of wanted.values()){assertRecurrencePreserved(map.get(task.id),task);map.set(task.id,{...map.get(task.id),...task})}
 return [...map.values()]
}
