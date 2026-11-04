import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'
import {buildApp} from '../../src/app.js'
import {TaskActions,TASK_ACTION_PATH,ACTION_PATH,TASK_CALLBACK_PATH,TASK_CALLBACK_URL,type TaskBridge} from '../../src/mcp/task-actions.js'
import {TOOLS} from '../../src/mcp/contracts.js'
import {COLLECTION} from '../../src/mcp/service-transport.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {IntentPool} from './intent-pool.js'

const token='a'.repeat(64),origin='https://dcc.home.captnuu.online'
const input={key:'authenticated_task_request_01',prompt:'Synthetic task request'}
const read={from:'2026-11-01',to:'2026-11-02',limit:10}
function result(value:any){return value.structuredContent.result}
class TaskPool extends IntentPool {
  override async connect(){
    const client=await super.connect()
    return {query:async(sql:string,args:unknown[]=[])=>{
      // Only the post-run legacy sentinel read is exercised here. This is NOT
      // a session-vs-transaction advisory-lock concurrency/isolation proof.
      if(sql.startsWith('SELECT pg_advisory_lock(')||sql.startsWith('SELECT pg_advisory_unlock('))return {rows:[{}],rowCount:1}
      if(sql==="SELECT data FROM planner_entities WHERE id=$1 AND kind='hermes-command'"){
        const row=this.rows.get(String(args[0]))
        return {rows:row?.kind==='hermes-command'?[{data:structuredClone(row.data)}]:[],rowCount:row?1:0}
      }
      return client.query(sql,args)
    },release:client.release}
  }
}
async function fixture(exercise:(client:Client,callback:(body:unknown,extra?:Record<string,string>)=>Promise<any>)=>Promise<void>,now=()=>1000,path=TASK_ACTION_PATH){
  const db=new TaskPool(),sessions=new Set<string>()
  let app:ReturnType<typeof buildApp>,invocations=0,privateInput:unknown
  const bridge:TaskBridge=async(data)=>{
    invocations++;privateInput=data
    assert.equal(data.mode,path===ACTION_PATH?'product-action':'task-action');assert.equal(data.callbackCapability,token)
    const callback=(body:unknown,extra:Record<string,string>={})=>app.inject({method:'POST',url:TASK_CALLBACK_PATH,headers:{authorization:'Bearer '+data.callbackCapability,...extra},payload:body as any})
    const client=new Client({name:'fake-Hermes-MCP',version:'1.0.0'})
    const wire:Transport={start:async()=>{},close:async()=>{wire.onclose?.()},send:async message=>{
      const response=await callback(message)
      if(response.statusCode===200)wire.onmessage?.(response.json())
      else if(response.statusCode!==202)throw Error('Synthetic callback rejected')
    }}
    try{await client.connect(wire);await exercise(client,callback)}finally{await client.close()}
    return {status:'finished'}
  }
  const actions=new TaskActions({pool:db.pool,actorId:'dcc-account',bridge,now,issueCapability:()=>token})
  app=buildApp({plannerPool:db.pool,taskActions:actions,auth:{username:'synthetic',password:'synthetic-only',origin,store:{
    async put(id){sessions.add(id)},async has(id){return sessions.has(id)},async remove(id){sessions.delete(id)},
  }}})
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'synthetic',password:'synthetic-only'}})
  const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value
  const submit=(body:unknown=input)=>app.inject({method:'POST',url:path,headers:{origin},cookies:{daymark_session:cookie},payload:body as any})
  return {app,db,actions,submit,cookie,invocations:()=>invocations,privateInput:()=>privateInput}
}

