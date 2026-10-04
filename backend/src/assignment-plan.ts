import {randomUUID} from 'node:crypto'
import type {Pool} from 'pg'
import {budgetForDay,easternDay} from './planner-policy.js'
import {callCurator} from './planner.js'
export async function planAssignments(pool:Pool,generate=callCurator){
 const c=await pool.connect();let locked=false
 try{
 locked=(await c.query('SELECT pg_try_advisory_lock(817342) ok')).rows[0].ok;if(!locked)return
 const projects=(await c.query("SELECT id,version,data FROM planner_entities WHERE kind='project' AND data->>'kind'='assignment' AND data->>'status'='active' ORDER BY data->>'deadline'")).rows
 for(const p of projects){
 if((await c.query("SELECT 1 FROM planner_entities WHERE kind='action' AND data->>'projectId'=$1 LIMIT 1",[p.id])).rowCount)continue
 if(p.data.planRetryAt&&Date.parse(p.data.planRetryAt)>Date.now())continue
 try{
 const calendar=(await c.query('SELECT snapshot,last_success FROM calendar_sync_state WHERE id=1')).rows[0];if(!calendar?.last_success||Date.now()-Date.parse(calendar.last_success)>86400000)throw Error('Calendar unavailable')
 const raw=await generate({mode:'assignment',assignment:p.data}) as {steps:{title:string;notes:string;minutes:number}[];summary:string}
 if(!raw||!Array.isArray(raw.steps)||raw.steps.length<1||raw.steps.length>60||typeof raw.summary!=='string'||raw.summary.length>4000||raw.steps.some(s=>typeof s.title!=='string'||!s.title.trim()||s.title.length>240||typeof s.notes!=='string'||s.notes.length>4000||!Number.isInteger(s.minutes)||s.minutes<5||s.minutes>180))throw Error('Invalid breakdown')
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(817340)')
 const fresh=(await c.query('SELECT version FROM planner_entities WHERE id=$1',[p.id])).rows[0];if(fresh?.version!==p.version)throw Error('Assignment changed')
 const existing=(await c.query("SELECT data FROM planner_entities WHERE kind='action'")).rows.map(r=>r.data)
 if(existing.some(a=>a.projectId===p.id)){await c.query('ROLLBACK');continue}
 const today=easternDay(new Date()),days:{date:string;free:number}[]=[]
 for(let i=0;i<366;i++){const date=new Date(Date.parse(today+'T12:00:00Z')+i*86400000).toISOString().slice(0,10);if(p.data.deadline&&date>=p.data.deadline)break;if(!p.data.deadline&&i>=30)break;const budget=budgetForDay(i===0?new Date():new Date(date+'T10:00:00Z'),calendar.snapshot.events??[]);days.push({date,free:Math.max(0,budget.minutes-existing.filter(a=>a.date===date&&!a.dismissed).reduce((n,a)=>n+a.minutes,0))})}
 let cursor=0,unscheduled=0
 let sequence=0
 for(const step of raw.steps){while(cursor<days.length&&days[cursor]!.free<step.minutes)cursor++;const day=days[cursor];if(day)day.free-=step.minutes;else unscheduled++
 const data={...step,id:randomUUID(),projectId:p.id,assignmentStep:true,sequence:sequence++,needsRescheduling:!day,date:day?.date??'',completed:false,dismissed:false};await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'action',$2)",[data.id,data])}
 const summary=raw.summary+(unscheduled?` ${unscheduled} steps could not fit before the deadline; they are retained as unscheduled. Review the workload.`:' All steps have assigned dates.')
 await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[p.id,{...p.data,planSummary:summary,planRetryAt:null,planError:null,remainingMinutes:raw.steps.reduce((n,s)=>n+s.minutes,0)}]);await c.query('COMMIT')
 }catch{await c.query('ROLLBACK');await c.query("UPDATE planner_entities SET data=data || $2::jsonb,version=version+1 WHERE id=$1",[p.id,JSON.stringify({planError:'Assignment planning failed. Check curator/calendar and retry.',planRetryAt:new Date(Date.now()+300000).toISOString()})])}
 }
 }finally{if(locked)await c.query('SELECT pg_advisory_unlock(817342)');c.release()}
}
