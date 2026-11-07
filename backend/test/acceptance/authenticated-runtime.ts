// OPT-IN parent-run acceptance, deliberately outside all ordinary test globs.
// No server.ts/dotenv/migrations/provider adapters. All diagnostics are fixed
// stages/counts, never exception objects, HTTP bodies, model text or credentials.
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {Pool,type PoolClient} from 'pg'
import {authenticatedRuntimeFixture,validateRuntimeIsolation,type RuntimeIsolation} from '../mcp/authenticated-runtime-fixture.js'
import {ACTION_PATH,TASK_ACTION_PATH,TASK_CALLBACK_PATH,type TaskBridge} from '../../src/mcp/task-actions.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {COLLECTION,RECEIPT_KIND,canonicalJson} from '../../src/mcp/service-transport.js'
import {validClarification} from '../../src/mcp/clarification.js'
import type {IntentSummary} from '../../src/mcp/request-controller.js'
import {CONVERSATION_PATH} from '../../src/mcp/conversation.js'
import {validConversationView,type ConversationView} from '../../src/mcp/conversation-wire.js'
import {nyDate} from '../../src/mcp/conversation-contract.js'

const origin='http://127.0.0.1:18534'
const seeds=[20261105,20261106] as const
const script=fileURLToPath(new URL('./runtime_loopback.py',import.meta.url))
type Evidence={model:string;schemaCount:number;schemaSha256:string;schemasUnchanged:boolean}
type Row={id:string;kind:string;version:number;data:Record<string,any>}
let stage='approval',modelCalls=0,assertions=0,campaignSeed:number|null=null
const evidence:Evidence[]=[]
const shutdown=new AbortController()
const stop=()=>shutdown.abort()
process.once('SIGINT',stop);process.once('SIGTERM',stop)
function check(value:unknown):asserts value {if(!value)throw Error('Acceptance assertion');assertions++}

