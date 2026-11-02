import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js'
import {createServiceMcpServer,type TrustedServiceInvocation} from '../../src/mcp/production-server.js'
import {ServiceTransport,COLLECTION,RECEIPT_KIND} from '../../src/mcp/service-transport.js'
import type {Context} from '../../src/mcp/dispatcher.js'
import {createNonRecurringCalendarWriter} from '../../src/calendar-write.js'
import {ServicePool} from './service-pool.js'
import {CalendarHarness,config,mutation} from './calendar-harness.js'

const task={operationKey:'sdk_service_create_task_01',id:'Legacy.Task_A',title:'Synthetic protocol item',date:'2026-11-01',expectedVersion:0}
const complete={operationKey:'sdk_service_complete_01',id:task.id,expectedVersion:1,completed:true}
const archive={operationKey:'sdk_service_archive_01',id:'12345678-1234-4234-a234-123456789abd',expectedVersion:7}
const event={operationKey:'sdk_service_calendar_01',id:mutation,calendarId:'Calendar_A',scope:'single',title:'Synthetic protocol event',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false}
const context:Context={purpose:'action',capabilities:['tasks:read','tasks:write','projects:read','projects:write','calendars:write','operations:read']}
function invocation():TrustedServiceInvocation {
  return {id:'synthetic_invocation_01',expiresAt:2000,allowedTools:['list_tasks','create_task','set_task_completed','archive_project','create_calendar_event','get_operation_status'],actions:[{tool:'create_task',arguments:task},{tool:'set_task_completed',arguments:complete},{tool:'archive_project',arguments:archive},{tool:'create_calendar_event',arguments:event}]}
}
function envelope(result:CallToolResult){
  const text=result.content[0]
  assert.equal(text?.type,'text')
  if(text?.type!=='text')throw Error('Expected text result')
  const body=JSON.parse(text.text)
  assert.equal(body.source,'dcc-service')
  assert.deepEqual(result.structuredContent,body)
  assert.equal(result.isError,!['ok','applied','saved'].includes(body.result.state))
  return body.result
}
async function protocol(server:ReturnType<typeof createServiceMcpServer>,exercise:(client:Client)=>Promise<void>){
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair()
  const client=new Client({name:'synthetic-service-test',version:'0.1.0'})
  const errors:Error[]=[]
  server.onerror=error=>{errors.push(error)};client.onerror=error=>{errors.push(error)}
  try{await server.connect(serverTransport);await client.connect(clientTransport);await exercise(client)}
  finally{await client.close();await server.close()}
  assert.deepEqual(errors,[])
}

test('official SDK protocol reaches real service contracts and fake storage, including collection create/completion and archive',async()=>{
  const db=new ServicePool()
  db.seed({id:archive.id,kind:'project',version:7,data:{id:archive.id,kind:'project',title:'Synthetic parent',description:'',deadline:'',progress:'',category:'personal',importance:2,remainingMinutes:20,status:'active',extension:'preserve'}})
  const server=createServiceMcpServer({transport:new ServiceTransport({pool:db.pool,actorId:'actor-A'}),context,invocation:invocation(),now:()=>1000})
  await protocol(server,async client=>{
    const {tools}=await client.listTools()
    const createSchema=tools.find(tool=>tool.name==='create_task')!.inputSchema
    assert.ok(createSchema.required?.includes('expectedVersion'))
    assert.deepEqual((createSchema.properties?.operationKey as {enum:string[]}).enum,[task.operationKey])
    assert.equal(Object.hasOwn(createSchema.properties??{},'projectId'),false)
    assert.match(tools.find(tool=>tool.name==='archive_project')?.description??'',/queues planning/i)
    const read=envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:1}}))
    assert.deepEqual(read,{state:'ok',data:{items:[],nextOffset:null,collectionVersion:0}})
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:task})),{state:'applied',id:task.id,version:1})
    assert.deepEqual(envelope(await client.callTool({name:'set_task_completed',arguments:complete})),{state:'applied',id:task.id,version:2})
    assert.equal(db.rows.get(COLLECTION)?.data.tasks[0].completed,true)
    assert.equal(db.rows.get(archive.id)?.data.status,'active','task completion does not complete a parent')
    assert.deepEqual(envelope(await client.callTool({name:'archive_project',arguments:archive})),{state:'applied',id:archive.id,version:8})
    assert.equal(db.rows.get(archive.id)?.data.status,'archived')
    assert.equal(db.rows.get(archive.id)?.data.extension,'preserve')
    assert.equal(db.requested,true)
  })
  assert.equal(db.connections,0)
})

test('SDK calendar reports saved/pending and actor-bound status without inventing snapshot ID or reading provider again',async()=>{
  const h=new CalendarHarness()
  let savedReceipt:unknown
  const transport=new ServiceTransport({pool:h.pool,actorId:'actor-A',calendarSnapshot:async()=>h.snapshot,guardedCalendarWriter:createNonRecurringCalendarWriter(h.pool,config,h.fetch)})
  await protocol(createServiceMcpServer({transport,context,invocation:invocation(),now:()=>1000}),async client=>{
    await client.listTools()
    const saved=envelope(await client.callTool({name:'create_calendar_event',arguments:event}))
    savedReceipt=saved
    assert.equal(saved.state,'saved')
    assert.equal(saved.confirmation,'snapshot_pending')
    assert.equal(Object.hasOwn(saved,'eventId'),false)
    assert.equal(h.puts,1)
    const requests=h.fetches.length
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:event.operationKey}})),{state:'ok',data:{operationKey:event.operationKey,status:'saved',result:saved}})
    assert.equal(h.fetches.length,requests)
    assert.deepEqual(envelope(await client.callTool({name:'create_calendar_event',arguments:Object.fromEntries(Object.entries(event).reverse())})),saved)
    assert.equal(h.puts,1)
  })
  const requests=h.fetches.length
  await protocol(createServiceMcpServer({transport:new ServiceTransport({pool:h.pool,actorId:'actor-A'}),context:{purpose:'read',capabilities:['operations:read']},invocation:{id:'synthetic_status_invocation',expiresAt:2000,allowedTools:['get_operation_status'],statusKeys:[event.operationKey]},now:()=>1000}),async client=>{
    assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),['get_operation_status'])
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:event.operationKey}})),{state:'ok',data:{operationKey:event.operationKey,status:'saved',result:savedReceipt}})
  })
  assert.equal(h.fetches.length,requests,'fresh read-only invocation resolves a completed receipt with no provider reads')
})

