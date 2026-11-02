import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Dispatcher,type Context} from '../../src/mcp/dispatcher.js'
import {ServiceTransport,COLLECTION,RECEIPT_KIND} from '../../src/mcp/service-transport.js'
import {serviceToolDefinitions} from '../../src/mcp/service-contracts.js'
import {ServicePool} from './service-pool.js'
import type {Snapshot} from '../../src/sync.js'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv'

const context:Context={purpose:'action',capabilities:['tasks:read','tasks:write','projects:read','projects:write','calendars:read','calendars:write','operations:read']}
const task={operationKey:'service_task_key_0001',id:'Legacy.Task-01_AbC',title:'Synthetic stored task',date:'2026-11-01',expectedVersion:0}
const project={operationKey:'service_project_key_01',id:'12345678-1234-4234-a234-123456789abc',title:'Synthetic stored project',category:'personal',importance:2,remainingMinutes:30}
const make=(db:ServicePool,actorId='actor-A')=>new Dispatcher(new ServiceTransport({pool:db.pool,actorId}))
const receipts=(db:ServicePool)=>[...db.rows.values()].filter(row=>row.kind===RECEIPT_KIND)
const tasks=(db:ServicePool)=>db.rows.get(COLLECTION)!

test('service discovery is distinct: real required project fields and collection create precondition',()=>{
  const tools=serviceToolDefinitions(),provider=new AjvJsonSchemaValidator()
  const taskSchema=tools.find(tool=>tool.name==='create_task')!.inputSchema
  assert.equal(taskSchema.additionalProperties,false)
  assert.equal(Object.hasOwn(taskSchema.properties??{},'projectId'),false)
  const validateTask=provider.getValidator(taskSchema)
  assert.equal(validateTask(task).valid,true)
  const {expectedVersion:_version,...unversioned}=task
  assert.equal(validateTask(unversioned).valid,false)
  const validateProject=provider.getValidator(tools.find(tool=>tool.name==='create_project')!.inputSchema)
  assert.equal(validateProject(project).valid,true)
  assert.equal(validateProject({operationKey:project.operationKey,id:project.id,title:project.title}).valid,false)
})

test('service requires trusted actor, defaults dispatcher policy deny and rejects unsupported linkage/IDs',async()=>{
  const db=new ServicePool(),dispatcher=make(db)
  assert.throws(()=>new ServiceTransport({pool:db.pool,actorId:''}))
  assert.deepEqual(await new ServiceTransport({pool:db.pool,actorId:'actor-A'}).execute({tool:'create_task',args:task}),{state:'rejected',code:'forbidden'})
  assert.deepEqual(await dispatcher.dispatch('create_task',task),{state:'rejected',code:'forbidden'})
  assert.deepEqual(await dispatcher.dispatch('create_task',{...task,projectId:project.id},context),{state:'rejected',code:'unsupported_linkage'})
  assert.equal((await dispatcher.dispatch('create_task',{...task,id:'Legacy%2F'},context)).state,'rejected')
  assert.equal((await dispatcher.dispatch('create_project',{...project,id:project.id.toUpperCase()},context)).state,'rejected')
  for(const suffix of ['\n','\u2028','\u2029']){
    assert.equal((await dispatcher.dispatch('create_project',{...project,id:project.id+suffix},context)).state,'rejected')
    assert.throws(()=>new ServiceTransport({pool:db.pool,actorId:'actor-A'+suffix}))
  }
  assert.equal((await dispatcher.dispatch('create_project',{id:project.id,title:project.title,operationKey:project.operationKey},context)).state,'rejected')
  assert.equal(db.statements.length,0)
  for(const purpose of ['parser','planner','extraction'] as const)assert.deepEqual(await dispatcher.dispatch('create_task',task,{...context,purpose}),{state:'rejected',code:'forbidden'})
  assert.equal(db.statements.length,0)
})

