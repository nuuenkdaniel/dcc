import type {Pool,PoolClient} from 'pg'
import type {FastifyInstance} from 'fastify'
export type ManualTask={id:string;title:string;date:string;notes:string;completed:boolean;important?:boolean;deleted?:boolean;[key:string]:unknown}
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const validDate=(date:unknown):date is string=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date
function validRecurrence(task:ManualTask){
 if(!Object.hasOwn(task,'recurrence'))return true
 const r=task.recurrence
 if(!r||typeof r!=='object'||Array.isArray(r))return false
 const v=r as Record<string,unknown>
 if(v.version!==1)return false
 if(v.kind==='template')return task.id.length<=80&&Object.keys(v).sort().join(',')==='frequency,kind,paused,startDate,version,weekday'&&v.frequency==='weekly'&&Number.isInteger(v.weekday)&&Number(v.weekday)>=0&&Number(v.weekday)<=6&&validDate(v.startDate)&&typeof v.paused==='boolean'
 return v.kind==='occurrence'&&Object.keys(v).sort().join(',')==='kind,sourceDate,templateId,version'&&typeof v.templateId==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(v.templateId)&&validDate(v.sourceDate)&&task.id===`occ.${v.templateId}.${v.sourceDate}`
}
export function validManualTask(d:ManualTask){return !!d&&typeof d.id==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(d.id)&&typeof d.title==='string'&&!!d.title.trim()&&d.title.length<=240&&typeof d.notes==='string'&&d.notes.length<=4000&&validDate(d.date)&&typeof d.completed==='boolean'&&(d.important===undefined||typeof d.important==='boolean')&&(d.deleted===undefined||typeof d.deleted==='boolean')&&validRecurrence(d)}
// Existing entity storage is UUID keyed; web legacy task IDs are not necessarily UUIDs.
// Keep a single versioned task collection rather than rewriting local identifiers.
const COLLECTION='ccbf2a93-9be3-45bd-b039-1019cdb8276f'
// Caller owns the transaction; use the normal collection lock and retain every
// existing record, tombstone and additive field.
export async function appendHermesTask(c:PoolClient,task:ManualTask){
 if(!validManualTask(task))throw Error('Invalid manual task')
 await c.query('SELECT pg_advisory_xact_lock(817342)')
 const old=await taskSnapshot(c as unknown as Pool),tasks:ManualTask[]=old.data.tasks??[]
 if(tasks.length>=10000||tasks.some(t=>t.id===task.id))throw Error('Task collection cannot accept this task')
 await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'manual-tasks',$2) ON CONFLICT(id) DO UPDATE SET data=$2,version=planner_entities.version+1",[COLLECTION,{...old.data,tasks:[...tasks,task]}])
}
export async function taskSnapshot(pool:Pool){const r=await pool.query('SELECT version,data FROM planner_entities WHERE id=$1 AND kind=$2',[COLLECTION,'manual-tasks']);return r.rows[0]??{version:0,data:{tasks:[]}}}
const comparable=(tasks:ManualTask[])=>canonical(tasks.map(t=>({...t,important:!!t.important,deleted:!!t.deleted})))
export async function saveTasks(pool:Pool,version:number,tasks:ManualTask[]){
 if(!Number.isInteger(version)||version<0||!Array.isArray(tasks)||tasks.length>10000||!tasks.every(validManualTask)||new Set(tasks.map(t=>t.id)).size!==tasks.length)return {code:400,error:'Invalid task collection'}
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(817342)');const old=await taskSnapshot(c as unknown as Pool)
  const previous:ManualTask[]=old.data.tasks??[],incoming=new Map(tasks.map(t=>[t.id,t]))
  for(const prior of previous){
   const next=incoming.get(prior.id),r=prior.recurrence as {kind:string}|undefined,n=next?.recurrence as {kind:string}|undefined
   if((prior.deleted&&!next)||(r&&(!n||r.kind!==n.kind||(r.kind==='occurrence'&&canonical(r)!==canonical(n))))){await c.query('ROLLBACK');return {code:409,error:'Existing tombstones/recurrence metadata cannot be removed or occurrence sources changed',latest:old}}
  }
  // Retain unknown fields omitted by a legacy projection. Explicit supplied values
  // remain versioned edits; recurrence stripping is rejected above, not repaired.
  const byId=new Map(previous.map(t=>[t.id,t]))
  tasks=tasks.map(t=>({...Object.fromEntries(Object.entries(byId.get(t.id)??{}).filter(([key])=>!['id','title','date','notes','completed','important','deleted','sample'].includes(key))),...t}))
  if(comparable(previous)===comparable(tasks)){await c.query('COMMIT');return {code:200,version:old.version}}
 if(old.version!==version){await c.query('ROLLBACK');return {code:409,error:'Tasks changed elsewhere',latest:old}}
 await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'manual-tasks',$2) ON CONFLICT(id) DO UPDATE SET data=$2,version=planner_entities.version+1",[COLLECTION,{tasks}]);await c.query('COMMIT');return {code:200}
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export function manualTaskRoutes(app:FastifyInstance,pool:Pool){
 app.get('/api/v1/planner/manual-tasks',()=>taskSnapshot(pool))
 app.post<{Body:{version:number;tasks:ManualTask[]}}>('/api/v1/planner/manual-tasks',async(req,reply)=>{const result=await saveTasks(pool,req.body?.version,req.body?.tasks);return reply.code(result.code).send(result)})
}