test('authenticated endpoint -> fake bridge -> official SDK MCP -> real service task receipts; replay never restarts Hermes',async()=>{
  const h=await fixture(async(client,callback)=>{
    const {tools}=await client.listTools()
    assert.deepEqual(tools.map(t=>t.name).sort(),['create_task','list_tasks','set_task_completed'])
    const schema=tools.find(t=>t.name==='create_task')!.inputSchema
    assert.equal(Object.hasOwn(schema.properties??{},'id'),false)
    assert.equal(Object.hasOwn(schema.properties??{},'operationKey'),false)
    const list=result(await client.callTool({name:'list_tasks',arguments:read}))
    assert.equal(list.data.collectionVersion,0)
    const created=result(await client.callTool({name:'create_task',arguments:{title:'Synthetic item',date:'2026-11-01',expectedVersion:list.data.collectionVersion}}))
    assert.equal(created.state,'applied')
    const completed=result(await client.callTool({name:'set_task_completed',arguments:{id:created.id,expectedVersion:created.version,completed:true}}))
    assert.equal(completed.state,'applied')
    assert.equal(result(await client.callTool({name:'list_tasks',arguments:read})).data.items[0].completed,true)
    assert.equal((await callback({jsonrpc:'2.0',id:90,method:'tools/call',params:{name:'create_project',arguments:{}}})).statusCode,403)
    assert.equal((await callback({jsonrpc:'2.0',id:91,method:'ping'},{cookie:'daymark_session=not-an-authority'})).statusCode,403)
    assert.equal((await callback({jsonrpc:'2.0',id:92,method:'ping'},{origin})).statusCode,403)
    const injected=await callback({jsonrpc:'2.0',id:93,method:'tools/call',params:{name:'create_task',arguments:{title:'Must not save',date:'2026-11-01',expectedVersion:2,actorId:'caller-selected'}}})
    assert.equal(injected.statusCode,200)
    assert.ok(injected.json().error,'official SDK returns the rejected invalid call, without a service write')
    assert.equal((await callback({jsonrpc:'2.0',id:94,method:'ping',params:{oversized:'x'.repeat(65536)}})).statusCode,413)
  })
  try{
    const response=await h.submit()
    assert.equal(response.statusCode,200)
    assert.equal(response.json().summary.outcome,'effects_recorded')
    assert.equal(h.db.rows.get(COLLECTION)!.data.tasks[0].completed,true)
    assert.equal(h.invocations(),1)
    assert.deepEqual((await h.submit()).json(),response.json())
    assert.equal(h.invocations(),1)
    assert.equal((await h.submit({...input,prompt:'Changed prompt'})).statusCode,409)
    assert.equal((await h.app.inject({method:'POST',url:TASK_CALLBACK_PATH,headers:{authorization:'Bearer '+token},payload:{}})).statusCode,403,'revoked in finally')
    assert.equal(JSON.stringify(response.json()).includes(token),false)
    assert.equal(JSON.stringify([...h.db.rows.values()]).includes(token),false)
    const legacy=await h.app.inject({method:'POST',url:'/api/v1/hermes/commands',headers:{origin},cookies:{daymark_session:h.cookie},payload:input})
    assert.equal(legacy.statusCode,409,'existing Tell Hermes sees the MCP sentinel instead of parsing/writing')
  }finally{await h.app.close()}
})

test('unified action route preserves the same request-scoped SDK relay and exact catalog, with durable edit/readback/removal',async()=>{
  const h=await fixture(async(client,callback)=>{
    const first=await client.listTools()
    assert.deepEqual(first.tools.map(t=>t.name).sort(),Object.keys(TOOLS).sort())
    assert.deepEqual(await client.listTools(),first,'discovery schemas remain stable within an invocation')
    for(const tool of first.tools){
      assert.equal(tool.inputSchema.additionalProperties,false)
      if(TOOLS[tool.name as keyof typeof TOOLS].write)assert.equal(Object.hasOwn(tool.inputSchema.properties??{},'operationKey'),false)
    }
    const created=result(await client.callTool({name:'create_task',arguments:{title:'Synthetic edit target',date:'2026-11-01',expectedVersion:0}}))
    assert.equal(created.state,'applied')
    const edited=result(await client.callTool({name:'update_task',arguments:{id:created.id,expectedVersion:created.version,title:'Synthetic edited'}}))
    assert.equal(edited.state,'applied')
    const removed=result(await client.callTool({name:'remove_task',arguments:{id:created.id,expectedVersion:edited.version}}))
    assert.equal(removed.state,'applied')
    const readback=result(await client.callTool({name:'list_tasks',arguments:read}))
    assert.equal(readback.data.items[0].title,'Synthetic edited')
    assert.equal(readback.data.items[0].deleted,true)
    assert.equal((await callback({jsonrpc:'2.0',id:'forbidden',method:'tools/call',params:{name:'raw_http',arguments:{}}})).statusCode,403)
  },()=>1000,ACTION_PATH)
  try{
    const first=await h.submit()
    assert.equal(first.statusCode,200);assert.equal(first.json().summary.outcome,'effects_recorded')
    assert.deepEqual((await h.submit()).json(),first.json())
    assert.equal(h.invocations(),1)
    assert.equal(first.json().summary.reads[0].tool,'list_tasks')
  }finally{await h.app.close()}
})

