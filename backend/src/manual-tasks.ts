import type {Pool} from 'pg'
import type {FastifyInstance} from 'fastify'
export type ManualTask={id:string;title:string;date:string;notes:string;completed:boolean;important?:boolean;deleted?:boolean}
export function validManualTask(d:ManualTask){return !!d&&typeof d.id==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(d.id)&&typeof d.title==='string'&&!!d.title.trim()&&d.title.length<=240&&typeof d.notes==='string'&&d.notes.length<=4000&&typeof d.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&Number.isFinite(Date.parse(d.date))&&new Date(d.date).toISOString().slice(0,10)===d.date&&typeof d.completed==='boolean'&&(d.important===undefined||typeof d.important==='boolean')&&(d.deleted===undefined||typeof d.deleted==='boolean')}
// Existing entity storage is UUID keyed; web legacy task IDs are not necessarily UUIDs.
// Keep a single versioned task collection rather than rewriting local identifiers.
const COLLECTION='ccbf2a93-9be3-45bd-b039-1019cdb8276f'
export async function taskSnapshot(pool:Pool){const r=await pool.query('SELECT version,data FROM planner_entities WHERE id=$1 AND kind=$2',[COLLECTION,'manual-tasks']);return r.rows[0]??{version:0,data:{tasks:[]}}}
export async function saveTasks(pool:Pool,version:number,tasks:ManualTask[]){
 if(!Number.isInteger(version)||version<0||!Array.isArray(tasks)||tasks.length>10000||!tasks.every(validManualTask)||new Set(tasks.map(t=>t.id)).size!==tasks.length)return {code:400,error:'Invalid task collection'}
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(817342)');const old=await taskSnapshot(c as unknown as Pool)
 if(old.version!==version){await c.query('ROLLBACK');return {code:409,error:'Tasks changed elsewhere',latest:old}}
 await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'manual-tasks',$2) ON CONFLICT(id) DO UPDATE SET data=$2,version=planner_entities.version+1",[COLLECTION,{tasks}]);await c.query('COMMIT');return {code:200}
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export function manualTaskRoutes(app:FastifyInstance,pool:Pool){
 app.get('/api/v1/planner/manual-tasks',()=>taskSnapshot(pool))
 app.post<{Body:{version:number;tasks:ManualTask[]}}>('/api/v1/planner/manual-tasks',async(req,reply)=>{const result=await saveTasks(pool,req.body?.version,req.body?.tasks);return reply.code(result.code).send(result)})
}
