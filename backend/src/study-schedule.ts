import type {Pool} from 'pg'
import {budgetForDay,easternDay} from './planner-policy.js'
import {resolveExam,examDay,type Preparation} from './study.js'
// Balance existing, unfinished study steps across feasible dates; preserve protected work.
export async function redistributeStudy(pool:Pool,now=new Date(),onlyPreparation?:string){
 const c=await pool.connect()
 try{
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(817340)')
 const rows=(await c.query('SELECT id,data FROM planner_entities ORDER BY id')).rows
 const cal=(await c.query('SELECT snapshot,last_success FROM calendar_sync_state WHERE id=1')).rows[0]
 if(!cal?.last_success||Date.now()-new Date(cal.last_success).getTime()>86400000)throw Error('Calendar stale')
 const events=cal.snapshot.events??[],today=easternDay(now)
 const preps=rows.filter(r=>r.data.topics&&r.data.event).map(r=>r.data as Preparation)
 const movable=rows.filter(r=>r.data.preparationId&&(!onlyPreparation||r.data.preparationId===onlyPreparation)&&!r.data.completed&&!r.data.dismissed&&!r.data.edited&&preps.some(p=>p.id===r.data.preparationId&&p.status==='active'&&resolveExam(p,events)))
 const moving=new Set(movable.map(r=>r.id)),used=new Map<string,number>()
 for(const r of rows)if(r.data.date&&!moving.has(r.id)&&!r.data.dismissed)used.set(r.data.date,(used.get(r.data.date)??0)+Number(r.data.minutes??0))
 const capacity=new Map<string,number>()
 for(let i=0;i<366;i++){const d=new Date(Date.parse(today+'T12:00:00Z')+i*86400000);const date=easternDay(d);capacity.set(date,budgetForDay(i===0?now:new Date(date+'T10:00:00Z'),events).minutes)}
 let moved=0,unscheduled=0
 movable.sort((a,b)=>{const pa=preps.find(p=>p.id===a.data.preparationId)!,pb=preps.find(p=>p.id===b.data.preparationId)!;return examDay(resolveExam(pa,events)!).localeCompare(examDay(resolveExam(pb,events)!))||pa.topics.findIndex(t=>t.id===a.data.topicId)-pb.topics.findIndex(t=>t.id===b.data.topicId)})
 for(const r of movable){const p=preps.find(p=>p.id===r.data.preparationId)!,end=examDay(resolveExam(p,events)!)
 const choices=[...capacity.keys()].filter(d=>d>=today&&d>=p.startDate&&d<end&&(capacity.get(d)!-(used.get(d)??0))>=r.data.minutes)
 choices.sort((a,b)=>(used.get(a)??0)/Math.max(1,capacity.get(a)!)-(used.get(b)??0)/Math.max(1,capacity.get(b)!)||a.localeCompare(b))
 const date=choices[0];if(!date){unscheduled++;continue}
 used.set(date,(used.get(date)??0)+r.data.minutes)
 if(date!==r.data.date){await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[r.id,{...r.data,date}]);moved++}
 }
 if(unscheduled)await c.query("UPDATE planner_runs SET summary=coalesce(summary,'') || $1 WHERE id=1",[` ${unscheduled} study steps could not be moved into remaining calendar capacity; their previous dates were retained. Review workload.`])
 await c.query('COMMIT');return {moved,unscheduled}
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
