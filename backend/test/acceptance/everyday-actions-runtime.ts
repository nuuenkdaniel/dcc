// Parent-only finite HTTP -> production model/MCP -> real PG acceptance.
// Importing this executable requires the explicit gates before DB/listeners.
import {Pool,type PoolClient} from 'pg'
import ICAL from 'ical.js'
import {authenticatedRuntimeFixture,validateRuntimeIsolation,type RuntimeIsolation} from '../mcp/authenticated-runtime-fixture.js'
import {JourneyRuntime} from './journey-runtime.js'
import {SyntheticCalendarProvider,calendarConfig,PROVIDER,calendars,hash} from './calendar-provider.js'
import {createScopedCalendarWriter} from '../../src/calendar-write.js'
import {saveTasks,taskSnapshot,type ManualTask} from '../../src/manual-tasks.js'
import {saveEntity} from '../../src/planner.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {ACTION_PATH} from '../../src/mcp/task-actions.js'
import {COLLECTION,RECEIPT_KIND,canonicalJson} from '../../src/mcp/service-transport.js'
import {TOOLS,type ToolName} from '../../src/mcp/contracts.js'
import {validClarification} from '../../src/mcp/clarification.js'
import type {IntentSummary} from '../../src/mcp/request-controller.js'
import type {Snapshot} from '../../src/sync.js'
import {EVERYDAY_CASES,EVERYDAY_MODEL_CAP,EVERYDAY_SEED,EVERYDAY_ORIGIN as ORIGIN,everydayOptions,everydayRequestHeaders,RECURRENCE_SENTINEL} from './everyday-actions-cases.js'

