export type SharedTask={id:string;title:string;date:string;notes:string;completed:boolean;important?:boolean;deleted?:boolean;sample?:boolean}
const equal=(a:SharedTask|undefined,b:SharedTask|undefined)=>a===undefined||b===undefined?a===b:a.id===b.id&&a.title===b.title&&a.date===b.date&&a.notes===b.notes&&a.completed===b.completed&&!!a.important===!!b.important&&!!a.deleted===!!b.deleted
export function mergeTasks(base:SharedTask[],local:SharedTask[],remote:SharedTask[],choice?:'local'|'remote'){
 const b=new Map(base.map(t=>[t.id,t])),l=new Map(local.filter(t=>!t.sample).map(t=>[t.id,t])),r=new Map(remote.map(t=>[t.id,t]))
 const tasks:SharedTask[]=[],conflicts:string[]=[]
 for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
  const old=b.get(id),mine=l.get(id),theirs=r.get(id)
  let picked:SharedTask|undefined
  if(equal(mine,old))picked=theirs
  else if(equal(theirs,old)||equal(mine,theirs))picked=mine
  else {conflicts.push(id);picked=choice==='remote'?theirs:mine}
  if(picked)tasks.push(picked)
 }
 return {tasks,conflicts}
}