test('unified SDK project create/archive/restore/status and exact-id readback use real service receipts',async()=>{
  const h=await fixture(async(client)=>{
    const created=result(await client.callTool({name:'create_project',arguments:{title:'Synthetic project',category:'personal',importance:2,remainingMinutes:0}}))
    assert.equal(created.state,'applied')
    const archived=result(await client.callTool({name:'archive_project',arguments:{id:created.id,expectedVersion:created.version}}))
    assert.equal(archived.state,'applied')
    const restored=result(await client.callTool({name:'restore_project',arguments:{id:created.id,expectedVersion:archived.version}}))
    assert.equal(restored.state,'applied')
    const completed=result(await client.callTool({name:'set_project_status',arguments:{id:created.id,expectedVersion:restored.version,status:'complete'}}))
    assert.equal(completed.state,'applied')
    const readback=result(await client.callTool({name:'list_projects',arguments:{id:created.id,limit:1}}))
    assert.equal(readback.data.items.length,1);assert.equal(readback.data.items[0].status,'complete')
  },()=>1000,ACTION_PATH)
  try{const response=await h.submit();assert.equal(response.json().summary.outcome,'effects_recorded');assert.equal(h.db.requested,true)}finally{await h.app.close()}
})

test('exact callback exception never accepts browser auth, service bearer, query variants or sibling routes',async()=>{
  const h=await fixture(async()=>{})
  try{
    assert.equal((await h.app.inject({method:'POST',url:TASK_ACTION_PATH,headers:{origin},payload:input})).statusCode,401)
    assert.equal((await h.app.inject({method:'POST',url:TASK_ACTION_PATH,headers:{origin:'https://wrong.invalid'},cookies:{daymark_session:h.cookie},payload:input})).statusCode,403)
    assert.equal((await h.submit({...input,actorId:'caller'})).statusCode,400)
    assert.equal((await h.submit({...input,prompt:'x'.repeat(20001)})).statusCode,413)
    for(const url of [TASK_CALLBACK_PATH,TASK_CALLBACK_PATH+'?x=1',TASK_CALLBACK_PATH+'/extra']){
      assert.equal((await h.app.inject({method:'POST',url,headers:{authorization:'Bearer service-bearer'},payload:{}})).statusCode,403)
    }
    assert.equal(h.invocations(),0)
    assert.equal(TASK_CALLBACK_URL,origin+TASK_CALLBACK_PATH)
  }finally{await h.app.close()}
})

test('typed RPC IDs bind one command; exact replay succeeds, changed payload and second initialization reject',async()=>{
  const h=await fixture(async(_client,callback)=>{
    const body={jsonrpc:'2.0',id:'fixed-call-id',method:'tools/call',params:{name:'create_task',arguments:{title:'Synthetic bound',date:'2026-11-01',expectedVersion:0},_meta:{hostCallId:'model-not-authority'}}}
    const first=await callback(body)
    assert.equal(first.statusCode,200)
    assert.equal(first.json().result.structuredContent.result.state,'applied')
    assert.deepEqual((await callback(body)).json(),first.json())
    const changed=structuredClone(body);changed.params.arguments.title='Changed'
    assert.equal((await callback(changed)).statusCode,409)
    assert.equal((await callback({jsonrpc:'2.0',id:100,method:'initialize',params:{}})).statusCode,409)
  })
  try{
    await h.submit()
    assert.equal(h.db.rows.get(COLLECTION)!.data.tasks.length,1)
    assert.equal(h.db.rows.get(COLLECTION)!.version,1)
  }finally{await h.app.close()}
})

test('expiry denies callbacks, interrupts intent, and repeated authenticated submission is receipts-only',async()=>{
  let clock=1000
  const h=await fixture(async(_client,callback)=>{
    clock+=120001
    assert.equal((await callback({jsonrpc:'2.0',id:99,method:'ping'})).statusCode,403)
  },()=>clock)
  try{
    const response=await h.submit()
    assert.equal(response.json().summary.phase,'uncertain')
    assert.equal(h.db.rows.has(COLLECTION),false)
    await h.submit();assert.equal(h.invocations(),1)
  }finally{await h.app.close()}
})

