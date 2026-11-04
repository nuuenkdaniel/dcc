import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Dispatcher, type Context} from '../../src/mcp/dispatcher.js'
import {TOOLS, validateArguments} from '../../src/mcp/contracts.js'
import {FakeTransport} from '../../src/mcp/fake-transport.js'

const action:Context={purpose:'action',capabilities:['tasks:read','tasks:write','projects:read','projects:write','calendars:read','calendars:write','operations:read']}
const task={operationKey:'operation_task_0001',id:'Legacy.Task-01_AbC%2F',title:'Synthetic checklist item',date:'2026-11-01'}
const project={operationKey:'operation_project_01',id:'Project_A',title:'Synthetic project'}
const event={operationKey:'operation_event_0001',id:'Event_A',calendarId:'Calendar_A',scope:'single',title:'Synthetic meeting',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false}
const read={from:'2026-11-01',to:'2026-11-30',limit:10}

test('writes default deny, and parser/planner/extraction cannot dispatch even with write capabilities',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  for(const context of [undefined,{purpose:'parser',capabilities:action.capabilities},{purpose:'planner',capabilities:action.capabilities},{purpose:'extraction',capabilities:action.capabilities},{purpose:'action',capabilities:[]}] as (Context|undefined)[]){
    assert.deepEqual(await dispatcher.dispatch('create_task',task,context),{state:'rejected',code:'forbidden'})
  }
  assert.equal(fake.calls.length,0)
  assert.deepEqual(await dispatcher.dispatch('create_task',task,{purpose:'action',capabilities:['projects:write']}),{state:'rejected',code:'forbidden'})
  assert.equal(fake.calls.length,0)
})

test('all tools enforce their capability and writes require action context',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  for(const [name,definition] of Object.entries(TOOLS)){
    assert.deepEqual(await dispatcher.dispatch(name,{}, {purpose:'action',capabilities:[]}),{state:'rejected',code:'forbidden'},name)
    if(definition.write)assert.deepEqual(await dispatcher.dispatch(name,{}, {purpose:'parser',capabilities:action.capabilities}),{state:'rejected',code:'forbidden'},name)
  }
  assert.equal(fake.calls.length,0)
  assert.equal((await dispatcher.dispatch('list_tasks',read,{purpose:'parser',capabilities:['tasks:read']})).state,'ok')
})

test('unknown tools, arbitrary routing keys and non-JSON arguments are rejected before transport',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  for(const name of ['fetch','sql','shell','toString','__proto__','https://example.invalid'])assert.deepEqual(await dispatcher.dispatch(name,{},action),{state:'rejected',code:'unknown_tool'})
  for(const args of [null,[],{...task,url:'https://example.invalid'},{...task,method:'POST'},{...task,profile:'production'},JSON.parse('{"__proto__":{},"limit":1}'),{...task,expectedVersion:1}]){
    assert.equal((await dispatcher.dispatch('create_task',args,action)).state,'rejected')
  }
  const accessor=Object.defineProperty({...task},'title',{enumerable:true,get(){throw Error('must not invoke getters')}})
  assert.equal((await dispatcher.dispatch('create_task',accessor,action)).state,'rejected')
  assert.equal(fake.calls.length,0)
})