test('task collection mutation and durable receipt commit together; recreation replays without mutation',async()=>{
  const db=new ServicePool()
  assert.deepEqual(await make(db).dispatch('create_task',task,context),{state:'applied',id:task.id,version:1})
  assert.equal(tasks(db).version,1)
  assert.equal(receipts(db).length,1)
  const mutations=db.statements.filter(q=>q.sql.startsWith('INSERT INTO')).length
  assert.deepEqual(await make(db).dispatch('create_task',Object.fromEntries(Object.entries(task).reverse()),context),{state:'applied',id:task.id,version:1})
  assert.equal(db.statements.filter(q=>q.sql.startsWith('INSERT INTO')).length,mutations)
  assert.deepEqual(await make(db).dispatch('create_task',{...task,title:'Changed payload'},context),{state:'conflict',code:'operation_key_mismatch'})
  assert.deepEqual(await make(db).dispatch('create_project',{...project,operationKey:task.operationKey},context),{state:'conflict',code:'operation_key_mismatch'})
  assert.deepEqual(await make(db).dispatch('get_operation_status',{operationKey:task.operationKey},context),{state:'ok',data:{operationKey:task.operationKey,status:'applied'}})
  assert.deepEqual(await make(db,'actor-B').dispatch('get_operation_status',{operationKey:task.operationKey},context),{state:'ok',data:{operationKey:task.operationKey,status:'unknown'}})
  assert.equal((await make(db,'actor-B').dispatch('create_task',{...task,id:'Other_Task',expectedVersion:1},context)).state,'applied')
  assert.equal(receipts(db).length,2)
  assert.equal(db.connections,0)
  assert.ok(db.statements.some(q=>q.sql==='SELECT pg_advisory_xact_lock(817342)'))
  assert.ok(db.statements.some(q=>q.sql.includes('hashtextextended($1,817344)')))
  assert.ok(db.statements.every(q=>!q.sql.startsWith('DELETE')))
})

test('no-op uses current collection revision, task patch keeps metadata and stale create never appends',async()=>{
  const db=new ServicePool(),dispatcher=make(db)
  await dispatcher.dispatch('create_task',task,context)
  tasks(db).data.tasks[0].future={preserve:true}
  assert.deepEqual(await dispatcher.dispatch('update_task',{operationKey:'service_task_patch_001',id:task.id,expectedVersion:1,notes:'Synthetic patch'},context),{state:'applied',id:task.id,version:2})
  assert.deepEqual(tasks(db).data.tasks[0].future,{preserve:true})
  assert.deepEqual(await dispatcher.dispatch('set_task_completed',{operationKey:'service_noop_key_0001',id:task.id,expectedVersion:2,completed:false},context),{state:'applied',id:task.id,version:2})
  assert.deepEqual(await dispatcher.dispatch('create_task',{...task,operationKey:'service_stale_create_01',id:'New_Task',expectedVersion:1},context),{state:'conflict',code:'revision_mismatch'})
  assert.equal(tasks(db).data.tasks.length,1)
})

test('empty task pages still expose authoritative collection version, never invent per-task revisions',async()=>{
  const db=new ServicePool()
  const args={from:'2026-11-01',to:'2026-11-02',limit:1}
  assert.deepEqual(await make(db).dispatch('list_tasks',args,context),{state:'ok',data:{items:[],nextOffset:null,collectionVersion:0}})
  db.seed({id:COLLECTION,kind:'manual-tasks',version:7,data:{tasks:[],extension:'keep'}})
  assert.deepEqual(await make(db).dispatch('list_tasks',args,context),{state:'ok',data:{items:[],nextOffset:null,collectionVersion:7}})
  assert.deepEqual(await make(db).dispatch('create_task',{...task,expectedVersion:7},context),{state:'applied',id:task.id,version:8})
  assert.equal(tasks(db).data.extension,'keep')
})