test('production invocation denies changed keys, targets, payloads, tools and status keys before transport',async()=>{
  const db=new ServicePool()
  await protocol(createServiceMcpServer({transport:new ServiceTransport({pool:db.pool,actorId:'actor-A'}),context,invocation:invocation(),now:()=>1000}),async client=>{
    await client.listTools()
    for(const args of [{...task,operationKey:'sdk_unapproved_key_0001'},{...task,title:'Changed intent'},{...task,id:'Different_Task'}])assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:args})),{state:'rejected',code:'forbidden'})
    assert.deepEqual(envelope(await client.callTool({name:'remove_task',arguments:{operationKey:'sdk_remove_unapproved',id:task.id,expectedVersion:1}})),{state:'rejected',code:'forbidden'})
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:'sdk_unapproved_key_0001'}})),{state:'rejected',code:'forbidden'})
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:{...task,nonRecurringOnly:true}})),{state:'rejected',code:'invalid_arguments'})
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:{...task,...JSON.parse('{"__proto__":{}}')}})),{state:'rejected',code:'invalid_arguments'})
  })
  assert.equal(db.statements.length,0)
})

test('DCC account data is shared across trusted actors; only durable operation receipts are actor-scoped',async()=>{
  const db=new ServicePool()
  await protocol(createServiceMcpServer({transport:new ServiceTransport({pool:db.pool,actorId:'actor-A'}),context,invocation:invocation(),now:()=>1000}),async client=>{
    assert.equal(envelope(await client.callTool({name:'create_task',arguments:task})).state,'applied')
  })
  const readInvocation:TrustedServiceInvocation={id:'synthetic_shared_read_01',expiresAt:2000,allowedTools:['list_tasks','get_operation_status'],statusKeys:[task.operationKey]}
  await protocol(createServiceMcpServer({transport:new ServiceTransport({pool:db.pool,actorId:'actor-B'}),context:{purpose:'read',capabilities:['tasks:read','operations:read']},invocation:readInvocation,now:()=>1000}),async client=>{
    const read=envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:1}}))
    assert.equal(read.data.items[0]?.id,task.id,'actor is not a task/project/calendar tenancy filter')
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:task.operationKey}})),{state:'ok',data:{operationKey:task.operationKey,status:'unknown'}})
  })
})

for(const purpose of ['parser','planner','extraction'] as const)test(`production SDK ${purpose} context remains read-only despite write capabilities and action grants`,async()=>{
  const db=new ServicePool(),mutableContext:Context={...context,purpose,capabilities:[...context.capabilities]}
  const server=createServiceMcpServer({transport:new ServiceTransport({pool:db.pool,actorId:'actor-A'}),context:mutableContext,invocation:invocation(),now:()=>1000})
  mutableContext.purpose='action' // Cannot escalate the factory's context snapshot.
  await protocol(server,async client=>{
    const {tools}=await client.listTools()
    assert.ok(tools.every(tool=>tool.annotations?.readOnlyHint===true))
    assert.equal(envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:1}})).state,'ok')
    const statements=db.statements.length
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:task,_meta:{purpose:'action',capabilities:['tasks:write']}})),{state:'rejected',code:'forbidden'})
    assert.equal(db.statements.length,statements)
  })
  assert.equal([...db.rows.values()].filter(row=>row.kind===RECEIPT_KIND).length,0)
})

test('invocation expires, exact actions cannot be widened by mutation, and missing grants never imply action authority',async()=>{
  const db=new ServicePool(),transport=new ServiceTransport({pool:db.pool,actorId:'actor-A'})
  let now=1000
  const policy=invocation()
  const server=createServiceMcpServer({transport,context,invocation:policy,now:()=>now})
  policy.actions![0]!.arguments={...task,title:'Changed outside policy'}
  policy.allowedTools.push('remove_task')
  await protocol(server,async client=>{
    await client.listTools()
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:{...task,title:'Changed outside policy'}})),{state:'rejected',code:'forbidden'})
    now=2000
    assert.deepEqual((await client.listTools()).tools,[])
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:task})),{state:'rejected',code:'forbidden'})
  })
  const noActions={...invocation(),actions:[]}
  await protocol(createServiceMcpServer({transport,context,invocation:noActions,now:()=>1000}),async client=>{
    assert.ok((await client.listTools()).tools.every(tool=>tool.annotations?.readOnlyHint===true))
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:task})),{state:'rejected',code:'forbidden'})
  })
  assert.equal(db.statements.length,0)
  assert.throws(()=>createServiceMcpServer({transport,context,invocation:{...invocation(),expiresAt:1000},now:()=>1000}))
  assert.throws(()=>createServiceMcpServer({transport,context,invocation:{...invocation(),expiresAt:1000+3600000},now:()=>1000}))
  const duplicated=invocation()
  duplicated.actions!.push({tool:'set_task_completed',arguments:{...complete,operationKey:task.operationKey}})
  assert.throws(()=>createServiceMcpServer({transport,context,invocation:duplicated,now:()=>1000}))
})
