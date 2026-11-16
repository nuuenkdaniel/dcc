// Parent opt-in ONLY. Exactly two possible agent launches, no campaign/retry.
// Logs are fixed stages/counts/booleans, never prompts, text or driver errors.
import {spawn} from 'node:child_process'
import {open} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {Pool,type PoolClient} from 'pg'
import {authenticatedRuntimeFixture,type RuntimeIsolation} from '../mcp/authenticated-runtime-fixture.js'
import {type TaskBridge,type TaskBridgeInput} from '../../src/mcp/task-actions.js'
import {CONVERSATION_PATH} from '../../src/mcp/conversation.js'
import {validConversationView,type ConversationView} from '../../src/mcp/conversation-wire.js'
import {validRuntimeCompletion,type RuntimeCompletion} from '../../src/mcp/assistant-reply.js'
import {COLLECTION,RECEIPT_KIND,canonicalJson} from '../../src/mcp/service-transport.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {TOOLS} from '../../src/mcp/contracts.js'
import {nyDate} from '../../src/mcp/conversation-contract.js'

const origin='http://127.0.0.1:18534',budget='/root/.hermes/profiles/project-manager/cache/scratch/dcc-natural-replies-two-turn-v1.consumed'
const script=fileURLToPath(new URL('./runtime_loopback.py',import.meta.url))
const launcher=fileURLToPath(new URL('../../deploy/task_action_launcher.py',import.meta.url))
const clientId='11111111-1111-4111-a111-111111111111'
const shutdown=new AbortController()
let stage='approval',modelCalls=0,assertions=0
function check(value:unknown):asserts value {if(!value)throw Error('Synthetic acceptance failed');assertions++}
type Row={id:string;kind:string;version:number;data:Record<string,any>}
type Evidence={model:string;schemaCount:number;schemaSha256:string;schemasUnchanged:boolean}
const evidence:Evidence[]=[]
const stop=()=>shutdown.abort()
process.once('SIGINT',stop);process.once('SIGTERM',stop)

