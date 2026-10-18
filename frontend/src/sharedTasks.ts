export type SharedTask={id:string;title:string;date:string;notes:string;completed:boolean;important?:boolean;deleted?:boolean;sample?:boolean;[key:string]:unknown}
// JSON object order is not meaningful; array order and every additive field are.
export function canonicalTaskJson(value:unknown):string{
 return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
}
export const equalSharedTask=(a:SharedTask|undefined|null,b:SharedTask|undefined|null)=>a==null||b==null?a==null&&b==null:canonicalTaskJson({...a,important:!!a.important,deleted:!!a.deleted,sample:!!a.sample})===canonicalTaskJson({...b,important:!!b.important,deleted:!!b.deleted,sample:!!b.sample})
const validDate=(date:unknown):date is string=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date
export type TaskRecurrence=
 | {version:1;kind:'template';frequency:'weekly';weekday:number;startDate:string;paused:boolean}
 | {version:1;kind:'occurrence';templateId:string;sourceDate:string}
export function validTaskRecurrence(task:{id:string;recurrence?:unknown}):boolean{
 if(!Object.hasOwn(task,'recurrence'))return true
 const r=task.recurrence
 if(!r||typeof r!=='object'||Array.isArray(r))return false
 const v=r as Record<string,unknown>
 if(v.version!==1)return false
 if(v.kind==='template')return task.id.length<=80&&Object.keys(v).sort().join(',')==='frequency,kind,paused,startDate,version,weekday'&&v.frequency==='weekly'&&Number.isInteger(v.weekday)&&Number(v.weekday)>=0&&Number(v.weekday)<=6&&validDate(v.startDate)&&typeof v.paused==='boolean'
 return v.kind==='occurrence'&&Object.keys(v).sort().join(',')==='kind,sourceDate,templateId,version'&&typeof v.templateId==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(v.templateId)&&validDate(v.sourceDate)&&task.id===`occ.${v.templateId}.${v.sourceDate}`
}
export function assertRecurrencePreserved(old:SharedTask|undefined,next:SharedTask|undefined){
 if(!old||!Object.hasOwn(old,'recurrence'))return
 const before=old.recurrence as TaskRecurrence,after=next?.recurrence as TaskRecurrence|undefined
 if(!after||before.kind!==after.kind||(before.kind==='occurrence'&&canonicalTaskJson(before)!==canonicalTaskJson(after)))throw Error('Existing recurrence metadata cannot be removed or its occurrence source changed. Use a compatible client; saved tasks were retained.')
}
export function validSharedTask(value:unknown):value is SharedTask{
 if(!value||typeof value!=='object')return false
 const task=value as Partial<SharedTask>
 return typeof task.id==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(task.id)&&typeof task.title==='string'&&!!task.title.trim()&&task.title.length<=240&&typeof task.notes==='string'&&task.notes.length<=4000&&validDate(task.date)&&typeof task.completed==='boolean'&&(task.important===undefined||typeof task.important==='boolean')&&(task.deleted===undefined||typeof task.deleted==='boolean')&&(task.sample===undefined||typeof task.sample==='boolean')&&validTaskRecurrence(task as SharedTask)
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
  assertRecurrencePreserved(old,mine);assertRecurrencePreserved(old,theirs)
  // Also protect first contact between a stripped old client and a newer peer.
  if(mine&&theirs){assertRecurrencePreserved(mine,theirs);assertRecurrencePreserved(theirs,mine)}
  let picked:SharedTask|undefined
  if(!old&&mine&&theirs&&mine.deleted!==theirs.deleted)picked=mine.deleted?mine:theirs
  else if(equalSharedTask(mine,old))picked=theirs
  else if(equalSharedTask(theirs,old)||equalSharedTask(mine,theirs))picked=mine
  else {conflicts.push(id);picked=choice==='remote'?theirs:mine}
  if(picked){
   const additive=Object.fromEntries(Object.entries(old??{}).filter(([key])=>!['id','title','date','notes','completed','important','deleted','sample'].includes(key)))
   tasks.push({...additive,...picked})
  }
 }
 return {tasks,conflicts}
}