test('bounds and calendar validity are strict, without coercion or silent normalization',()=>{
  const badTasks=[{...task,date:'2026-02-30'},{...task,date:'1999-12-31'},{...task,date:'2101-01-01'},{...task,title:' '},{...task,title:'x'.repeat(241)},{...task,id:' spaced '},{...task,operationKey:'short'},{...task,important:'true'}]
  for(const args of badTasks)assert.equal(validateArguments('create_task',args).valid,false)
  for(const args of [{...read,limit:0},{...read,limit:101},{...read,limit:'10'},{...read,offset:10001},{...read,to:'2027-11-01'},{...read,to:'2026-10-31'}])assert.equal(validateArguments('list_tasks',args).valid,false)
  for(const args of [{...event,end:event.start},{...event,start:'2026-02-30T10:00:00Z'},{...event,start:'2026-11-01T10:00:00+01:00'},{...event,allDay:true},{...event,end:'2026-12-03T11:00:00Z'}])assert.equal(validateArguments('create_calendar_event',args).valid,false)
  assert.equal(validateArguments('create_task',{...task,date:'2028-02-29'}).valid,true)
  assert.equal(validateArguments('create_calendar_event',{...event,allDay:true,start:'2026-11-01',end:'2026-11-02'}).valid,true)
  assert.equal(validateArguments('list_calendar_events',{calendarId:'Calendar_A',from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',limit:10}).valid,true)
})

test('explicit revisions and nonempty patches are required on every edit',()=>{
  const edits:Record<string,Record<string,unknown>>={
    update_task:{operationKey:task.operationKey,id:task.id,title:'Changed'},
    set_task_completed:{operationKey:task.operationKey,id:task.id,completed:true},
    remove_task:{operationKey:task.operationKey,id:task.id},
    update_project:{operationKey:project.operationKey,id:project.id,title:'Changed'},
    set_project_status:{operationKey:project.operationKey,id:project.id,status:'complete'},
    archive_project:{operationKey:project.operationKey,id:project.id},
    restore_project:{operationKey:project.operationKey,id:project.id},
  }
  for(const [name,args] of Object.entries(edits)){
    for(const version of [undefined,0,-1,1.2,'1'])assert.equal(validateArguments(name,{...args,...(version===undefined?{}:{expectedVersion:version})}).valid,false,name)
    assert.equal(validateArguments(name,{...args,expectedVersion:1}).valid,true,name)
  }
  assert.equal(validateArguments('update_task',{operationKey:task.operationKey,id:task.id,expectedVersion:1}).valid,false)
  assert.equal(validateArguments('update_project',{operationKey:project.operationKey,id:project.id,expectedVersion:1,status:'complete'}).valid,false)
  const {id,...rest}=event
  const update={...rest,eventId:id,expectedEtag:'"v1"'}
  for(const expectedEtag of [undefined,'','*','W/"v1"','v1'])assert.equal(validateArguments('update_calendar_event',{...update,expectedEtag}).valid,false)
  assert.equal(validateArguments('update_calendar_event',update).valid,true)
  assert.equal(validateArguments('cancel_calendar_event',{operationKey:event.operationKey,calendarId:event.calendarId,eventId:id,scope:'single',expectedEtag:'"v1"'}).valid,true)
})

test('recurrence and ambiguous scope are rejected rather than converted to a single event',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  for(const args of [{...event,recurrence:{frequency:'weekly'}},{...event,rrule:'FREQ=WEEKLY'},{...event,recurrenceId:'2026-11-01'},{...event,scope:'series'},{...event,scope:undefined}]){
    assert.deepEqual(await dispatcher.dispatch('create_calendar_event',args,action),{state:'rejected',code:'unsupported_recurrence'})
  }
  assert.equal(fake.calls.length,0)
  assert.equal(validateArguments('create_task',{...task,recurrence:{frequency:'weekly'}}).valid,false)
  assert.equal(validateArguments('create_task',{...task,calendarId:'Calendar_A',start:event.start,end:event.end}).valid,false)
})

test('exact IDs, safe pagination and tombstones survive; completing a task does not complete its parent',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  assert.equal((await dispatcher.dispatch('create_project',project,action)).state,'applied')
  assert.deepEqual(await dispatcher.dispatch('create_task',{...task,projectId:project.id},action),{state:'applied',id:task.id,version:1})
  const complete={operationKey:'operation_complete_01',id:task.id,expectedVersion:1,completed:true}
  assert.deepEqual(await dispatcher.dispatch('set_task_completed',complete,action),{state:'applied',id:task.id,version:2})
  assert.deepEqual(await dispatcher.dispatch('update_task',{operationKey:'operation_stale_0001',id:task.id,expectedVersion:1,title:'Stale'},action),{state:'conflict',code:'revision_mismatch'})
  const projects=await dispatcher.dispatch('list_projects',{limit:1},action)
  assert.equal(projects.state,'ok')
  if(projects.state==='ok')assert.deepEqual(projects.data,{items:[{id:project.id,title:project.title,description:'',kind:'project',status:'active',archived:false,version:1}],nextOffset:null})
  assert.equal((await dispatcher.dispatch('remove_task',{operationKey:'operation_remove_001',id:task.id,expectedVersion:2},action)).state,'applied')
  const result=await dispatcher.dispatch('list_tasks',{...read,limit:1},action)
  assert.equal(result.state,'ok')
  if(result.state==='ok')assert.deepEqual(result.data,{items:[{id:task.id,title:task.title,date:task.date,notes:'',important:false,projectId:project.id,completed:true,deleted:true,version:3}],nextOffset:null})
  assert.equal(fake.calls[1]?.args.id,task.id)
  assert.equal((await dispatcher.dispatch('update_task',{operationKey:'operation_deleted_01',id:task.id,expectedVersion:3,title:'Resurrect'},action)).state,'conflict')
})

test('assignment, project lifecycle and calendar mutation contracts are usable offline',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  assert.equal((await dispatcher.dispatch('create_assignment',{...project,deadline:'2026-12-01'},action)).state,'applied')
  assert.equal((await dispatcher.dispatch('update_project',{operationKey:'operation_project_02',id:project.id,expectedVersion:1,title:'Edited assignment'},action)).state,'applied')
  assert.equal((await dispatcher.dispatch('set_project_status',{operationKey:'operation_project_03',id:project.id,expectedVersion:2,status:'complete'},action)).state,'applied')
  assert.equal((await dispatcher.dispatch('archive_project',{operationKey:'operation_project_04',id:project.id,expectedVersion:3},action)).state,'applied')
  assert.equal((await dispatcher.dispatch('restore_project',{operationKey:'operation_project_05',id:project.id,expectedVersion:4},action)).state,'applied')
  assert.equal(validateArguments('create_assignment',project).valid,false)
  assert.deepEqual(await dispatcher.dispatch('create_calendar_event',event,action),{state:'applied',id:event.id,etag:'"fake-1"'})
  const {id,...fields}=event
  const update={...fields,eventId:id,operationKey:'operation_event_0002',expectedEtag:'"fake-1"',title:'Edited meeting'}
  assert.deepEqual(await dispatcher.dispatch('update_calendar_event',update,action),{state:'applied',id,etag:'"fake-2"'})
  const cancel={eventId:id,calendarId:event.calendarId,scope:'single',operationKey:'operation_event_0003',expectedEtag:'"fake-1"'}
  assert.deepEqual(await dispatcher.dispatch('cancel_calendar_event',cancel,action),{state:'conflict',code:'revision_mismatch'})
  assert.deepEqual(await dispatcher.dispatch('cancel_calendar_event',{...cancel,operationKey:'operation_event_0004',expectedEtag:'"fake-2"'},action),{state:'applied',id,etag:'"fake-3"'})
  const result=await dispatcher.dispatch('list_calendar_events',{calendarId:event.calendarId,from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',limit:1},action)
  assert.equal(result.state,'ok')
  if(result.state==='ok')assert.equal((result.data as {items:{cancelled:boolean}[]}).items[0]?.cancelled,true)
})

test('operation keys bind tool and canonical payload; cached retry does not re-dispatch',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  const first=await dispatcher.dispatch('create_task',task,action)
  assert.deepEqual(await dispatcher.dispatch('create_task',Object.fromEntries(Object.entries(task).reverse()),action),first)
  assert.deepEqual(await dispatcher.dispatch('create_task',{...task,title:'Different'},action),{state:'conflict',code:'operation_key_mismatch'})
  assert.deepEqual(await dispatcher.dispatch('create_project',{operationKey:task.operationKey,id:'Other',title:'Other'},action),{state:'conflict',code:'operation_key_mismatch'})
  assert.equal(fake.calls.length,1)
  assert.deepEqual(await dispatcher.dispatch('get_operation_status',{operationKey:task.operationKey},action),{state:'ok',data:{operationKey:task.operationKey,status:'applied'}})
})

test('thrown or malformed write responses become uncertain, redact errors and never auto-retry',async()=>{
  for(const execute of [async()=>{throw Error('private backend details')},async()=>({state:'applied',id:task.id,version:1,credential:'do not expose'}),async()=>({state:'applied',id:'different-id',version:1})]){
    let calls=0
    const dispatcher=new Dispatcher({execute:async()=>{calls++;return execute()}})
    const expected={state:'uncertain',operationKey:task.operationKey}
    assert.deepEqual(await dispatcher.dispatch('create_task',task,action),expected)
    assert.deepEqual(await dispatcher.dispatch('create_task',task,action),expected)
    assert.deepEqual(await dispatcher.dispatch('create_task',{...task,title:'Changed'},action),{state:'conflict',code:'operation_key_mismatch'})
    assert.deepEqual(await dispatcher.dispatch('get_operation_status',{operationKey:task.operationKey},action),{state:'ok',data:{operationKey:task.operationKey,status:'uncertain'}})
    assert.equal(calls,1)
  }
})

test('concurrent retries are reserved before transport and ledger exhaustion fails closed',async()=>{
  let release!:(value:unknown)=>void,calls=0
  const dispatcher=new Dispatcher({execute:async()=>{calls++;return new Promise(resolve=>{release=resolve})}},1)
  const first=dispatcher.dispatch('create_task',task,action)
  assert.deepEqual(await dispatcher.dispatch('create_task',task,action),{state:'uncertain',operationKey:task.operationKey})
  assert.deepEqual(await dispatcher.dispatch('create_task',{...task,operationKey:'operation_another_01'},action),{state:'rejected',code:'operation_capacity'})
  release({state:'applied',id:task.id,version:1})
  assert.equal((await first).state,'applied')
  assert.equal(calls,1)
})

test('production is unconfigured; read errors and unsafe transport data fail closed',async()=>{
  assert.deepEqual(await new Dispatcher().dispatch('create_task',task,action),{state:'rejected',code:'transport_unconfigured'})
  for(const execute of [async()=>{throw Error('secret')},async()=>({state:'ok',data:{items:[{id:'x',password:'secret'}],nextOffset:null}})]){
    assert.deepEqual(await new Dispatcher({execute}).dispatch('list_tasks',read,action),{state:'rejected',code:'transport_failure'})
  }
})

test('every tool has an exact allowlist and the registry exposes no generic executor',()=>{
  const {id,...eventFields}=event
  const valid:Record<string,Record<string,unknown>>={
    list_calendars:{limit:1},
    list_calendar_events:{calendarId:event.calendarId,from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',limit:1},
    list_tasks:read,
    list_projects:{limit:1},
    get_operation_status:{operationKey:task.operationKey},
    create_task:task,
    update_task:{operationKey:task.operationKey,id:task.id,expectedVersion:1,title:'Edit'},
    set_task_completed:{operationKey:task.operationKey,id:task.id,expectedVersion:1,completed:false},
    remove_task:{operationKey:task.operationKey,id:task.id,expectedVersion:1},
    create_project:project,
    create_assignment:{...project,deadline:'2026-12-01'},
    update_project:{operationKey:project.operationKey,id:project.id,expectedVersion:1,description:'Edit'},
    set_project_status:{operationKey:project.operationKey,id:project.id,expectedVersion:1,status:'active'},
    archive_project:{operationKey:project.operationKey,id:project.id,expectedVersion:1},
    restore_project:{operationKey:project.operationKey,id:project.id,expectedVersion:1},
    create_calendar_event:event,
    update_calendar_event:{...eventFields,eventId:id,expectedEtag:'"fake-1"'},
    cancel_calendar_event:{operationKey:event.operationKey,calendarId:event.calendarId,eventId:id,expectedEtag:'"fake-1"',scope:'single'},
    list_daily_actions:read,
    create_daily_action:{operationKey:task.operationKey,id:'Daily_A',projectId:project.id,title:'Synthetic action',date:'2026-11-01',notes:'',minutes:30},
    update_daily_action:{operationKey:task.operationKey,id:'Daily_A',expectedVersion:1,completed:true},
    list_preparations:{limit:1},
    update_preparation:{operationKey:task.operationKey,id:'Preparation_A',expectedVersion:1,status:'paused'},
    update_preparation_topic:{operationKey:task.operationKey,id:'Preparation_A',topicId:'Topic_A',expectedVersion:1,title:'Edit'},
    create_preparation:{operationKey:task.operationKey,id:'Preparation_A',calendarId:event.calendarId,eventId:id,title:'Study',startDate:'2026-10-01',progress:'',topicTitle:'Topic',topicNotes:'',topicMinutes:30},
    relink_preparation:{operationKey:task.operationKey,id:'Preparation_A',expectedVersion:1,calendarId:event.calendarId,eventId:id},
    insert_preparation_topic:{operationKey:task.operationKey,id:'Preparation_A',expectedVersion:1,title:'Topic',notes:'',minutes:30},
    remove_preparation_topic:{operationKey:task.operationKey,id:'Preparation_A',expectedVersion:1,topicId:'Topic_A'},
    search_inbox:{limit:1,query:'synthetic',account:'all',importantOnly:false},
    get_inbox_message:{id:'Cached_Message',offset:0,limit:100},
    list_prices:{limit:1},
    get_calendar_series:{calendarId:event.calendarId,eventId:id},
  }
  assert.deepEqual(Object.keys(TOOLS).sort(),Object.keys(valid).sort())
  for(const [name,args] of Object.entries(valid)){
    assert.equal(validateArguments(name,args).valid,true,name)
    for(const extra of ['url','sql','route','shell','authorization','context','capabilities','profile'])assert.equal(validateArguments(name,{...args,[extra]:'forbidden'}).valid,false,`${name}: ${extra}`)
    if(TOOLS[name as keyof typeof TOOLS].write){
      const {operationKey:_key,...withoutKey}=args
      assert.equal(validateArguments(name,withoutKey).valid,false,`${name}: missing operation key`)
    }
  }
})

test('single scope assertions cannot mutate an existing recurring source event',async()=>{
  const seed={id:event.id,calendarId:event.calendarId,title:event.title,start:event.start,end:event.end,allDay:false,description:'',location:'',recurring:true,cancelled:false,etag:'"fake-1"'}
  const fake=new FakeTransport({events:[seed]}),dispatcher=new Dispatcher(fake)
  const {id,...fields}=event
  assert.deepEqual(await dispatcher.dispatch('update_calendar_event',{...fields,eventId:id,expectedEtag:'"fake-1"'},action),{state:'rejected',code:'unsupported_recurrence'})
  const cancel={operationKey:'operation_cancel_001',calendarId:event.calendarId,eventId:id,expectedEtag:'"fake-1"',scope:'single'}
  assert.deepEqual(await dispatcher.dispatch('cancel_calendar_event',cancel,action),{state:'rejected',code:'unsupported_recurrence'})
  const count=fake.calls.length
  for(const scope of ['series','this_and_future',undefined])assert.deepEqual(await dispatcher.dispatch('cancel_calendar_event',{...cancel,scope},action),{state:'rejected',code:'unsupported_recurrence'})
  assert.equal(fake.calls.length,count)
})

test('bounded read projections reject oversized pages, extra fields and out-of-window records',async()=>{
  const item={id:task.id,title:task.title,date:task.date,notes:'',important:false,completed:false,deleted:false,version:1}
  for(const data of [
    {items:new Array(1),nextOffset:null},
    {items:Object.assign([item],{raw:'private'}),nextOffset:null},
    {items:[item,item],nextOffset:null},
    {items:[{...item,date:'2026-10-31'}],nextOffset:null},
    {items:[{...item,raw:'private data'}],nextOffset:null},
    {items:[item],nextOffset:0},
    {items:[item],nextOffset:null,credentials:'private'},
  ]){
    const dispatcher=new Dispatcher({execute:async()=>({state:'ok',data})})
    assert.deepEqual(await dispatcher.dispatch('list_tasks',{...read,limit:1},action),{state:'rejected',code:'transport_failure'})
  }
})

test('paged fake reads retain exact IDs and local cached results are immutable to callers',async()=>{
  const fake=new FakeTransport(),dispatcher=new Dispatcher(fake)
  const result=await dispatcher.dispatch('create_task',task,action)
  if(result.state==='applied')result.id='Caller_modified'
  assert.deepEqual(await dispatcher.dispatch('create_task',task,action),{state:'applied',id:task.id,version:1})
  assert.equal((await dispatcher.dispatch('create_task',{...task,id:'Second_Task',operationKey:'operation_task_0002'},action)).state,'applied')
  const first=await dispatcher.dispatch('list_tasks',{...read,limit:1},action)
  assert.equal(first.state,'ok')
  if(first.state==='ok')assert.equal((first.data as {nextOffset:number}).nextOffset,1)
  const second=await dispatcher.dispatch('list_tasks',{...read,limit:1,offset:1},action)
  assert.equal(second.state,'ok')
  if(second.state==='ok')assert.deepEqual((second.data as {items:{id:string}[];nextOffset:null}),{items:[{id:'Second_Task',title:task.title,date:task.date,notes:'',important:false,completed:false,deleted:false,version:1}],nextOffset:null})
  const count=fake.calls.length
  assert.deepEqual(await dispatcher.dispatch('create_task',task,{purpose:'extraction',capabilities:action.capabilities}),{state:'rejected',code:'forbidden'})
  assert.equal(fake.calls.length,count)
})

test('unknown status never implies nonexecution; malformed receipts retain uncertain state',async()=>{
  assert.deepEqual(await new Dispatcher(new FakeTransport()).dispatch('get_operation_status',{operationKey:task.operationKey},action),{state:'ok',data:{operationKey:task.operationKey,status:'unknown'}})
  for(const response of [
    {state:'uncertain',operationKey:'another_operation_key'},
    {state:'ok',data:{saved:true}},
    {state:'applied',id:task.id,etag:'"fake-1"'},
    {state:'applied',id:task.id,version:0},
  ])assert.deepEqual(await new Dispatcher({execute:async()=>response}).dispatch('create_task',task,action),{state:'uncertain',operationKey:task.operationKey})
  assert.deepEqual(await new Dispatcher({execute:async()=>({state:'ok',data:{operationKey:'another_operation_key',status:'applied'}})}).dispatch('get_operation_status',{operationKey:task.operationKey},action),{state:'rejected',code:'transport_failure'})
})
