// Opt-in, synthetic REAL PostgreSQL acceptance. No listener, subprocess, model,
// provider, .env, migrations, DDL, deletes or automatic database provisioning.
import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Pool,type PoolClient} from 'pg'
import {buildApp} from '../../src/app.js'
import {TaskActions} from '../../src/mcp/task-actions.js'
import {Conversations,CONVERSATION_PATH,type ConversationInput} from '../../src/mcp/conversation.js'
import {RequestController} from '../../src/mcp/request-controller.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {ACTIVE_TOOLS} from '../../src/mcp/contracts.js'
import type {ManualTask} from '../../src/manual-tasks.js'

const binding=process.env.DCC_CHECKLIST_TEST_DATABASE_URL
const options={skip:!binding,timeout:20000}
const policy={executor:'mcp-action-v1' as const,allowedTools:ACTIVE_TOOLS}
const now=()=>Date.parse('2026-11-08T02:00:00Z'),date='2026-11-07'
type Row={id:string;kind:string;version:number;data:Record<string,unknown>}
let pool:Pool|undefined,lease:PoolClient|undefined
let initialPlannerRun:Record<string,unknown>|undefined
function db(){assert.ok(pool);return pool}
before(async()=>{
  if(!binding)return
  const url=new URL(binding),port=Number(url.port),database=decodeURIComponent(url.pathname.slice(1))
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&['127.0.0.1','[::1]'].includes(url.hostname),'Explicit literal-loopback PostgreSQL URL required')
  assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535&&![3001,5301,5432].includes(port),'Dedicated non-default isolated port required')
  assert.match(database,/^dcc_checklist_test_[a-z0-9_]{1,40}$/)
  assert.ok(url.username&&!url.search&&!url.hash,'Explicit test user and no URL overrides required')
  pool=new Pool({host:url.hostname==='[::1]'?'::1':url.hostname,port,database,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)||'synthetic-checklist-only',ssl:false,max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,options:'-c search_path=public -c statement_timeout=5000 -c lock_timeout=3000',application_name:'dcc-checklist-isolated-test'})
  lease=await pool.connect()
  const target=(await lease.query('SELECT current_database() AS name,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0]
  assert.equal(target.name,database);assert.equal(target.port,port);assert.ok(['127.0.0.1','::1'].includes(target.host))
  assert.equal((await lease.query('SELECT pg_try_advisory_lock(817351) AS owned')).rows[0].owned,true,'Another fixture owns this database')
  assert.deepEqual((await lease.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),['planner_entities','planner_runs'])
  assert.equal(Number((await lease.query('SELECT count(*) AS count FROM planner_entities')).rows[0].count),0,'Use a fresh empty disposable database, including after a failed campaign')
  assert.equal((await lease.query('SELECT * FROM planner_runs')).rowCount,1)
  const run=(await lease.query('SELECT * FROM planner_runs WHERE id=1')).rows[0]
  assert.equal(run.requested,false);assert.equal(run.day,null);assert.equal(run.last_success,null);assert.equal(run.error,null);assert.equal(run.summary,null)
  initialPlannerRun=run
  const unrelated={id:randomUUID(),title:'Synthetic unrelated task',date,notes:'Preserve exactly',completed:false,important:false,deleted:false}
  await pool.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3)',[COLLECTION,'manual-tasks',{tasks:[unrelated]}])
  const id=randomUUID()
  await pool.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3)',[id,'project',{id,title:'Synthetic unrelated project',category:'personal',status:'active',description:'',progress:'',deadline:'',importance:1,remainingMinutes:0}])
})
after(async()=>{lease?.release();await pool?.end()})
async function rows():Promise<Row[]>{return (await db().query<Row>('SELECT id,kind,version,data FROM planner_entities ORDER BY id')).rows}
function tasks(saved:Row[]){return (saved.find(r=>r.id===COLLECTION)?.data.tasks??[]) as ManualTask[]}
async function unchangedPrior(before:Row[]){
  assert.deepEqual((await db().query('SELECT * FROM planner_runs WHERE id=1')).rows[0],initialPlannerRun,'Task-only execution must not alter planner scheduling')
  const after=await rows(),byId=new Map(after.map(r=>[r.id,r]))
  for(const row of before)if(row.id!==COLLECTION)assert.deepEqual(byId.get(row.id),row,'Unrelated synthetic row changed')
  const current=tasks(after)
  for(const task of tasks(before))assert.deepEqual(current.find(t=>t.id===task.id),task,'Unrelated synthetic task changed')
  const oldIds=new Set(tasks(before).map(t=>t.id))
  return current.filter(t=>!oldIds.has(t.id))
}
function request(count:number){
  const titles=Array.from({length:count},(_,i)=>`Synthetic café 界 ${i+1}`)
  return {op:'start' as const,clientId:randomUUID(),key:randomUUID(),prompt:`Add ${count} tasks today: ${titles.join('; ')}`}
}
function execution(count=3){
  const actorId='checklist-'+randomUUID(),owner='synthetic-owner-'+randomUUID(),input=request(count)
  const store=new SqlIntentStore(db(),actorId),transport=new ServiceTransport({pool:db(),actorId})
  let bridgeCalls=0,prepared:Parameters<RequestController['run']>[0]|undefined
  const makeController=()=>new RequestController({store:new SqlIntentStore(db(),actorId),transport,now,nativeRunner:async()=>{bridgeCalls++;throw Error('Synthetic external bridge unavailable')}})
  const controller=makeController()
  let run=(value:Parameters<RequestController['run']>[0],signal?:AbortSignal)=>controller.run(value,policy,signal)
  const conversations=new Conversations({pool:db(),store,transport,now,run:(value,signal)=>{prepared=value;return run(value,signal)},fence:async value=>{await store.admit({...value,purpose:'action'},policy);await store.fence(value.key,now())}})
  return {input,owner,store,transport,makeController,bridges:()=>bridgeCalls,
    prepared:()=>{assert.ok(prepared);return prepared},setRun:(next:typeof run)=>{run=next},
    start:(signal?:AbortSignal)=>conversations.handle(input,owner,signal),
    read:()=>conversations.handle({op:'read',clientId:input.clientId,rootKey:input.key},owner)}
}
test('host checklist persists three tasks without external bridge',options,async()=>{
  const before=await rows(),sessions=new Set<string>(),input=request(3),origin='http://checklist.invalid'
  input.prompt='i have a CSE 354 exam coming up. I broke my studying into chunks. Im doing 3 chunks today. Can you throw that on my tasks?'
  let bridgeCalls=0
  const actions=new TaskActions({pool:db(),actorId:'http-checklist-'+randomUUID(),now,bridge:async()=>{bridgeCalls++;throw Error('External channel unavailable before third create')}})
  // Exercise the existing authenticated HTTP/API route without a listener.
  const username='synthetic-'+randomUUID()
  const http=buildApp({plannerPool:db(),taskActions:actions,auth:{username,password:'synthetic-checklist-only',origin,store:{put:async id=>{sessions.add(id)},has:async id=>sessions.has(id),remove:async id=>{sessions.delete(id)}}}})
  try{
    const login=await http.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password:'synthetic-checklist-only'}})
    assert.equal(login.statusCode,200)
    const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value
    const session=await http.inject({url:'/api/v1/auth/session',cookies:{daymark_session:cookie}})
    const workspaceOwner=session.json().workspaceOwner
    const post=(body:ConversationInput)=>http.inject({method:'POST',url:CONVERSATION_PATH,headers:{origin},cookies:{daymark_session:cookie},payload:{...body,workspaceOwner}})
    const response=await post(input)
    assert.equal(bridgeCalls,0,'A fully resolved checklist must not need an external channel')
    assert.equal(response.statusCode,200);assert.equal(response.json().receipt.outcome,'complete');assert.equal(response.json().receipt.verified,3);assert.equal(response.json().receipt.expected,3)
    const added=await unchangedPrior(before)
    assert.deepEqual(added.map(t=>({title:t.title,date:t.date})),Array.from({length:3},(_,i)=>({title:`CSE354: Study chunk ${i+1}`,date})))
    assert.deepEqual(response.json().receipt.targets.map((t:{id:string})=>t.id).sort(),added.map(t=>t.id).sort())
    const snapshot=await rows()
    assert.deepEqual((await post(input)).json(),response.json());assert.deepEqual(await rows(),snapshot)
    assert.deepEqual((await post({op:'read',clientId:input.clientId,rootKey:input.key})).json(),response.json())
    assert.equal(bridgeCalls,0)
  }finally{await http.close()}
})
test('real PG one and four goals use exact targets and one bounded host round',options,async()=>{
  for(const count of [1,4]){
    const before=await rows(),h=execution(count),reply=await h.start(),record=await h.store.read(h.input.key)
    assert.equal(reply.receipt.outcome,'complete');assert.equal(reply.receipt.verified,count);assert.equal(record.rounds,1)
    assert.equal(record.calls.length,count*2);assert.equal(record.calls.filter(c=>c.command.tool==='create_task').length,count)
    assert.deepEqual((await unchangedPrior(before)).map(t=>[t.title,t.date]),Array.from({length:count},(_,i)=>[`Synthetic café 界 ${i+1}`,date]))
    assert.equal(h.bridges(),0)
  }
})
test('real PG concurrent fresh claim and same-submission reload never create again',options,async()=>{
  const before=await rows(),h=execution()
  const replies=await Promise.all([h.start(),h.start()])
  assert.ok(replies.some(r=>r.receipt.outcome==='complete'))
  assert.equal((await unchangedPrior(before)).length,3)
  const record=await h.store.read(h.input.key),snapshot=await rows()
  assert.equal(record.calls.filter(c=>c.command.tool==='create_task').length,3)
  assert.equal((await h.start()).receipt.outcome,'complete');assert.equal((await h.read()).receipt.outcome,'complete')
  assert.deepEqual(await rows(),snapshot);assert.equal(h.bridges(),0)
})
test('real PG stale collection version stops after one conflict without retry',options,async()=>{
  const before=await rows(),h=execution(),execute=h.transport.execute.bind(h.transport)
  let creates=0,bumped=false
  h.transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    if(command.tool==='create_task')creates++
    if(command.tool==='list_tasks'&&!bumped){bumped=true;await db().query('UPDATE planner_entities SET version=version+1 WHERE id=$1',[COLLECTION])}
    return result
  }
  const reply=await h.start()
  assert.notEqual(reply.receipt.outcome,'complete');assert.equal(reply.receipt.verified,0);assert.equal(creates,1)
  assert.deepEqual(await unchangedPrior(before),[])
  const record=await h.store.read(h.input.key)
  assert.equal(record.calls.at(-1)!.result!.state,'conflict')
  await h.makeController().run(h.prepared(),policy);assert.equal(creates,1);assert.equal(h.bridges(),0)
})
test('real PG interruption after committed write two reloads two receipts and never admits goal three',options,async()=>{
  const before=await rows(),h=execution(),abort=new AbortController(),execute=h.transport.execute.bind(h.transport)
  let creates=0
  h.transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    if(command.tool==='create_task'&&result.state==='applied'&&++creates===2)abort.abort()
    return result
  }
  const reply=await h.start(abort.signal)
  assert.equal(reply.receipt.outcome,'uncertain');assert.equal(reply.receipt.verified,2);assert.equal(reply.receipt.expected,3)
  assert.equal((await unchangedPrior(before)).length,2)
  await h.makeController().run(h.prepared(),policy)
  const loaded=await h.read(),record=await h.store.read(h.input.key)
  assert.equal(loaded.receipt.verified,2);assert.equal(loaded.receipt.outcome,'uncertain')
  assert.equal(record.calls.length,4);assert.equal(record.calls.filter(c=>c.command.tool==='create_task').length,2);assert.equal(creates,2);assert.equal(h.bridges(),0)
  assert.equal((await unchangedPrior(before)).length,2)
})
test('real PG reserved unknown write is reconciliation-only, never dispatched on reload',options,async()=>{
  const before=await rows(),h=execution()
  h.setRun(async value=>{
    await h.store.admit({...value,purpose:'action'},policy)
    const owner=(await h.store.start(value.key,now())).owner!
    await h.store.round(value.key,owner,now())
    await h.store.reserve(value.key,owner,'unknown_create','create_task',{...value.guard!.checklist!.tasks[0],expectedVersion:(await db().query('SELECT version FROM planner_entities WHERE id=$1',[COLLECTION])).rows[0].version},now())
    return {phase:'uncertain',effects:[],pending:1}
  })
  const reply=await h.start()
  assert.equal(reply.receipt.outcome,'uncertain');assert.equal(reply.receipt.verified,0)
  const summary=await h.makeController().run(h.prepared(),policy)
  assert.equal(summary.phase,'uncertain');assert.equal(summary.pending,1)
  assert.equal((await h.read()).receipt.verified,0);assert.deepEqual(await unchangedPrior(before),[]);assert.equal(h.bridges(),0)
})
test('real PG persisted target mismatch cannot become completed checklist authority',options,async()=>{
  const before=await rows(),h=execution(),execute=h.transport.execute.bind(h.transport)
  let writes=0
  h.transport.execute=async(command,context)=>{
    const result=await execute(command,context)
    if(command.tool==='create_task'&&result.state==='applied'&&++writes===3){
      const row=(await db().query('SELECT data FROM planner_entities WHERE id=$1',[COLLECTION])).rows[0]
      const saved=row.data.tasks as ManualTask[]
      await db().query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[COLLECTION,{...row.data,tasks:saved.map(t=>t.id===result.id?{...t,title:'Synthetic changed readback'}:t)}])
    }
    return result
  }
  const reply=await h.start()
  assert.equal(writes,3);assert.equal(reply.receipt.outcome,'uncertain');assert.equal(reply.receipt.verified,2)
  assert.equal((await h.store.read(h.input.key)).phase,'uncertain')
  assert.equal((await unchangedPrior(before)).length,3);assert.equal(h.bridges(),0)
})
test('real PG unsupported, read-only and clarification requests retain the external path',options,async()=>{
  for(const prompt of ['Add 3 study chunks today using specific topics','Show tasks today','Add a task tomorrow and also update the calendar']){
    const before=await rows(),h=execution();h.input.prompt=prompt
    const reply=await h.start()
    assert.notEqual(reply.receipt.outcome,'complete');assert.equal(h.bridges(),1)
    assert.equal((await h.store.read(h.input.key)).calls.length,0);assert.deepEqual(await unchangedPrior(before),[])
  }
})