const ACTOR='synthetic-runtime-acceptance'
const abort=new AbortController(),stop=()=>abort.abort()
process.once('SIGINT',stop);process.once('SIGTERM',stop)
const runtime=new JourneyRuntime(abort.signal,EVERYDAY_MODEL_CAP)
type Code='approval'|'target_guard'|'namespace_not_empty'|'http_status'|'summary_incomplete'|'write_scope'|'payload_readback'|'unrelated_change'|'receipt_mismatch'|'replay_changed'|'clarification'|'call_budget'|'runtime_unconfirmed'|'interrupted'|'harness_runtime'|'port_busy'
class Failure extends Error{constructor(readonly code:Code){super(code)}}
let stage='approval',assertions=0,current:typeof results[number]|undefined
let firstFailure:{stage:string;code:Code;diagnosticCode?:string}|undefined,currentIntentKey:string|undefined
let preflightDone=false,campaignDone=false
const campaignFacts:Record<string,number>={}
const results=EVERYDAY_CASES.map(c=>({id:c.id,status:'PENDING' as 'PENDING'|'PASS'|'FAIL',modelCalls:0,code:undefined as Code|undefined,facts:{} as Record<string,unknown>}))
function check(value:unknown,code:Code='payload_readback'):asserts value{if(abort.signal.aborted)throw new Failure('interrupted');if(!value)throw new Failure(code);assertions++}
function failureCode(error:unknown):Code{return error instanceof Failure?error.code:abort.signal.aborted?'interrupted':(error as {code?:unknown})?.code==='EADDRINUSE'?'port_busy':'harness_runtime'}
function safeDiagnostic(error:unknown){const code=(error as {code?:unknown})?.code;return typeof code==='string'&&['EADDRINUSE','ECONNREFUSED','ETIMEDOUT','ENOENT','28P01','3D000','42P01','42501','23505'].includes(code)?code:undefined}
function remember(error:unknown){const diagnosticCode=safeDiagnostic(error);firstFailure??={stage,code:failureCode(error),...(diagnosticCode?{diagnosticCode}:{})}}
type Row={id:string;kind:string;version:number;data:Record<string,any>}
type RecordIntent=Awaited<ReturnType<SqlIntentStore['read']>>
function domain(rows:Row[]){return rows.filter(r=>!['dcc-request-intent-v1','hermes-command',RECEIPT_KIND].includes(r.kind))}
function onlyChanges(before:Row[],after:Row[],ids:string[]){
  const a=new Map(domain(before).map(r=>[r.id,r])),b=new Map(domain(after).map(r=>[r.id,r]))
  for(const id of new Set([...a.keys(),...b.keys()]))if(!ids.includes(id))check(canonicalJson(a.get(id)??null)===canonicalJson(b.get(id)??null),'unrelated_change')
}
function untouchedTasks(before:ManualTask[],after:ManualTask[],ids:string[]){
  for(const task of before)if(!ids.includes(task.id))check(canonicalJson(after.find(t=>t.id===task.id))===canonicalJson(task),'unrelated_change')
}
function readAfter(record:RecordIntent,index:number,tool:ToolName,id:string,expected:Record<string,unknown>){
  const call=record.calls[index]!,result=call.result
  check(result?.state==='applied'&&'version' in result&&Number.isSafeInteger(result.version)&&result.version>=1&&result.id===id,'receipt_mismatch')
  const nextWrite=record.calls.findIndex((c,i)=>i>index&&TOOLS[c.command.tool].write)
  const later=record.calls.slice(index+1,nextWrite<0?undefined:nextWrite)
  check(later.some(c=>c.command.tool===tool&&c.result?.state==='ok'&&Array.isArray((c.result.data as {items?:unknown[]}).items)&&(c.result.data as {items:Record<string,unknown>[]}).items.some(item=>item.id===id&&item.version===result.version&&Object.entries(expected).every(([key,value])=>canonicalJson(item[key])===canonicalJson(value)))),'payload_readback')
}
async function main(){
  let options:ReturnType<typeof everydayOptions>
  try{options=everydayOptions(process.argv.slice(2),process.env)}catch{throw new Failure('approval')}
  const pool=new Pool({host:'127.0.0.1',port:18533,database:options.database,user:options.user,password:'synthetic-isolated-qa-only',ssl:false,max:6,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c search_path=public'})
  pool.on('error',()=>{/* Never log arbitrary driver data. */})
  const provider=new SyntheticCalendarProvider(2030)
  let lock:PoolClient|undefined,providerStarted=false
  const rows=async()=> (await pool.query<Row>('SELECT id,kind,version,data FROM planner_entities ORDER BY id')).rows
  const snapshot=async():Promise<Snapshot>=>{const row=(await pool.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0];return {...row.snapshot,events:row.snapshot.events??[]}}
  const store=new SqlIntentStore(pool,ACTOR)
  const isolation:RuntimeIsolation={database:{host:'127.0.0.1',port:18533,name:options.database,disposable:true},syntheticDataOnly:true,model:'gpt-6-luna',modelInvocationApproved:true,calendar:'synthetic-loopback',calendarOrigins:[PROVIDER]}
  const writer=createScopedCalendarWriter(pool,calendarConfig)
  let studyId='',workId='',projectId='',childId='',assignmentId='',calendarPath='',calendarUid=''
  try{
    stage='target-guard'
    validateRuntimeIsolation(pool,isolation)
    const actual=(await pool.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version")).rows[0]
    check(actual.db===options.database&&actual.host==='127.0.0.1'&&actual.port===18533&&actual.version>=170000&&actual.version<180000,'target_guard')
    lock=await pool.connect();check((await lock.query('SELECT pg_try_advisory_lock(817349) AS acquired')).rows[0].acquired===true,'target_guard')
    const tables=(await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename")).rows
    check(canonicalJson(tables)===canonicalJson(['app_sessions','calendar_mutations','calendar_sync_state','planner_entities','planner_runs'].map(tablename=>({schemaname:'public',tablename}))),'target_guard')
    check((await rows()).length===0&&(await pool.query('SELECT count(*)::int AS n FROM calendar_mutations')).rows[0].n===0&&(await pool.query('SELECT count(*)::int AS n FROM app_sessions')).rows[0].n===0,'namespace_not_empty')
    const sync=(await pool.query('SELECT * FROM calendar_sync_state')).rows,planner=(await pool.query('SELECT * FROM planner_runs')).rows
    check(sync.length===1&&sync[0].id===1&&sync[0].source_hash===null&&sync[0].last_success===null&&sync[0].last_attempt===null&&sync[0].error===null&&sync[0].failures===0&&canonicalJson(sync[0].snapshot)===canonicalJson({calendars:[]}),'namespace_not_empty')
    check(planner.length===1&&planner[0].id===1&&planner[0].day===null&&planner[0].last_success===null&&planner[0].error===null&&planner[0].summary===null&&planner[0].requested===false,'namespace_not_empty')
    stage='official-bootstrap';await runtime.preflight()
    if(options.preflightOnly){preflightDone=true;return}
    stage='owned-recurrence-sentinel'
    check((await saveTasks(pool,0,[structuredClone(RECURRENCE_SENTINEL)])).code===200,'payload_readback')
    for(const plan of EVERYDAY_CASES){
      current=results.find(r=>r.id===plan.id)!;currentIntentKey=undefined;stage=plan.id
      const callsBefore=runtime.calls
      console.log(JSON.stringify({kind:'started',caseId:plan.id,seed:EVERYDAY_SEED,modelCalls:runtime.calls,requestedModel:'gpt-6-luna'}))
      if(plan.id==='EA09'){
        for(const suffix of ['1','2'])check((await saveEntity(pool,'project',0,{id:`20261107-0000-4000-a000-00000000000${suffix}`,kind:'project',title:'QA duplicate 20261107',description:'Owned ambiguous-target fixture',deadline:'2030-11-30',category:'school',importance:2,remainingMinutes:20,progress:'Not started',status:'active'})).code===200)
      }
      if(plan.id==='EA10'){
        stage='EA10.provider-start';await provider.start();providerStarted=true;await provider.refresh(pool)
      }
      // Fresh app/auth per case keeps production rate limits enabled without
      // sleeping through them. Actor/DB/key receipts remain shared and durable.
      const app=authenticatedRuntimeFixture({pool,bridge:async(input,signal)=>{
        try{return await runtime.invoke(input,signal)}catch(error){remember(new Failure(abort.signal.aborted?'interrupted':'runtime_unconfirmed'));throw error}
      },origin:ORIGIN,isolation,isolatedSyntheticOnly:true,calendarSnapshot:snapshot,guardedCalendarWriter:writer})
      let cookie=''
      const request=async(path:string,body?:unknown)=>{
        const response=await fetch(ORIGIN+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:everydayRequestHeaders(cookie,body!==undefined),...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(125000)])})
        // Drain the real wire body before ANY status check/caller proceeds.
        // This includes login and rejected/conflicting host replay responses.
        const payload=await response.arrayBuffer()
        return new Response([204,205,304].includes(response.status)?null:payload,{status:response.status,statusText:response.statusText,headers:response.headers})
      }
      const get=async(path:string)=>{const response=await request(path);check(response.status===200,'http_status');return response.json()}
      try{
        stage=plan.id+'.http-login';await app.listen({host:'127.0.0.1',port:18534})
        const login=await request('/api/v1/auth/login',{username:'synthetic-qa',password:'synthetic-isolated-qa-only'})
        check(login.status===200,'http_status');check((await login.json() as {authenticated?:unknown}).authenticated===true,'http_status');cookie=(login.headers.get('set-cookie')??'').split(';')[0]??''
        check(/^daymark_session=[a-f0-9]{64}$(?![\s\S])/.test(cookie),'http_status')
        check((await get('/api/v1/auth/session')).authenticated===true,'http_status')
        const before=await rows(),tasksBefore=(await get('/api/v1/planner/manual-tasks')).data.tasks as ManualTask[]
        const collectionBefore=before.find(r=>r.id===COLLECTION)!
        const key=`dcc_qa_20261107_${plan.id}_v1`;currentIntentKey=key
        let prompt=''
        const tasksRead='Read tasks from 2030-11-07 inclusive to 2030-11-10 exclusive, limit25 offset0; use current collection versions and read back after EACH write.'
        const projectsRead='Read projects with limit25 offset0 before each versioned change and read back after EACH write; use exact IDs and current versions.'
        const calendarRead='List exact School calendar and its events from 2030-10-20T00:00:00Z inclusive to 2030-11-20T00:00:00Z exclusive, limit25 offset0. Read authoritative get_calendar_series before editing; use current cached identity and ETag.'
        switch(plan.id){
          case 'EA01':prompt=`${tasksRead} Create exactly two standalone tasks dated 2030-11-07: "QA study 20261107", notes exactly "Estimate: 25 minutes", important true; and "QA work 20261107", notes exactly "Estimate: 15 minutes", important false. Estimates belong ONLY in notes; there is no standalone task duration field. Do not change the host recurrence sentinel or anything else.`;break
          case 'EA02':prompt=`${tasksRead} For ONLY study task ID ${studyId}, rename to "QA study revised 20261107" and notes exactly "Estimate: 35 minutes; review chapter". Then complete it, then reopen it. Three writes total, read back each intermediate state; preserve date, importance and all unrelated tasks/recurrence.`;break
          case 'EA03':prompt=`${tasksRead} Delete ONLY work task ID ${workId}, titled "QA work 20261107". Preserve all other tasks, metadata and recurrence. Deletion is a tombstone, not physical collection removal; read it back and report that it is deleted.`;break
          case 'EA04':prompt=`${projectsRead} Create one project "QA coursework 20261107", description "Synthetic coursework", deadline 2030-11-30, category school, importance2, remainingMinutes60, progress "Not started". Then create one MANUAL daily action linked to that new project: title "QA outline 20261107", date 2030-11-07, notes "Draft outline", minutes25. Read back the parent and daily actions for [2030-11-07,2030-11-10), limit10 offset0. Do not generate plans or other actions.`;break
          case 'EA05':prompt=`Read daily actions for [2030-11-07,2030-11-10), limit10 offset0 and project ID ${projectId}. Update ONLY manual child ID ${childId} to title "QA outline revised 20261107", date 2030-11-08, notes "Review examples", minutes40. Read back. Then complete THAT child and read back again. Two writes, use fresh versions. Parent must remain active; do not complete or edit parent or generate/reschedule other actions.`;break
          case 'EA06':prompt=`${projectsRead} Update ONLY project ID ${projectId} to title "QA coursework revised 20261107", description "Reviewed synthetic coursework", progress "Reviewed", remainingMinutes20; retain deadline/category/importance. Read back, then explicitly mark that parent complete and read back. Two writes. Do not change its child.`;break
          case 'EA07':prompt=`${projectsRead} Archive ONLY project ID ${projectId}, read back archived state, then restore the SAME project and read back active state. Two writes. No hard delete, no child/history changes.`;break
          case 'EA08':prompt=`${projectsRead} Create one ASSIGNMENT "QA assignment 20261107", description "Course: QA-101; synthetic worksheet", deadline 2030-11-21, category school, importance3, remainingMinutes45, progress "Not started". Read back. Then update ONLY its deadline to 2030-11-22 and read back. Two writes. Course code is description text, not an unsupported course metadata field. Do not create tasks/calendar events or a plan.`;break
          case 'EA09':prompt=`${projectsRead} Delete the project named "QA duplicate 20261107". There are two owned projects with that exact title and I have not identified which one. Do not guess or archive either. Ask which exact project I mean using the matching typed clarification, then stop without writes. Project removal means archive, never hard delete.`;break
          case 'EA10':prompt=`${calendarRead} Create exactly one NON-RECURRING School appointment "QA appointment 20261107", scope single, on 2030-11-14 at09:30-10:15 America/New_York, explicit UTC start2030-11-14T14:30:00Z end2030-11-14T15:15:00Z, allDay false, description "Synthetic appointment", location "QA room". Use School's actual timezone donor event for trusted VTIMEZONE. Read operation status from the returned receipt. Saved means snapshot_pending; do not invent a refreshed event ID or claim sync. No other writes.`;break
          case 'EA11':prompt=`${calendarRead} Move ONLY "QA appointment 20261107" (UID ${calendarUid}) on 2030-11-14 to10:30-11:15 America/New_York, UTC15:30:00Z-16:15:00Z that day. Explicit single scope, allDay false; retain title, description, location, UID and timezone. One write, then check returned operation receipt; saved is snapshot_pending, not refreshed identity.`;break
          case 'EA12':prompt=`${calendarRead} Cancel ONLY the non-recurring "QA appointment 20261107" (UID ${calendarUid}) currently 2030-11-14T15:30:00Z-16:15:00Z. Explicit single scope. Keep donor and all other events intact. One write, check returned operation receipt. Saved remains snapshot_pending, not proof of refreshed cache.`;break
        }
        prompt='Synthetic isolated QA only. '+prompt+' Backend owns creation IDs and operation keys. No timers, mail mutation, files, shell, generic HTTP, credentials, or unrelated actions.'
        stage=plan.id+'.model'
        const http=await request(ACTION_PATH,{key,prompt});current.facts.httpStatus=http.status
        check(http.status===200,'http_status')
        const response=await http.json() as {summary:IntentSummary},summary=response.summary
        current.facts.summary={phase:summary.phase,outcome:summary.outcome,pending:summary.pending,effects:summary.effects.map(e=>({tool:e.tool,state:e.state}))}
        const record=await store.read(key)
        current.facts.toolResults=record.calls.map(c=>({tool:c.command.tool,state:c.result?.state??'pending',...((c.result?.state==='rejected'||c.result?.state==='conflict')?{code:c.result.code}:{})}))
        check(runtime.calls===callsBefore+1&&runtime.evidence.length===runtime.calls,'call_budget')
        check(summary.phase==='completed'&&summary.pending===0&&record.phase==='completed'&&record.rounds===1&&record.calls.length<=12,'summary_incomplete')
        const writes=record.calls.filter(c=>TOOLS[c.command.tool].write)
        check(canonicalJson(writes.map(c=>c.command.tool))===canonicalJson(plan.tools)&&summary.effects.length===writes.length,'write_scope')
        stage=plan.id+'.readback'
        await receiptProof(pool,writes)
        const after=await rows(),tasksHTTP=await get('/api/v1/planner/manual-tasks'),tasks=tasksHTTP.data.tasks as ManualTask[]
        check(canonicalJson(tasksHTTP)===canonicalJson(await taskSnapshot(pool)),'payload_readback')
        const plannerHTTP=await get('/api/v1/planner/snapshot') as {projects:{kind:string;version:number;data:Record<string,any>}[];actions:{kind:string;version:number;data:Record<string,any>}[]}
        const sqlPlanner=after.filter(r=>['project','action'].includes(r.kind)).map(({kind,version,data})=>({kind,version,data}))
        check(canonicalJson([...plannerHTTP.projects,...plannerHTTP.actions].sort((a,b)=>String(a.data.id).localeCompare(String(b.data.id))))===canonicalJson(sqlPlanner.sort((a,b)=>String(a.data.id).localeCompare(String(b.data.id)))),'payload_readback')
        let allowed:string[]=[]
        switch(plan.id){
          case 'EA01':{
            const study=tasks.find(t=>t.title==='QA study 20261107'),work=tasks.find(t=>t.title==='QA work 20261107')
            check(study&&work&&tasks.length===tasksBefore.length+2)
            studyId=study.id;workId=work.id
            check(study.notes==='Estimate: 25 minutes'&&work.notes==='Estimate: 15 minutes'&&study.important===true&&work.important===false&&[study,work].every(t=>t.date==='2030-11-07'&&!t.completed&&!t.deleted))
            untouchedTasks(tasksBefore,tasks,[studyId,workId]);check(tasksHTTP.version===collectionBefore.version+2)
            for(const [i,c] of record.calls.entries())if(c.command.tool==='create_task')readAfter(record,i,'list_tasks',String(c.command.args.id),{title:c.command.args.title,completed:false})
            allowed=[COLLECTION];break
          }
          case 'EA02':{
            const old=tasksBefore.find(t=>t.id===studyId)!,now=tasks.find(t=>t.id===studyId)!
            check(canonicalJson(now)===canonicalJson({...old,title:'QA study revised 20261107',notes:'Estimate: 35 minutes; review chapter',completed:false}))
            check(writes.every(c=>c.command.args.id===studyId)&&writes[1]?.command.args.completed===true&&writes[2]?.command.args.completed===false&&tasksHTTP.version===collectionBefore.version+3)
            for(const c of writes)readAfter(record,record.calls.indexOf(c),'list_tasks',studyId,c.command.tool==='update_task'?{title:'QA study revised 20261107',notes:'Estimate: 35 minutes; review chapter'}:{completed:c.command.args.completed})
            untouchedTasks(tasksBefore,tasks,[studyId]);allowed=[COLLECTION];break
          }
          case 'EA03':{
            check(writes[0]?.command.args.id===workId&&tasks.length===tasksBefore.length&&tasksHTTP.version===collectionBefore.version+1)
            check(canonicalJson(tasks.find(t=>t.id===workId))===canonicalJson({...tasksBefore.find(t=>t.id===workId),deleted:true}))
            check(!tasks.filter(t=>!t.deleted).some(t=>t.id===workId)&&tasks.filter(t=>!t.deleted).some(t=>t.id===studyId))
            untouchedTasks(tasksBefore,tasks,[workId]);readAfter(record,record.calls.indexOf(writes[0]!),'list_tasks',workId,{deleted:true});allowed=[COLLECTION];break
          }
          case 'EA04':{
            const parent=after.find(r=>r.kind==='project'&&r.data.title==='QA coursework 20261107'),child=after.find(r=>r.kind==='action'&&r.data.title==='QA outline 20261107')
            check(parent&&child);projectId=parent.id;childId=child.id
            check(parent.version===1&&parent.data.kind==='project'&&parent.data.status==='active'&&parent.data.description==='Synthetic coursework'&&parent.data.deadline==='2030-11-30'&&parent.data.category==='school'&&parent.data.importance===2&&parent.data.remainingMinutes===60&&parent.data.progress==='Not started')
            check(child.version===1&&child.data.source==='manual-project'&&child.data.projectId===projectId&&child.data.date==='2030-11-07'&&child.data.minutes===25&&child.data.notes==='Draft outline'&&!child.data.completed&&!child.data.dismissed)
            readAfter(record,record.calls.indexOf(writes[0]!),'list_projects',projectId,{title:parent.data.title,status:'active'})
            readAfter(record,record.calls.indexOf(writes[1]!),'list_daily_actions',childId,{projectId,date:'2030-11-07',minutes:25,completed:false});allowed=[projectId,childId];break
          }
          case 'EA05':{
            const old=before.find(r=>r.id===childId)!,child=after.find(r=>r.id===childId)!
            check(canonicalJson(child.data)===canonicalJson({...old.data,title:'QA outline revised 20261107',date:'2030-11-08',minutes:40,notes:'Review examples',completed:true,edited:true})&&child.version===old.version+2)
            check(writes.every(c=>c.command.args.id===childId)&&writes[1]?.command.args.completed===true)
            readAfter(record,record.calls.indexOf(writes[0]!),'list_daily_actions',childId,{title:'QA outline revised 20261107',notes:'Review examples',date:'2030-11-08',minutes:40,completed:false})
            readAfter(record,record.calls.indexOf(writes[1]!),'list_daily_actions',childId,{completed:true})
            check(after.find(r=>r.id===projectId)?.data.status==='active');allowed=[childId];break
          }
          case 'EA06':{
            const old=before.find(r=>r.id===projectId)!,parent=after.find(r=>r.id===projectId)!
            check(canonicalJson(parent.data)===canonicalJson({...old.data,title:'QA coursework revised 20261107',description:'Reviewed synthetic coursework',progress:'Reviewed',remainingMinutes:20,status:'complete'})&&parent.version===old.version+2&&writes.every(c=>c.command.args.id===projectId))
            readAfter(record,record.calls.indexOf(writes[0]!),'list_projects',projectId,{title:'QA coursework revised 20261107',status:'active'})
            readAfter(record,record.calls.indexOf(writes[1]!),'list_projects',projectId,{status:'complete'});allowed=[projectId];break
          }
          case 'EA07':{
            const old=before.find(r=>r.id===projectId)!,parent=after.find(r=>r.id===projectId)!
            check(canonicalJson(parent.data)===canonicalJson({...old.data,status:'active'})&&parent.version===old.version+2&&writes.every(c=>c.command.args.id===projectId))
            readAfter(record,record.calls.indexOf(writes[0]!),'list_projects',projectId,{status:'archived'})
            readAfter(record,record.calls.indexOf(writes[1]!),'list_projects',projectId,{status:'active'});allowed=[projectId];break
          }
          case 'EA08':{
            const parent=after.find(r=>r.kind==='project'&&r.data.title==='QA assignment 20261107');check(parent);assignmentId=parent.id
            check(parent.version===2&&parent.data.kind==='assignment'&&parent.data.deadline==='2030-11-22'&&parent.data.description==='Course: QA-101; synthetic worksheet'&&parent.data.category==='school'&&parent.data.importance===3&&parent.data.remainingMinutes===45&&parent.data.progress==='Not started'&&parent.data.status==='active')
            const update=writes[1]!;check(update.command.args.id===assignmentId&&canonicalJson(Object.keys(update.command.args).sort())===canonicalJson(['deadline','expectedVersion','id','operationKey']))
            readAfter(record,record.calls.indexOf(writes[0]!),'list_projects',assignmentId,{deadline:'2030-11-21',kind:'assignment'})
            readAfter(record,record.calls.indexOf(update),'list_projects',assignmentId,{deadline:'2030-11-22',kind:'assignment'});allowed=[assignmentId];break
          }
          case 'EA09':{
            check(summary.clarifications?.length===1&&summary.clarifications.every(validClarification)&&summary.clarifications[0]?.reason==='ambiguous_project','clarification')
            check(after.filter(r=>r.kind==='project'&&r.data.title==='QA duplicate 20261107').length===2,'clarification');break
          }
          default:{
            const beforePuts=plan.id==='EA10'?0:Number(results.find(r=>r.id===(plan.id==='EA11'?'EA10':'EA11'))!.facts.providerPutCount)
            check(provider.events.filter(e=>e.method==='PUT').length===beforePuts+1,'write_scope')
            const saved=writes[0]!.result;check(saved?.state==='saved'&&saved.confirmation==='snapshot_pending'&&saved.readback==='verified','receipt_mismatch')
            const oldSnapshot=await snapshot()
            if(plan.id==='EA10'){
              check(!oldSnapshot.events.some(e=>e.title==='QA appointment 20261107'))
              const entry=[...provider.resources.entries()].find(([,r])=>r.body.includes('QA appointment 20261107'));check(entry);calendarPath=entry[0]
            }
            const resource=await fetch(PROVIDER+calendarPath,{redirect:'error',headers:{Authorization:'Basic '+Buffer.from(calendarConfig.username+':'+calendarConfig.password).toString('base64')},signal:AbortSignal.timeout(5000)})
            check(resource.status===200&&resource.headers.get('etag')===saved.providerEtag,'payload_readback')
            const raw=await resource.text(),root=new ICAL.Component(ICAL.parse(raw)),master=root.getFirstSubcomponent('vevent')!
            check(root.getAllSubcomponents('vevent').length===1&&root.getAllSubcomponents('vtimezone').length===1&&master.getFirstProperty('dtstart')?.getParameter('tzid')==='America/New_York')
            check(master.getFirstPropertyValue('summary')==='QA appointment 20261107'&&master.getFirstPropertyValue('description')==='Synthetic appointment'&&master.getFirstPropertyValue('location')==='QA room'&&!master.hasProperty('rrule')&&!master.hasProperty('recurrence-id'))
            if(plan.id==='EA10')calendarUid=String(master.getFirstPropertyValue('uid'))
            check(String(master.getFirstPropertyValue('uid'))===calendarUid)
            check(String(master.getFirstPropertyValue('dtstart'))===(plan.id==='EA10'?'2030-11-14T09:30:00':'2030-11-14T10:30:00')&&String(master.getFirstPropertyValue('dtend'))===(plan.id==='EA10'?'2030-11-14T10:15:00':'2030-11-14T11:15:00'))
            check(plan.id==='EA12'?master.getFirstPropertyValue('status')==='CANCELLED':master.getFirstPropertyValue('status')!=='CANCELLED')
            check(writes[0]!.command.args.calendarId===calendars[0]!.id&&writes[0]!.command.args.scope==='single','write_scope')
            check(record.calls.some(c=>c.command.tool==='get_operation_status'&&c.result?.state==='ok'&&(c.result.data as {status:string}).status==='saved'),'receipt_mismatch')
            const fresh=await provider.refresh(pool),matching=fresh.events.filter(e=>e.uid===calendarUid)
            check(plan.id==='EA12'?matching.length===0:matching.length===1)
            const httpSnapshot=await get('/api/v1/calendar/snapshot');check(canonicalJson(httpSnapshot)===canonicalJson(fresh),'payload_readback')
            current.facts.providerPutCount=provider.events.filter(e=>e.method==='PUT').length
            current.facts.providerBodySha256=hash(raw);current.facts.providerEtag=saved.providerEtag
            break
          }
        }
        onlyChanges(before,after,allowed)
        if(['EA03','EA07','EA12'].includes(plan.id)){
          stage=plan.id+'.host-replay-conflict'
          const stable=canonicalJson(await rows()),mutations=canonicalJson((await pool.query('SELECT * FROM calendar_mutations ORDER BY id')).rows),providerRequests=provider.events.length,calls=runtime.calls
          const replay=await request(ACTION_PATH,{key,prompt});check(replay.status===200,'http_status')
          check(canonicalJson((await replay.json() as {summary:IntentSummary}).summary)===canonicalJson(summary),'replay_changed')
          const conflict=await request(ACTION_PATH,{key,prompt:prompt+' Different payload.'})
          await conflict.arrayBuffer()
          check(conflict.status===409,'replay_changed')
          check(runtime.calls===calls&&canonicalJson(await rows())===stable&&canonicalJson((await pool.query('SELECT * FROM calendar_mutations ORDER BY id')).rows)===mutations&&provider.events.length===providerRequests,'replay_changed')
          current.facts.replayNoExtraEffect=true;current.facts.changedPayloadStatus=409
        }
        current.status='PASS';current.modelCalls=runtime.calls-callsBefore
        current.facts.assertions=assertions;current.facts.rows=after.length;current.facts.domainSha256=hash(canonicalJson(domain(after)));current.facts.collectionVersion=tasksHTTP.version
        current.facts.entityVersions=domain(after).map(r=>({kind:r.kind,idHash:hash(r.id),version:r.version}))
        console.log(JSON.stringify({kind:'completed',seed:EVERYDAY_SEED,case:current,modelCalls:runtime.calls,requestedModel:'gpt-6-luna',schemaEvidence:runtime.evidence.at(-1)}))
      }catch(error){remember(error);throw error}finally{
        try{await app.close()}catch(error){if(!firstFailure){stage=plan.id+'.cleanup';remember(error)}throw error}
      }
    }
    stage='complete';check(runtime.calls===12&&runtime.evidence.length===12,'call_budget')
    const final=await rows(),expectedReceipts=EVERYDAY_CASES.reduce((n,c)=>n+c.tools.length,0)
    check(final.filter(r=>r.kind===RECEIPT_KIND).length===expectedReceipts&&final.filter(r=>r.kind==='dcc-request-intent-v1').length===12&&final.filter(r=>r.kind==='hermes-command').length===12,'receipt_mismatch')
    check(domain(final).length===6&&final.length===6+expectedReceipts+24,'unrelated_change')
    const mutations=(await pool.query('SELECT count(*)::int AS n FROM calendar_mutations')).rows[0].n
    check(mutations===3&&provider.events.filter(e=>e.method==='PUT').length===3,'receipt_mismatch')
    check(provider.events.every((e,i)=>e.method!=='PUT'||[201,204].includes(e.code)&&provider.events.slice(0,i).some(g=>g.method==='GET'&&g.path===e.path&&(e.ifNoneMatch==='*'?g.code===404:g.etag===e.ifMatch))),'receipt_mismatch')
    Object.assign(campaignFacts,{rows:final.length,operationReceipts:expectedReceipts,requestJournals:12,legacyFences:12,calendarMutations:mutations,providerPuts:3})
    campaignDone=true
  }catch(error){remember(error);throw error}finally{
    try{
      // Best-effort fixed synthetic hashes/counts on failure, never raw records.
      if(current&&current.status!=='PASS'){
        current.modelCalls=runtime.calls-results.filter(r=>r.status==='PASS').reduce((n,r)=>n+r.modelCalls,0)
        try{current.facts.retainedRows=(await rows()).length;current.facts.retainedDomainSha256=hash(canonicalJson(domain(await rows())))}catch{/* Keep original failure. */}
        if(currentIntentKey)try{
          const r=await store.read(currentIntentKey)
          current.facts.journalPhase=r.phase
          current.facts.toolResults=r.calls.map(c=>({tool:c.command.tool,state:c.result?.state??'pending',...((c.result?.state==='rejected'||c.result?.state==='conflict')?{code:c.result.code}:{})}))
        }catch{/* Absent/unreadable journal is not effect proof. */}
        current.facts.providerStarted=providerStarted;current.facts.providerPuts=provider.events.filter(e=>e.method==='PUT').map(e=>({code:e.code,bodySha256:e.bodySha256,etag:e.etag}))
      }
    }finally{
      const closeOwned=async(work:()=>Promise<unknown>)=>{try{await work()}catch(error){if(!firstFailure)stage='owned-cleanup';remember(error);throw error}}
      try{await closeOwned(()=>provider.close())}finally{
        try{if(lock){const ownedLock=lock;await closeOwned(async()=>{try{await ownedLock.query('SELECT pg_advisory_unlock(817349)')}finally{ownedLock.release()}})}}
        finally{await closeOwned(()=>pool.end())}
      }
    }
  }
}

async function receiptProof(pool:Pool,calls:RecordIntent['calls']){
  for(const call of calls){
    const result=call.result
    check(result?.state==='applied'||result?.state==='saved','receipt_mismatch')
    const records=(await pool.query('SELECT data FROM planner_entities WHERE kind=$1 AND data->>\'key\'=$2',[RECEIPT_KIND,call.command.args.operationKey])).rows
    check(records.length===1&&records[0].data.tool===call.command.tool&&canonicalJson(records[0].data.result)===canonicalJson(result),'receipt_mismatch')
    if(result.state==='saved'){
      const receipt=records[0].data,ledger=(await pool.query('SELECT payload_hash,result FROM calendar_mutations WHERE id=$1',[result.mutationId])).rows
      check(receipt.writerPayloadHash===hash(receipt.writerPayloadJson)&&canonicalJson(JSON.parse(receipt.writerPayloadJson))===canonicalJson(receipt.change),'receipt_mismatch')
      check(ledger.length===1&&ledger[0].payload_hash===receipt.writerPayloadHash&&ledger[0].result.saved===true&&ledger[0].result.completion.readback==='verified'&&ledger[0].result.completion.snapshot==='pending','receipt_mismatch')
    }
  }
}
main().then(()=>{
  console.log(JSON.stringify({kind:preflightDone?'preflight':'campaign',status:preflightDone?'READY':campaignDone?'PASS':'FAIL',seed:EVERYDAY_SEED,stage,modelCalls:runtime.calls,requestedModel:'gpt-6-luna',assertions,results,campaignFacts,schemaEvidence:runtime.evidence,publicTLSProven:false,realCalDAVProven:false}))
}).catch(error=>{
  const code=firstFailure?.code??failureCode(error)
  if(current&&current.status!=='PASS'){current.status='FAIL';current.code=code}
  console.log(JSON.stringify({kind:'campaign',status:'FAIL',seed:EVERYDAY_SEED,stage:firstFailure?.stage??stage,code,...(firstFailure?.diagnosticCode?{diagnosticCode:firstFailure.diagnosticCode}:{}),modelCalls:runtime.calls,requestedModel:'gpt-6-luna',assertions,results,schemaEvidence:runtime.evidence,publicTLSProven:false,realCalDAVProven:false}));process.exitCode=1
}).finally(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)})