test('collection versions, unknown collection/task metadata, recurrence and tombstones are preserved',async()=>{
  const db=new ServicePool(),recurrence={version:1,kind:'template',frequency:'weekly',weekday:1,startDate:'2026-11-01',paused:false}
  const prior={id:task.id,title:task.title,date:task.date,notes:'',completed:false,custom:{keep:true}}
  const recurring={...prior,id:'Recurring_Task',recurrence,deleted:true}
  db.seed({id:COLLECTION,kind:'manual-tasks',version:7,data:{tasks:[prior,recurring],extension:{future:true}}})
  db.seed({id:project.id,kind:'project',version:2,data:{id:project.id,status:'active'}})
  const complete={operationKey:'service_complete_key_01',id:task.id,expectedVersion:7,completed:true}
  assert.deepEqual(await make(db).dispatch('set_task_completed',complete,context),{state:'applied',id:task.id,version:8})
  assert.deepEqual(tasks(db).data.extension,{future:true})
  assert.deepEqual(tasks(db).data.tasks[0].custom,{keep:true})
  assert.deepEqual(tasks(db).data.tasks[1],recurring)
  assert.equal(db.rows.get(project.id)?.data.status,'active')
  assert.equal(db.requested,false,'standalone tasks never queue planning')
  assert.deepEqual(await make(db).dispatch('update_task',{operationKey:'service_stale_key_001',id:task.id,expectedVersion:7,title:'Stale'},context),{state:'conflict',code:'revision_mismatch'})
  assert.deepEqual(await make(db).dispatch('remove_task',{operationKey:'service_recurring_01',id:recurring.id,expectedVersion:8},context),{state:'rejected',code:'unsupported_recurrence'})
  assert.deepEqual(await make(db).dispatch('remove_task',{operationKey:'service_remove_key_01',id:task.id,expectedVersion:8},context),{state:'applied',id:task.id,version:9})
  assert.equal(tasks(db).data.tasks[0].deleted,true)
  const read=await make(db).dispatch('list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:10},context)
  assert.equal(read.state,'ok')
  if(read.state==='ok'){
    const data=read.data as {items:Record<string,unknown>[]}
    assert.ok(data.items.every(item=>item.version===9))
    assert.ok(data.items.some(item=>item.id===task.id&&item.deleted===true))
    assert.ok(data.items.some(item=>item.id===recurring.id&&item.recurring===true))
    assert.ok(data.items.every(item=>!Object.hasOwn(item,'custom')&&!Object.hasOwn(item,'recurrence')))
  }
})

test('injected SQL failures/zero affected rows rollback data and receipt as one unit',async()=>{
  for(const point of ['receipt-update','entity-update','planning'] as const){
    for(const zero of [false,true]){
      const db=new ServicePool()
      await make(db).dispatch('create_project',project,context)
      const before=structuredClone(db.rows)
      if(zero)db.zero=point;else db.fail=point
      const result=await make(db).dispatch('update_project',{operationKey:'service_failure_key_01',id:project.id,expectedVersion:1,title:'Attempted edit'},context)
      assert.deepEqual(result,{state:'uncertain',operationKey:'service_failure_key_01'})
      assert.deepEqual(db.rows,before)
      assert.ok(db.statements.some(q=>q.sql==='ROLLBACK'))
      assert.equal(db.connections,0)
    }
  }
  const db=new ServicePool();db.zero='insert'
  assert.deepEqual(await make(db).dispatch('create_task',task,context),{state:'uncertain',operationKey:task.operationKey})
  assert.equal(db.rows.size,0)
})

test('lost commit acknowledgement replays durable completion; rollback-before-commit can safely retry locally',async()=>{
  for(const fail of ['commit-before','commit-after'] as const){
    const db=new ServicePool();db.fail=fail
    const sameDispatcher=make(db)
    assert.deepEqual(await sameDispatcher.dispatch('create_task',task,context),{state:'uncertain',operationKey:task.operationKey})
    assert.deepEqual(await sameDispatcher.dispatch('create_task',task,context),{state:'applied',id:task.id,version:1})
    assert.deepEqual(await make(db).dispatch('create_task',task,context),{state:'applied',id:task.id,version:1})
    assert.equal(tasks(db).data.tasks.length,1)
    assert.equal(receipts(db).length,1)
  }
})

test('real project fields/status/versions are preserved, archive persists enum, restore is explicitly active',async()=>{
  const db=new ServicePool()
  assert.deepEqual(await make(db).dispatch('create_assignment',{...project,deadline:'2026-12-01'},context),{state:'applied',id:project.id,version:1})
  assert.equal(db.requested,true)
  const row=db.rows.get(project.id)!
  row.data.resources=[{name:'Synthetic resource',text:'Keep'}];row.data.planSummary='Keep plan metadata'
  assert.deepEqual(await make(db).dispatch('set_project_status',{operationKey:'service_status_key_01',id:project.id,expectedVersion:1,status:'complete'},context),{state:'applied',id:project.id,version:2})
  assert.equal((await make(db).dispatch('archive_project',{operationKey:'service_archive_key_01',id:project.id,expectedVersion:2},context)).state,'applied')
  assert.equal(db.rows.get(project.id)?.data.status,'archived')
  assert.equal(Object.hasOwn(db.rows.get(project.id)!.data,'archived'),false)
  assert.equal((await make(db).dispatch('restore_project',{operationKey:'service_restore_key_01',id:project.id,expectedVersion:3},context)).state,'applied')
  assert.equal(db.rows.get(project.id)?.data.status,'active')
  assert.deepEqual(db.rows.get(project.id)?.data.resources,[{name:'Synthetic resource',text:'Keep'}])
  assert.equal(db.rows.get(project.id)?.data.planSummary,'Keep plan metadata')
  assert.deepEqual(await make(db).dispatch('update_project',{operationKey:'service_project_stale_01',id:project.id,expectedVersion:3,description:'Stale'},context),{state:'conflict',code:'revision_mismatch'})
  assert.deepEqual(await make(db).dispatch('update_project',{operationKey:'service_assignment_clear',id:project.id,expectedVersion:4,deadline:''},context),{state:'rejected',code:'invalid_arguments'})
  const read=await make(db).dispatch('list_projects',{limit:1},context)
  assert.equal(read.state,'ok')
  if(read.state==='ok')assert.equal(JSON.stringify(read.data).includes('resources'),false)
  for(const tool of serviceToolDefinitions().filter(t=>TOOLS_PROJECT_WRITES.includes(t.name)))assert.match(tool.description??'',/queues planning/i)
})

test('project pages use SQL limits and explicit planning patches, preserving existing unrelated metadata',async()=>{
  const db=new ServicePool(),dispatcher=make(db)
  assert.deepEqual(await dispatcher.dispatch('create_project',{...project,deadline:'2026-12-01'},context),{state:'applied',id:project.id,version:1})
  db.rows.get(project.id)!.data.extension={keep:true}
  assert.deepEqual(await dispatcher.dispatch('update_project',{operationKey:'service_project_patch_01',id:project.id,expectedVersion:1,remainingMinutes:25,deadline:''},context),{state:'applied',id:project.id,version:2})
  assert.equal(db.rows.get(project.id)?.data.remainingMinutes,25)
  assert.equal(db.rows.get(project.id)?.data.deadline,'')
  assert.deepEqual(db.rows.get(project.id)?.data.extension,{keep:true})
  const secondId='12345678-1234-4234-a234-123456789abd'
  db.seed({id:secondId,kind:'project',version:1,data:{...db.rows.get(project.id)!.data,id:secondId}})
  const read=await dispatcher.dispatch('list_projects',{limit:1},context)
  assert.equal(read.state,'ok')
  if(read.state==='ok'){
    const data=read.data as {items:{id:string;status:string}[];nextOffset:number}
    assert.deepEqual(data.items.map(item=>item.id),[project.id])
    assert.equal(data.nextOffset,1)
    assert.equal(JSON.stringify(data).includes('extension'),false)
  }
  assert.ok(db.statements.some(q=>q.sql.includes("WHERE kind='project' ORDER BY id LIMIT $1 OFFSET $2")&&q.args[0]===2&&q.args[1]===0))
})
const TOOLS_PROJECT_WRITES=['create_project','create_assignment','update_project','set_project_status','archive_project','restore_project']

const snapshot:Snapshot={calendars:[{id:'Calendar_A',name:'Synthetic cache',url:'https://private.invalid/calendar'}],coverageStart:'2026-11-01T00:00:00Z',coverageEnd:'2026-12-01T00:00:00Z',events:[{id:'Event_A',calendarId:'Calendar_A',resource:'https://private.invalid/event',uid:'private-uid',etag:'"current"',recurrenceId:null,title:'Synthetic event',description:'',location:'',start:'2026-11-01T10:00:00.000Z',end:'2026-11-01T11:00:00.000Z',allDay:false}]}
test('calendar reads project safe cache data, ETags are exact and missing authoritative recurrence rejects edits',async()=>{
  const db=new ServicePool();let calls=0
  const dispatcher=()=>new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'actor-A',calendarSnapshot:async()=>snapshot,calendarWriter:async()=>{calls++;return {code:200,saved:true}}}))
  const read=await dispatcher().dispatch('list_calendar_events',{calendarId:'Calendar_A',from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',limit:10},context)
  assert.equal(read.state,'ok')
  assert.equal(JSON.stringify(read).includes('private'),false)
  const cancel={operationKey:'service_calendar_key_01',calendarId:'Calendar_A',eventId:'Event_A',scope:'single',expectedEtag:'"stale"'}
  assert.deepEqual(await dispatcher().dispatch('cancel_calendar_event',cancel,context),{state:'conflict',code:'revision_mismatch'})
  assert.deepEqual(await dispatcher().dispatch('cancel_calendar_event',{...cancel,operationKey:'service_calendar_key_02',expectedEtag:'"current"'},context),{state:'rejected',code:'recurrence_unverified'})
  assert.deepEqual(await dispatcher().dispatch('update_calendar_event',{...cancel,operationKey:'service_calendar_key_03',expectedEtag:'"current"',title:'Synthetic edit',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false},context),{state:'rejected',code:'recurrence_unverified'})
  assert.equal(calls,0)
  assert.deepEqual(await dispatcher().dispatch('list_calendar_events',{calendarId:'Calendar_A',from:'2026-12-01T00:00:00Z',to:'2026-12-02T00:00:00Z',limit:10},context),{state:'rejected',code:'cache_unavailable'})
})