async function main(){
  if(process.argv.length!==2||process.env.DCC_QA_RUNTIME_APPROVED!=='synthetic-loopback-model')throw Error('Explicit approval required')
  const campaign=process.env.DCC_QA_RUNTIME_CAMPAIGN
  if(campaign!==undefined&&!['clarification','clarification-general'].includes(campaign))throw Error('Unknown finite campaign')
  const clarificationCampaign=campaign==='clarification'||campaign==='clarification-general',selectedSeeds=clarificationCampaign?[20261107]:seeds
  // Refuse libpq/production endpoint defaults. No private .env is loaded.
  if(Object.keys(process.env).some(k=>k.startsWith('PG')||['DATABASE_URL','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].includes(k)))throw Error('Ambient database/runtime configuration refused')
  const database=process.env.DCC_QA_DATABASE??'',user=process.env.DCC_QA_PG_USER??''
  check(/^dcc_qa_[a-z0-9_]{1,48}$/.test(database)&&/^[a-z_][a-z0-9_]{0,62}$/.test(user))
  const isolation:RuntimeIsolation={database:{host:'127.0.0.1',port:18533,name:database,disposable:true},syntheticDataOnly:true,model:'gpt-6-luna',modelInvocationApproved:true,calendar:'none',calendarOrigins:[]}
  const pool=new Pool({host:'127.0.0.1',port:18533,database,user,password:'synthetic-isolated-qa-only',ssl:false,max:4,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c search_path=public'})
  pool.on('error',()=>{/* Never log a driver exception/connection string. */})
  let lock:PoolClient|undefined
  const rows=async()=> (await pool.query<Row>('SELECT id,kind,version,data FROM public.planner_entities ORDER BY id')).rows
  const domain=(all:Row[])=>all.filter(r=>['manual-tasks','project',RECEIPT_KIND].includes(r.kind))
  try{
    stage='database-identity'
    validateRuntimeIsolation(pool,isolation)
    const actual=(await pool.query("SELECT current_database() AS db,inet_server_port() AS port,host(inet_server_addr()) AS host,current_setting('server_version_num')::int AS version")).rows[0]
    check(actual.db===database&&actual.port===18533&&actual.host==='127.0.0.1'&&actual.version>=170000&&actual.version<180000)
    lock=await pool.connect()
    check((await lock.query('SELECT pg_try_advisory_lock(817349) AS acquired')).rows[0].acquired===true)
    stage='empty-namespace'
    // Conservative ownership policy: accept EMPTY only, never adopt old rows.
    // Existing parent SQL-checkpoint rows must not be cleared by this runner.
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename")).rows.map(r=>r.tablename)
    check(canonicalJson(tables)===canonicalJson(['planner_entities','planner_runs']))
    check((await rows()).length===0)
    const runs=(await pool.query('SELECT id,day,last_success,error,summary,requested FROM planner_runs')).rows
    check(runs.length===1&&runs[0].id===1&&runs[0].day===null&&runs[0].last_success===null&&runs[0].error===null&&runs[0].summary===null&&runs[0].requested===false)
    // Bootstrap resolution/preflight occurs before admitting any intent/write.
    stage='official-bootstrap'
    await preflight()
    for(const seed of selectedSeeds){
      campaignSeed=seed
      check(!shutdown.signal.aborted)
      let expiryProbe=false,clockOffset=0,seedModelCalls=0
      const bridge:TaskBridge=async(input,signal)=>{
        if(expiryProbe){
          clockOffset=input.expiresAt-Date.now()+1
          try{
            const denied=await fetch(origin+TASK_CALLBACK_PATH,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+input.callbackCapability,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'}),signal:AbortSignal.timeout(5000)})
            check(denied.status===403)
          }finally{clockOffset=0}
          return {status:'finished'}
        }
        check(input.mode==='product-action'&&modelCalls<(clarificationCampaign?4:6)&&seedModelCalls<(clarificationCampaign?4:3))
        modelCalls++;seedModelCalls++
        const result=await invoke(input,signal)
        evidence.push(result)
        return {status:'finished'}
      }
      const app=authenticatedRuntimeFixture({pool,bridge,origin,isolation,isolatedSyntheticOnly:true,now:()=>Date.now()+clockOffset})
      const store=new SqlIntentStore(pool,'synthetic-runtime-acceptance')
      let cookie=''
      const request=async(path:string,body?:unknown,auth=true,requestOrigin=origin)=>{
        const headers:Record<string,string>={...(auth?{Cookie:cookie}:{})}
        if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=requestOrigin}
        return fetch(origin+path,{method:body===undefined?'GET':'POST',headers,redirect:'error',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(110000)])})
      }
      const action=async(key:string,prompt:string)=>{
        const response=await request(ACTION_PATH,{key,prompt})
        check(response.status===200)
        const body=await response.json() as {summary:IntentSummary}
        check(body.summary.phase==='completed'&&body.summary.pending===0)
        const record=await store.read(key)
        check(record.phase==='completed'&&record.rounds===1&&record.calls.length<=12)
        return {summary:body.summary,record}
      }
      try{
        stage='listen-loopback'
        await app.listen({host:'127.0.0.1',port:18534})
        stage='http-auth-refusals'
        const before=canonicalJson(await rows())
        const admission={key:`dcc_qa_${seed}_refusal`,prompt:'Synthetic refusal; no action.'}
        check((await request(TASK_ACTION_PATH,admission,false)).status===401)
        const anonymous=await request('/api/v1/auth/session',undefined,false)
        const anonymousBody=await anonymous.json() as Record<string,unknown>
        check(anonymousBody.authenticated===false&&!Object.hasOwn(anonymousBody,'workspaceOwner'))
        const login=await request('/api/v1/auth/login',{username:'synthetic-qa',password:'synthetic-isolated-qa-only'},false)
        check(login.status===200)
        cookie=(login.headers.get('set-cookie')??'').split(';')[0]??''
        check(/^daymark_session=[a-f0-9]{64}$/.test(cookie))
        const loginBody=await login.json() as Record<string,unknown>
        const session=await (await request('/api/v1/auth/session')).json() as Record<string,unknown>
        check(session.authenticated===true&&session.workspaceOwner===loginBody.workspaceOwner)
        check((await request(TASK_ACTION_PATH,admission,true,'http://127.0.0.1:18535')).status===403)
        check((await fetch(origin+TASK_CALLBACK_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"ping"}',redirect:'error',signal:AbortSignal.timeout(5000)})).status===403)
        check(canonicalJson(await rows())===before)

        if(clarificationCampaign){
          stage='cse-question'
          const clientId='11111111-1111-4111-a111-111111111111'
          const prompt='I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks'
          const workspaceOwner=String(loginBody.workspaceOwner)
          const first={op:'start',workspaceOwner,clientId,key:'dcc_qa_cse_question_01',prompt}
          const call=async(body:unknown)=>{
            const response=await request(CONVERSATION_PATH,body);check(response.status===200)
            const v:unknown=await response.json();check(validConversationView(v));return v
          }
          const q=await call(first)
          check(q.receipt.outcome==='question'&&!!q.question&&q.original===prompt)
          check(!(await rows()).some(r=>r.id===COLLECTION))
          const general=campaign==='clarification-general'
          const answer={op:'answer',workspaceOwner,clientId,rootKey:q.rootKey,key:'dcc_qa_cse_answer_01',parentKey:q.turnKey,questionId:q.question.id,answer:general?'just general chunks':'Lectures, practice problems, and review'}
          const admittedDays=new Set([nyDate(Date.now())])
          stage='cse-unique-answer-and-write'
          const competing={...answer,key:'dcc_qa_cse_competing_01'}
          const concurrent=await Promise.all([request(CONVERSATION_PATH,answer),request(CONVERSATION_PATH,competing)])
          check(concurrent.filter(r=>r.status===200).length===1&&concurrent.filter(r=>r.status===409).length===1)
          const winner=concurrent[0]!.status===200?answer:competing
          const raw:unknown=await concurrent.find(r=>r.status===200)!.json();check(validConversationView(raw));const result:ConversationView=raw
          check(result.receipt.outcome==='complete'&&result.receipt.verified===3&&result.receipt.expected===3&&result.original===undefined)
          check(result.receipt.targets.length===3&&new Set(result.receipt.targets.map(t=>t.id)).size===3)
          const titles=general?['CSE354: Study chunk 1','CSE354: Study chunk 2','CSE354: Study chunk 3']:['CSE354: Lectures','CSE354: practice problems','CSE354: review']
          check(canonicalJson(result.receipt.targets.map(t=>t.title).sort())===canonicalJson(titles.sort()))
          admittedDays.add(nyDate(Date.now())) // Handles a legitimate NY-midnight boundary during execution.
          check(result.receipt.targets.every(t=>typeof t.date==='string'&&admittedDays.has(t.date)&&t.verification==='verified'))
          const saved=canonicalJson(await rows()),beforeReplay=modelCalls
          check(canonicalJson(await call(winner))===canonicalJson(result)&&modelCalls===beforeReplay&&canonicalJson(await rows())===saved)
          check((await request(CONVERSATION_PATH,{...winner,answer:'Changed answer'})).status===409)
          check((await request(CONVERSATION_PATH,{...winner,clientId:'22222222-2222-4222-a222-222222222222'})).status===409)
          check((await request(CONVERSATION_PATH,{...winner,workspaceOwner:'c'.repeat(64)})).status===409)
          check((await request(CONVERSATION_PATH,winner,false)).status===401)
          check((await request(CONVERSATION_PATH,winner,true,'http://127.0.0.1:18535')).status===403)
          const journal=await store.read(winner.key)
          check(journal.guard?.checklist?.tasks.length===3&&journal.calls.filter(c=>c.command.tool==='create_task').length===3)
          await receiptProof(pool,journal.calls)
          stage='cse-http-readback'
          const http=await (await request('/api/v1/planner/manual-tasks')).json() as {data:{tasks:Record<string,unknown>[]}}
          check(http.data.tasks.length===3&&result.receipt.targets.every(t=>http.data.tasks.some(task=>task.id===t.id&&task.title===t.title&&task.date===t.date&&!task.deleted)))
          stage='direct-three-names'
          const direct=await call({op:'start',workspaceOwner,clientId,key:'dcc_qa_direct_named_01',prompt:'Add 3 tasks today: QA lectures; QA problems; QA review'})
          check(!direct.question&&direct.receipt.outcome==='complete'&&direct.receipt.expected===3&&direct.receipt.verified===3)
          const directRecord=await store.read(direct.turnKey);await receiptProof(pool,directRecord.calls)
          check(!directRecord.calls.some(c=>c.command.tool==='request_clarification'))
          check((await rows()).find(r=>r.id===COLLECTION)?.data.tasks.length===6&&seedModelCalls===3)
          check((await rows()).filter(r=>r.kind==='dcc-hermes-conversation-v1').every(r=>!Object.hasOwn(r.data,'original')&&!Object.hasOwn(r.data,'prompt')&&canonicalJson(r.data.answers)==='[]'))
          continue
        }

        stage='model-task-create-complete'
        const taskTitle=`DCC QA task ${seed}`,taskKey=`dcc_qa_${seed}_task_roundtrip`
        const initial=await rows(),oldCollection=initial.find(r=>r.id===COLLECTION),oldTasks=oldCollection?.data.tasks??[]
        const taskPrompt=`Synthetic isolated QA. Create exactly one standalone task titled "${taskTitle}", date 2026-11-05, notes "Synthetic receipt check", important true. Then mark that newly created task completed. Do not change anything else. Read tasks for [2026-11-05,2026-11-06), limit 25 offset 0 before writes and after completion. Use current collection versions. No calendar or project actions. Backend owns IDs and keys.`
        const task=await action(taskKey,taskPrompt)
        check(task.summary.effects.length===2&&task.summary.effects[0]?.tool==='create_task'&&task.summary.effects[1]?.tool==='set_task_completed'&&task.summary.effects.every(e=>e.state==='applied'))
        const saved=await rows(),collection=saved.find(r=>r.id===COLLECTION)!
        check(collection.version===(oldCollection?.version??0)+2&&collection.data.tasks.length===oldTasks.length+1)
        const created=collection.data.tasks.find((t:Record<string,unknown>)=>t.title===taskTitle)
        check(created?.date==='2026-11-05'&&created.notes==='Synthetic receipt check'&&created.important===true&&created.completed===true&&!created.deleted)
        check(canonicalJson(collection.data.tasks.filter((t:Record<string,unknown>)=>t.id!==created.id))===canonicalJson(oldTasks))
        check(task.summary.effects.every(e=>e.id===created.id))
        const taskHTTP=await (await request('/api/v1/planner/manual-tasks')).json()
        check(canonicalJson(taskHTTP)===canonicalJson({version:collection.version,data:collection.data}))
        const lastWrite=task.record.calls.map(c=>c.command.tool).lastIndexOf('set_task_completed')
        check(task.record.calls.slice(lastWrite+1).some(c=>c.command.tool==='list_tasks'&&c.result?.state==='ok'&&Array.isArray((c.result.data as {items?:unknown[]}).items)&&(c.result.data as {items:Record<string,unknown>[]}).items.some(t=>t.id===created.id&&t.completed===true&&t.version===collection.version)))
        await receiptProof(pool,task.record.calls)

        stage='http-replay-and-payload-conflict'
        const stable=canonicalJson(await rows()),callsBefore=modelCalls
        const replay=await action(taskKey,taskPrompt)
        check(canonicalJson(replay.summary)===canonicalJson(task.summary)&&modelCalls===callsBefore&&canonicalJson(await rows())===stable)
        check((await request(ACTION_PATH,{key:taskKey,prompt:taskPrompt+' Changed payload.'})).status===409)
        check(modelCalls===callsBefore&&canonicalJson(await rows())===stable)

        stage='model-assignment'
        const assignmentTitle=`DCC QA assignment ${seed}`
        const assignment=await action(`dcc_qa_${seed}_assignment`,`Synthetic isolated QA. Create exactly one assignment titled "${assignmentTitle}", description "Synthetic assignment check", deadline 2026-11-20, category school, importance 2, remainingMinutes 30, progress "Not started". No daily actions or scheduling. Do not change existing tasks or projects. Read projects first, limit 25 offset 0; then read back this assignment by its backend-generated ID.`)
        check(assignment.summary.effects.length===1&&assignment.summary.effects[0]?.tool==='create_assignment'&&assignment.summary.effects[0].state==='applied')
        const assignmentId=assignment.summary.effects[0]!.id,afterAssignment=await rows()
        const project=afterAssignment.find(r=>r.id===assignmentId&&r.kind==='project')
        check(project?.version===1&&project.data.title===assignmentTitle&&project.data.kind==='assignment'&&project.data.deadline==='2026-11-20'&&project.data.status==='active'&&project.data.description==='Synthetic assignment check'&&project.data.category==='school'&&project.data.importance===2&&project.data.remainingMinutes===30&&project.data.progress==='Not started')
        check(canonicalJson(afterAssignment.find(r=>r.id===COLLECTION))===canonicalJson(collection))
        check(afterAssignment.filter(r=>r.kind==='project').length===initial.filter(r=>r.kind==='project').length+1)
        check(afterAssignment.filter(r=>r.kind===RECEIPT_KIND).length===initial.filter(r=>r.kind===RECEIPT_KIND).length+3)
        const snapshot=await (await request('/api/v1/planner/snapshot')).json() as {projects:unknown[]}
        check(snapshot.projects.some(p=>canonicalJson(p)===canonicalJson({kind:'project',version:1,data:project!.data})))
        check(assignment.record.calls.slice(assignment.record.calls.findIndex(c=>c.command.tool==='create_assignment')+1).some(c=>c.command.tool==='list_projects'&&c.result?.state==='ok'&&Array.isArray((c.result.data as {items?:unknown[]}).items)&&(c.result.data as {items:Record<string,unknown>[]}).items.some(p=>p.id===assignmentId&&p.title===assignmentTitle&&p.deadline==='2026-11-20'&&p.kind==='assignment'&&p.version===1)))
        await receiptProof(pool,assignment.record.calls)

        stage='model-typed-clarification'
        const beforeClarification=canonicalJson(domain(await rows()))
        const clarification=await action(`dcc_qa_${seed}_clarification`,'Synthetic isolated QA. Update the progress of my project to "Ready". I have not identified which project or assignment. Do not guess the target; ask which exact project or assignment I mean and stop without any write. No calendar operations.')
        check(clarification.summary.effects.length===0&&clarification.summary.clarifications?.length===1&&clarification.summary.clarifications.every(validClarification)&&clarification.summary.clarifications[0]?.reason==='ambiguous_project')
        check(canonicalJson(domain(await rows()))===beforeClarification)

        stage='expired-active-capability'
        expiryProbe=true
        const beforeExpiry=canonicalJson(domain(await rows())),modelsBeforeExpiry=modelCalls
        const expired=await action(`dcc_qa_${seed}_expired_grant`,'Synthetic host-only expired-capability refusal. No model invocation or effects.')
        check(expired.summary.effects.length===0&&expired.record.calls.length===0&&modelCalls===modelsBeforeExpiry&&canonicalJson(domain(await rows()))===beforeExpiry)
        check(seedModelCalls===3)
      }finally{
        // Only this app instance owns its listener. Never stop another service.
        await app.close()
      }
    }
    stage='evidence'
    check(modelCalls===(clarificationCampaign?3:6)&&evidence.length===modelCalls&&evidence.every(e=>e.model==='gpt-6-luna'&&e.schemaCount===35&&e.schemasUnchanged===true&&/^[a-f0-9]{64}$/.test(e.schemaSha256)))
    check(new Set(evidence.map(e=>e.schemaSha256)).size===1)
    const final=await rows()
    check(final.length===(clarificationCampaign?16:25)&&final.every(r=>['manual-tasks','project',RECEIPT_KIND,'dcc-request-intent-v1','hermes-command',...(clarificationCampaign?['dcc-hermes-conversation-v1','dcc-hermes-client-v1']:[])].includes(r.kind)))
    console.log(JSON.stringify({status:'passed',stage,seeds:selectedSeeds,campaign:campaign??'core',modelCalls,assertions,evidence,rowsRetained:(await rows()).length,publicTLSProven:false,fullMatrixPending:265}))
  }finally{
    try{if(lock){try{await lock.query('SELECT pg_advisory_unlock(817349)')}finally{lock.release()}}}
    finally{await pool.end()}
  }
}

async function receiptProof(pool:Pool,calls:Awaited<ReturnType<SqlIntentStore['read']>>['calls']){
  for(const call of calls.filter(c=>['create_task','set_task_completed','create_assignment'].includes(c.command.tool))){
    const receipt=(await pool.query("SELECT data FROM planner_entities WHERE kind=$1 AND data->>'key'=$2",[RECEIPT_KIND,call.command.args.operationKey])).rows
    check(receipt.length===1&&receipt[0].data.tool===call.command.tool&&receipt[0].data.state==='applied'&&canonicalJson(receipt[0].data.result)===canonicalJson(call.result))
  }
}

async function preflight(){
  const launcher=fileURLToPath(new URL('../../deploy/task_action_launcher.py',import.meta.url))
  await subprocess(launcher,['--preflight'],undefined,undefined,false)
}
async function invoke(input:Parameters<TaskBridge>[0],signal:AbortSignal){
  const output=await subprocess(script,[],input,signal,true)
  const parsed=JSON.parse(output) as {status:string;evidence:Evidence}
  check(parsed.status==='finished'&&parsed.evidence.model==='gpt-6-luna'&&parsed.evidence.schemaCount===35&&parsed.evidence.schemasUnchanged===true)
  return parsed.evidence
}
function subprocess(path:string,args:string[],input:Parameters<TaskBridge>[0]|undefined,signal:AbortSignal|undefined,model:boolean):Promise<string>{
  return new Promise((resolve,reject)=>{
    // /usr/bin/python3 is ONLY the stdlib launcher, not a guessed Hermes Python.
    const child=spawn('/usr/bin/python3',[path,...args],{detached:true,cwd:'/root/.hermes/profiles/daymark-curator',stdio:['pipe','pipe','ignore'],env:{...process.env,HERMES_HOME:'/root/.hermes/profiles/daymark-curator',...(input?{DCC_TASK_CALLBACK_CAPABILITY:input.callbackCapability,DCC_TASK_CALLBACK_EXPIRES_AT:String(input.expiresAt)}:{})}})
    let output='',failed=false
    const terminate=()=>{failed=true;if(child.pid){try{process.kill(-child.pid,'SIGTERM')}catch{/* Already exited. */}}}
    const timeout=setTimeout(terminate,model?105000:15000)
    const kill=setTimeout(()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL')}catch{/* Already exited. */}}},model?110000:20000)
    const cancellation=AbortSignal.any([shutdown.signal,...(signal?[signal]:[])])
    cancellation.addEventListener('abort',terminate,{once:true})
    if(cancellation.aborted)terminate()
    child.stdout.on('data',chunk=>{output+=String(chunk);if(Buffer.byteLength(output)>4096)terminate()})
    child.stdin.on('error',()=>{failed=true})
    child.on('error',()=>{failed=true})
    child.once('close',code=>{
      clearTimeout(timeout);clearTimeout(kill);cancellation.removeEventListener('abort',terminate)
      // Clean only descendants of the process group created by THIS spawn.
      if(child.pid){try{process.kill(-child.pid,'SIGTERM')}catch{/* Group already gone. */}}
      if(failed||code!==0||(!model&&output.trim()!=='{"status":"runtime_ready"}'))reject(Error('Isolated runtime unavailable'))
      else resolve(output)
    })
    child.stdin.end(input?JSON.stringify({prompt:input.prompt}):undefined)
  })
}

main().catch(()=>{console.log(JSON.stringify({status:'failed',stage,campaignSeed,modelCalls,assertions,fullMatrixPending:265}));process.exitCode=1}).finally(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)})
