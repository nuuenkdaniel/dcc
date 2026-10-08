import type {Pool} from 'pg'
import {budgetForDay,easternDay,easternHour} from './planner-policy.js'
import {resolveExam,examDay,type Preparation} from './study.js'
import {isAutomatedAction,scheduledActionMinutes} from './planner.js'
export async function rollover(pool:Pool,now=new Date()){
 if(easternHour(now)<6)return {status:'not-due'}
 const c=await pool.connect()
 try{
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(817340)')
 await c.query('CREATE TABLE IF NOT EXISTS planner_rollover(day text PRIMARY KEY,result jsonb NOT NULL)')
 const today=easternDay(now)
 if((await c.query('SELECT 1 FROM planner_rollover WHERE day=$1',[today])).rowCount){await c.query('ROLLBACK');return {status:'already-run'}}
 const cal=(await c.query('SELECT snapshot,last_success FROM calendar_sync_state WHERE id=1')).rows[0]
 if(!cal?.last_success||now.getTime()-new Date(cal.last_success).getTime()>86400000)throw Error('Calendar unavailable or stale')
 const rows=(await c.query('SELECT id,kind,data FROM planner_entities')).rows
  const allActions=rows.filter(r=>r.kind==='action'),actions=allActions.filter(r=>isAutomatedAction(r.data)),projects=rows.filter(r=>r.kind==='project'),preps=rows.filter(r=>r.kind==='preparation')
 const missed=actions.filter(r=>!r.data.completed&&!r.data.dismissed&&((r.data.date&&r.data.date<today)||r.data.needsRescheduling)).map(r=>{
 const a=r.data,p=projects.find(p=>p.id===a.projectId),prep=preps.find(p=>p.id===a.preparationId)?.data as Preparation|undefined
 if(prep){const event=resolveExam(prep,cal.snapshot.events??[]);if(prep.status!=='active'||!event)return null;return {...r,deadline:examDay(event),start:prep.startDate,order:prep.topics.findIndex(t=>t.id===a.topicId)}}
 if(a.assignmentStep&&p?.data.status==='active')return {...r,deadline:p.data.deadline||'',start:today,order:a.sequence??0}
 return null
 }).filter(r=>r!==null).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||a.order-b.order||String(a.data.date).localeCompare(String(b.data.date))||a.id.localeCompare(b.id))
  const moving=new Set(missed.map(r=>r.id)),used=new Map<string,number>(),fixedActions=allActions.filter(a=>!moving.has(a.id)).map(a=>a.data)
  for(const date of new Set(fixedActions.map(a=>a.date).filter(Boolean)))used.set(date,scheduledActionMinutes(fixedActions,date))
 let moved=0,unplaced=0,shortfallMinutes=0
 const last=new Map<string,string>()
 for(const r of missed){let chosen='';const group=r.data.preparationId??r.data.projectId
 for(let i=0;i<(r.deadline?366:30);i++){
 const day=new Date(Date.parse(today+'T12:00:00Z')+i*86400000).toISOString().slice(0,10)
 if(r.deadline&&day>=r.deadline)break
 if(day<r.start||day<(last.get(group)??today))continue
 const budget=budgetForDay(i===0?now:new Date(day+'T10:00:00Z'),cal.snapshot.events??[]).minutes
 if(budget-(used.get(day)??0)>=r.data.minutes){chosen=day;used.set(day,(used.get(day)??0)+r.data.minutes);last.set(group,day);break}
 }
 if(chosen)moved++;else{unplaced++;shortfallMinutes+=r.data.minutes}
 await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[r.id,{...r.data,date:chosen,needsRescheduling:!chosen,rolloverFrom:r.data.rolloverFrom??r.data.date}])
 }
 const result={status:'done',moved,unplaced,shortfallMinutes}
 await c.query('INSERT INTO planner_rollover VALUES($1,$2)',[today,result]);await c.query('COMMIT');return result
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