async function child(path:string,args:string[],input?:TaskBridgeInput,signal?:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
    const env={...process.env,HERMES_HOME:'/root/.hermes/profiles/daymark-curator',...(input?{DCC_TASK_CALLBACK_CAPABILITY:input.callbackCapability,DCC_TASK_CALLBACK_EXPIRES_AT:String(input.expiresAt),DCC_QA_REPLY_APPROVED:'two-consumed-turns',DCC_QA_REPLY_SLOT:String(modelCalls)}:{})}
    const processChild=spawn('/usr/bin/python3',[path,...args],{detached:true,cwd:'/root/.hermes/profiles/daymark-curator',stdio:['pipe','pipe','ignore'],env})
    let output='',failed=false
    const kill=(sig:NodeJS.Signals)=>{if(processChild.pid){try{process.kill(-processChild.pid,sig)}catch{/* Only this child group. */}}}
    const cancel=()=>{failed=true;kill('SIGTERM')}
    const timeout=setTimeout(cancel,input?105000:15000),hardStop=setTimeout(()=>kill('SIGKILL'),input?110000:20000)
    const abort=AbortSignal.any([shutdown.signal,...(signal?[signal]:[])])
    abort.addEventListener('abort',cancel,{once:true});if(abort.aborted)cancel()
    processChild.stdout.on('data',chunk=>{output+=String(chunk);if(Buffer.byteLength(output)>32768)cancel()})
    processChild.stdin.on('error',()=>{failed=true});processChild.on('error',()=>{failed=true})
    processChild.once('close',code=>{
      clearTimeout(timeout);clearTimeout(hardStop);abort.removeEventListener('abort',cancel);kill('SIGTERM')
      if(failed||code!==0)reject(Error('Synthetic runtime unavailable'));else resolve(output)
    })
    processChild.stdin.end(input?JSON.stringify({prompt:input.prompt,replyVersion:1}):undefined)
  })
}
async function main(){
  check(process.argv.length===2&&process.env.DCC_QA_RUNTIME_APPROVED==='synthetic-loopback-model'&&process.env.DCC_QA_NATURAL_REPLIES==='consume-two-once')
  check(!Object.keys(process.env).some(k=>k.startsWith('PG')||['DATABASE_URL','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','DCC_QA_RUNTIME_CAMPAIGN'].includes(k)||/(?:URL|API_BASE|HOST|ENDPOINT|PROXY)$/i.test(k)))
  const database=process.env.DCC_QA_DATABASE??'',user=process.env.DCC_QA_PG_USER??''
  check(/^dcc_qa_[a-z0-9_]{1,48}$/.test(database)&&/^[a-z_][a-z0-9_]{0,62}$/.test(user))
  const isolation:RuntimeIsolation={database:{host:'127.0.0.1',port:18533,name:database,disposable:true},syntheticDataOnly:true,model:'gpt-6-luna',modelInvocationApproved:true,calendar:'none',calendarOrigins:[]}
  const pool=new Pool({host:'127.0.0.1',port:18533,database,user,password:'synthetic-isolated-qa-only',ssl:false,max:4,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c search_path=public'})
  pool.on('error',()=>{/* No connection/driver diagnostics. */})
  let lock:PoolClient|undefined,app:ReturnType<typeof authenticatedRuntimeFixture>|undefined
  const rows=async()=> (await pool.query<Row>('SELECT id,kind,version,data FROM public.planner_entities ORDER BY id')).rows
  try{
    stage='isolated-identity'
    const identity=(await pool.query("SELECT current_database() AS db,inet_server_port() AS port,host(inet_server_addr()) AS host,current_setting('server_version_num')::int AS version")).rows[0]
    check(identity.db===database&&identity.port===18533&&identity.host==='127.0.0.1'&&identity.version>=170000&&identity.version<180000)
    lock=await pool.connect();check((await lock.query('SELECT pg_try_advisory_lock(817349) AS acquired')).rows[0].acquired===true)
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename")).rows.map(r=>r.tablename)
    check(canonicalJson(tables)===canonicalJson(['planner_entities','planner_runs'])&&(await rows()).length===0)
    const runs=(await pool.query('SELECT id,day,last_success,error,summary,requested FROM planner_runs')).rows
    check(runs.length===1&&runs[0].id===1&&runs[0].day===null&&runs[0].last_success===null&&runs[0].error===null&&runs[0].summary===null&&runs[0].requested===false)
    stage='consume-entire-budget'
    const marker=await open(budget,'wx',0o600)
    try{await marker.writeFile('two-turn-budget-v1\n');await marker.sync()}finally{await marker.close()}
    const directory=await open('/root/.hermes/profiles/project-manager/cache/scratch','r');try{await directory.sync()}finally{await directory.close()}
    stage='official-bootstrap'
    check((await child(launcher,['--preflight'])).trim()==='{"status":"runtime_ready"}')
    const bridge:TaskBridge=async(input,signal)=>{
      check(input.mode==='product-action'&&input.replyVersion===1&&modelCalls<2&&!shutdown.signal.aborted)
      modelCalls++ // Consumed even if spawning/transport/result validation fails.
      const result=JSON.parse(await child(script,[],input,signal)) as {status:unknown;evidence:Evidence;completion:RuntimeCompletion}
      check(result.status==='finished'&&validRuntimeCompletion(result.completion)&&result.evidence.model==='gpt-6-luna'&&result.evidence.schemaCount===35&&result.evidence.schemasUnchanged===true&&/^[a-f0-9]{64}$/.test(result.evidence.schemaSha256))
      evidence.push(result.evidence);return result.completion
    }
    app=authenticatedRuntimeFixture({pool,bridge,origin,isolation,isolatedSyntheticOnly:true})
    const store=new SqlIntentStore(pool,'synthetic-runtime-acceptance')
    const today=nyDate(Date.now()),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10)
    const tasks=Array.from({length:4},(_,i)=>({id:`11111111-1111-4111-a111-${String(i+1).padStart(12,'0')}`,title:i<3?`Study chunk ${i+1}`:'Unrelated reminder',date:today,notes:`Synthetic retained notes ${i}`,important:i===1,completed:false,deleted:false,sourceId:'synthetic-retained-link'}))
    const unrelated={id:'99999999-9999-4999-a999-999999999999',kind:'project',version:1,data:{title:'Synthetic unrelated project'}}
    await pool.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3)',[COLLECTION,'manual-tasks',{tasks}])
    await pool.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3)',[unrelated.id,unrelated.kind,unrelated.data])
    const before=await rows()
    stage='listen-loopback';await app.listen({host:'127.0.0.1',port:18534})
    let cookie=''
    const request=async(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(110000)])})
    const login=await request('/api/v1/auth/login',{username:'synthetic-qa',password:'synthetic-isolated-qa-only'});check(login.status===200)
    cookie=(login.headers.get('set-cookie')??'').split(';')[0]??'';check(/^daymark_session=[a-f0-9]{64}$/.test(cookie))
    const owner=(await login.json() as {workspaceOwner:string}).workspaceOwner
    const discovery=await request('/api/v1/hermes/action-capabilities');check((await discovery.json() as {conversationReplyVersion:number}).conversationReplyVersion===1)
    const call=async(key:string,prompt:string,entries:{role:'user'|'assistant';text:string;at:number}[])=>{
      const r=await request(CONVERSATION_PATH,{op:'start',workspaceOwner:owner,clientId,key,prompt,replyVersion:1,context:{version:1,entries}})
      check(r.status===200);const v:unknown=await r.json();check(validConversationView(v)&&!!v.assistantReply);return v as ConversationView
    }
    stage='move-three-contextual'
    const move=await call('natural_reply_move_0001','Move the three study chunks to tomorrow. Change only their dates, not their names, notes, flags or links. Leave unrelated tasks and projects unchanged. Read back the results and briefly explain what changed.',[{role:'user',text:'We are discussing the three existing study chunks. These are existing tasks, not a request to create replacements.',at:Date.now()}])
    check(move.receipt.outcome==='partial'&&move.receipt.expected===null&&move.receipt.verified===3&&move.receipt.targets.length===3&&move.continuable===true)
    check(move.receipt.targets.every(t=>t.kind==='task'&&t.action==='updated'&&t.verification==='verified'&&t.state==='applied'&&t.date===tomorrow&&tasks.slice(0,3).some(task=>task.id===t.id)))
    const moved=await rows(),collection=moved.find(r=>r.id===COLLECTION)!
    check(canonicalJson(collection.data.tasks)===canonicalJson(tasks.map((t,i)=>i<3?{...t,date:tomorrow}:t)))
    check(canonicalJson(moved.find(r=>r.id===unrelated.id))===canonicalJson(before.find(r=>r.id===unrelated.id)))
    const journal=await store.read(move.turnKey),writes=journal.calls.filter(c=>TOOLS[c.command.tool].write)
    check(journal.phase==='completed'&&journal.calls.length<=12&&journal.rounds===1&&writes.length===3&&writes.every(c=>c.command.tool==='update_task'&&c.result?.state==='applied'))
    const lastWrite=Math.max(...journal.calls.map((c,i)=>TOOLS[c.command.tool].write?i:-1))
    check(journal.calls.slice(lastWrite+1).some(c=>c.command.tool==='list_tasks'&&c.result?.state==='ok'&&Array.isArray((c.result.data as any).items)&&tasks.slice(0,3).every(t=>(c.result!.state==='ok'?(c.result!.data as any).items:[]).some((item:any)=>item.id===t.id&&item.date===tomorrow))))
    for(const write of writes){const receipts=(await pool.query('SELECT data FROM planner_entities WHERE kind=$1 AND data->>\'key\'=$2',[RECEIPT_KIND,write.command.args.operationKey])).rows;check(receipts.length===1&&receipts[0].data.tool==='update_task'&&canonicalJson(receipts[0].data.result)===canonicalJson(write.result))}
    const domain=canonicalJson(moved.filter(r=>['manual-tasks','project',RECEIPT_KIND].includes(r.kind)))
    stage='explain-context-without-writes'
    const clipped=move.assistantReply!.text.slice(0,320).replace(/[\ud800-\udbff]$/,'')
    const explanation=await call('natural_reply_explain_0001','Explain what changed in the previous turn using the recent context. Do not modify any records. Read current tasks if needed. Keep it brief.',[{role:'user',text:'Move the three study chunks to tomorrow.',at:Date.now()},{role:'assistant',text:clipped,at:Date.now()}])
    check(explanation.receipt.outcome==='read-only'&&explanation.receipt.expected===null&&explanation.receipt.verified===0)
    const explained=await store.read(explanation.turnKey);check(explained.phase==='completed'&&explained.calls.length<=12&&explained.calls.every(c=>!TOOLS[c.command.tool].write))
    check(canonicalJson((await rows()).filter(r=>['manual-tasks','project',RECEIPT_KIND].includes(r.kind)))===domain)
    check(modelCalls===2&&evidence.length===2&&evidence[0]!.schemaSha256===evidence[1]!.schemaSha256)
    check(nyDate(Date.now())===today) // Midnight ambiguity fails; never retries.
    stage='complete'
    console.log(JSON.stringify({status:'passed',stage,modelCalls,budgetConsumed:2,assertions,exactTargets:true,datesOnly:true,unrelatedUnchanged:true,replyPresent:true,followupReadOnly:true,moveOutcome:move.receipt.outcome,moveVerified:move.receipt.verified,explanationOutcome:explanation.receipt.outcome,publicTLSProven:false}))
  }finally{
    try{if(app)await app.close()}finally{try{if(lock){try{await lock.query('SELECT pg_advisory_unlock(817349)')}finally{lock.release()}}}finally{await pool.end()}}
  }
}
main().catch(()=>{console.log(JSON.stringify({status:'failed',stage,modelCalls,assertions,budgetLimit:2,noRetry:true}));process.exitCode=1}).finally(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)})