test('ordinary app construction exposes no task-action or callback capability exception',async()=>{
  const app=buildApp()
  try{
    assert.equal((await app.inject({method:'POST',url:TASK_CALLBACK_PATH,headers:{authorization:'Bearer '+token},payload:{}})).statusCode,503)
    assert.equal((await app.inject({method:'POST',url:TASK_ACTION_PATH,payload:input})).statusCode,503)
  }finally{await app.close()}
})

test('process restart loses capabilities and reconciles active intents without issuing another capability or runner',async()=>{
  const db=new TaskPool(),store=new SqlIntentStore(db.pool,'dcc-account')
  await store.admit({...input,purpose:'action'},{executor:'mcp-action-v1',allowedTools:['list_tasks','create_task','set_task_completed']})
  const owner=(await store.start(input.key,1000)).owner!
  await store.round(input.key,owner,1000)
  await store.reserve(input.key,owner,'frozen_before_restart','create_task',{title:'Synthetic pending',date:'2026-11-01',expectedVersion:0},1000)
  let issued=0,invoked=0
  const restarted=new TaskActions({pool:db.pool,actorId:'dcc-account',now:()=>1001,
    issueCapability:()=>{issued++;return token},bridge:async()=>{invoked++;throw Error('Must not restart model')}})
  assert.equal(await restarted.verifyCallback('Bearer '+token),false)
  const summary=await restarted.run(input)
  assert.equal(summary.phase,'uncertain');assert.equal(summary.pending,1)
  assert.equal(issued,0);assert.equal(invoked,0);assert.equal(db.rows.has(COLLECTION),false)
})

test('task-only route never adopts a legacy or broader MCP intent policy',async()=>{
  for(const prior of [{executor:'legacy-parser-v1' as const,allowedTools:[]},
    {executor:'mcp-action-v1' as const,allowedTools:['list_projects'] as const}]){
    const db=new TaskPool(),store=new SqlIntentStore(db.pool,'dcc-account')
    await store.admit({...input,purpose:'action'},prior)
    let invoked=false
    const actions=new TaskActions({pool:db.pool,actorId:'dcc-account',now:()=>1000,
      bridge:async()=>{invoked=true;return {status:'finished'}}})
    await assert.rejects(actions.run(input),/executor_conflict/)
    assert.equal(invoked,false)
  }
})

test('cancellation revokes a capability even if the private bridge ignores abort',async()=>{
  const db=new TaskPool(),abort=new AbortController()
  let entered!:()=>void,release!:()=>void
  const ready=new Promise<void>(resolve=>{entered=resolve}),hold=new Promise<void>(resolve=>{release=resolve})
  const actions=new TaskActions({pool:db.pool,actorId:'dcc-account',now:()=>1000,issueCapability:()=>token,
    bridge:async()=>{entered();await hold;return {status:'finished'}}})
  const pending=actions.run(input,abort.signal)
  await ready
  assert.equal(await actions.verifyCallback('Bearer '+token),true)
  abort.abort()
  const summary=await pending
  assert.equal(summary.phase,'uncertain')
  assert.equal(await actions.verifyCallback('Bearer '+token),false)
  release()
})

test('a completed older product catalog replays its receipt without widening policy or restarting a model',async()=>{
  const db=new TaskPool(),store=new SqlIntentStore(db.pool,'dcc-account')
  const original=['list_tasks','create_task','set_task_completed','list_projects'] as const
  await store.admit({...input,purpose:'action'},{executor:'mcp-action-v1',allowedTools:original})
  const owner=(await store.start(input.key,1000)).owner!
  await store.round(input.key,owner,1000);await store.finish(input.key,owner)
  let invoked=0
  const actions=new TaskActions({pool:db.pool,actorId:'dcc-account',now:()=>1001,bridge:async()=>{invoked++;return {status:'finished'}}})
  const result=await actions.runProduct(input)
  assert.equal(result.phase,'completed');assert.equal(result.outcome,'no_effects_recorded');assert.equal(invoked,0)
  assert.deepEqual((await store.read(input.key)).allowedTools,original)
})
