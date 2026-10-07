import {equalSharedTask,validSharedTask,type SharedTask} from './sharedTasks'

export const TASK_STORAGE_KEY='productivity-app.tasks.v1'
const LOCK_NAME='daymark.manual-tasks.v1'

export class TaskWriteConflict extends Error{}

export type TaskIntent=
 | {kind:'put';task:SharedTask;expected:SharedTask|null}
 | {kind:'delete'|'restore';id:string;expected:SharedTask}

export function readStoredTasks():SharedTask[]{
 const parsed=JSON.parse(localStorage.getItem(TASK_STORAGE_KEY)??'[]')
 if(!Array.isArray(parsed)||!parsed.every(validSharedTask)||new Set(parsed.map(task=>task.id)).size!==parsed.length)throw Error('Invalid task storage; existing data was not changed.')
 return parsed
}

function apply(tasks:SharedTask[],intent:TaskIntent){
 const map=new Map(tasks.map(task=>[task.id,task]))
 const current=map.get(intent.kind==='put'?intent.task.id:intent.id)
 if(!equalSharedTask(current,intent.expected))throw new TaskWriteConflict('Tasks changed in another tab. The newer saved change was retained; review and retry.')
 if(intent.kind==='put')map.set(intent.task.id,{...current,...intent.task})
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
 for(const task of wanted.values())map.set(task.id,{...map.get(task.id),...task})
 return [...map.values()]
}