test('known recurrence, missing dependencies and private read errors fail closed',async()=>{
  const db=new ServicePool()
  const recurring=structuredClone(snapshot);recurring.events[0]!.recurrenceId='2026-11-01T10:00:00Z'
  let calls=0
  const dispatcher=new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'actor-A',calendarSnapshot:async()=>recurring,calendarWriter:async()=>{calls++;return {code:200,saved:true}}}))
  assert.deepEqual(await dispatcher.dispatch('cancel_calendar_event',{operationKey:'service_known_recurring',calendarId:'Calendar_A',eventId:'Event_A',scope:'single',expectedEtag:'"current"'},context),{state:'rejected',code:'unsupported_recurrence'})
  assert.equal(calls,0)
  assert.deepEqual(await make(db).dispatch('list_calendars',{limit:1},context),{state:'rejected',code:'transport_unconfigured'})
  const broken=new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'actor-A',calendarSnapshot:async()=>{throw Error('private profile and credential details')}}))
  assert.deepEqual(await broken.dispatch('list_calendars',{limit:1},context),{state:'rejected',code:'transport_failure'})
})

test('calendar create reserves immutable mutation before writer, releases connection, and never retries uncertainty',async()=>{
  const db=new ServicePool();let calls=0,mutationId='',observedJson='',observedConnections=-1,observedState:unknown
  const options={pool:db.pool,actorId:'actor-A',calendarSnapshot:async()=>snapshot,calendarWriter:async(change:{id:string})=>{
    calls++;mutationId=change.id
    observedJson=JSON.stringify(change)
    observedConnections=db.connections;observedState=receipts(db)[0]?.data.state
    throw Error('private provider details')
  }}
  const create={operationKey:'service_calendar_create_01',id:project.id,calendarId:'Calendar_A',scope:'single',title:'Synthetic event',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',allDay:false}
  assert.deepEqual(await new Dispatcher(new ServiceTransport(options)).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.equal(mutationId,create.id)
  assert.equal(observedConnections,0)
  assert.equal(observedState,'uncertain')
  assert.deepEqual(await new Dispatcher(new ServiceTransport(options)).dispatch('create_calendar_event',create,context),{state:'uncertain',operationKey:create.operationKey})
  assert.deepEqual(await new Dispatcher(new ServiceTransport(options)).dispatch('create_calendar_event',{...create,title:'Changed'},context),{state:'conflict',code:'operation_key_mismatch'})
  assert.equal(calls,1)
  assert.equal(receipts(db)[0]?.data.change.id,mutationId)
  assert.equal(receipts(db)[0]?.data.writerPayloadJson,observedJson)
  assert.match(receipts(db)[0]?.data.writerPayloadHash,/^[a-f0-9]{64}$/)
})

test('successful writer reply without projected ID/ETag remains uncertain, reservation commit failure never dispatches',async()=>{
  for(const fail of [undefined,'commit-before','commit-after'] as const){
    const db=new ServicePool();db.fail=fail;let calls=0
    const options={pool:db.pool,actorId:'actor-A',calendarSnapshot:async()=>snapshot,calendarWriter:async()=>{calls++;return {code:200,saved:true}}}
    const command={operationKey:'service_calendar_success_01',id:project.id,calendarId:'Calendar_A',scope:'single',title:'Synthetic event',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',allDay:false}
    assert.deepEqual(await new Dispatcher(new ServiceTransport(options)).dispatch('create_calendar_event',command,context),{state:'uncertain',operationKey:command.operationKey})
    assert.equal(calls,fail?0:1)
  }
})
