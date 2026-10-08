export type SharedTask={id:string;title:string;date:string;notes:string;completed:boolean;important?:boolean;deleted?:boolean;sample?:boolean;[key:string]:unknown}
export const equalSharedTask=(a:SharedTask|undefined|null,b:SharedTask|undefined|null)=>a==null||b==null?a==null&&b==null:a.id===b.id&&a.title===b.title&&a.date===b.date&&a.notes===b.notes&&a.completed===b.completed&&!!a.important===!!b.important&&!!a.deleted===!!b.deleted
export function validSharedTask(value:unknown):value is SharedTask{
 if(!value||typeof value!=='object')return false
 const task=value as Partial<SharedTask>
 return typeof task.id==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(task.id)&&typeof task.title==='string'&&!!task.title.trim()&&task.title.length<=240&&typeof task.notes==='string'&&task.notes.length<=4000&&typeof task.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(task.date)&&Number.isFinite(Date.parse(task.date))&&new Date(task.date).toISOString().slice(0,10)===task.date&&typeof task.completed==='boolean'&&(task.important===undefined||typeof task.important==='boolean')&&(task.deleted===undefined||typeof task.deleted==='boolean')&&(task.sample===undefined||typeof task.sample==='boolean')
}
export function mergeTasks(base:SharedTask[],local:SharedTask[],remote:SharedTask[],choice?:'local'|'remote'){
 const b=new Map(base.map(t=>[t.id,t])),l=new Map(local.filter(t=>!t.sample).map(t=>[t.id,t])),r=new Map(remote.map(t=>[t.id,t]))
 const tasks:SharedTask[]=[],conflicts:string[]=[]
 for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
  const old=b.get(id)
  let mine=l.get(id),theirs=r.get(id)
  // Older clients express deletion by omitting an item. Translate that legacy
  // contract to a tombstone, and never treat omission as safe compaction.
  if(old&&!mine)mine=old.deleted?old:{...old,deleted:true}
  if(old&&!theirs)theirs=old.deleted?old:{...old,deleted:true}
  let picked:SharedTask|undefined
  if(!old&&mine&&theirs&&mine.deleted!==theirs.deleted)picked=mine.deleted?mine:theirs
  else if(equalSharedTask(mine,old))picked=theirs
  else if(equalSharedTask(theirs,old)||equalSharedTask(mine,theirs))picked=mine
  else {conflicts.push(id);picked=choice==='remote'?theirs:mine}
  if(picked)tasks.push(picked)
 }
 return {tasks,conflicts}
}
