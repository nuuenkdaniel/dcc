import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Dispatcher} from '../../src/mcp/dispatcher.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {createScopedCalendarWriter} from '../../src/calendar-write.js'
import {config} from './calendar-harness.js'
import {ProductPool,projectId,actionId,preparationId} from './product-pool.js'

const context={purpose:'action' as const,capabilities:['planner:read','planner:write','inbox:read','prices:read','calendars:read']}
function fixture(){const db=new ProductPool();return {db,d:new Dispatcher(new ServiceTransport({pool:db.pool,actorId:'synthetic',guardedCalendarWriter:createScopedCalendarWriter(db.pool,config,db.fetch)}))}}
test('daily action id is exact action row ID, never parent ID; date-window lookup stays bounded and read-only',async()=>{
  const {db,d}=fixture(),before=structuredClone([...db.rows.values()])
  const window={from:'2026-11-01',to:'2026-11-04',limit:10,offset:0}
  const wrong=await d.dispatch('list_daily_actions',{...window,id:projectId},context)
  assert.deepEqual(wrong,{state:'ok',data:{items:[],nextOffset:null}})
  const right=await d.dispatch('list_daily_actions',{...window,id:actionId},context)
  assert.equal(right.state,'ok')
  if(right.state==='ok'){
    const data=right.data as {items:{id:string;projectId:string;version:number}[];nextOffset:number|null}
    assert.equal(data.items.length,1);assert.equal(data.items[0]!.id,actionId);assert.equal(data.items[0]!.projectId,projectId);assert.equal(data.items[0]!.version,1);assert.equal(data.nextOffset,null)
  }
  const bounded=await d.dispatch('list_daily_actions',window,context)
  assert.deepEqual(bounded,right)
  assert.deepEqual(await d.dispatch('list_daily_actions',{...window,id:actionId,from:'2026-11-03'},context),{state:'ok',data:{items:[],nextOffset:null}})
  assert.equal((await d.dispatch('list_daily_actions',{...window,projectId},context)).state,'rejected')
  assert.deepEqual([...db.rows.values()],before);assert.equal(db.fetches.length,0);assert.equal(db.puts,0)
})
test('daily action completion/reopen/edit retain parent and unknown fields, generated dates are immutable',async()=>{
  const {db,d}=fixture()
  assert.equal((await d.dispatch('update_daily_action',{id:actionId,expectedVersion:1,operationKey:'daily_complete_001',completed:true},context)).state,'applied')
  assert.equal(db.rows.get(projectId)!.data.status,'active');assert.equal(db.rows.get(actionId)!.data.unknown,'retain')
  assert.equal((await d.dispatch('update_daily_action',{id:actionId,expectedVersion:1,operationKey:'daily_stale_00001',completed:false},context)).state,'conflict')
  assert.equal((await d.dispatch('update_daily_action',{id:actionId,expectedVersion:2,operationKey:'daily_move_000001',date:'2026-11-03'},context)).state,'rejected')
  assert.equal(db.rows.get(actionId)!.data.date,'2026-11-02')
  assert.equal((await d.dispatch('update_daily_action',{id:actionId,expectedVersion:2,operationKey:'daily_reopen_0001',completed:false,feedback:'review'},context)).state,'applied')
  const read=await d.dispatch('list_daily_actions',{from:'2026-11-01',to:'2026-11-04',limit:10},context)
  assert.equal(read.state,'ok');assert.equal(JSON.stringify(read).includes('unknown'),false)
})
test('manual action creation and preparation patches use existing versions and preserve source/topic metadata',async()=>{
  const {db,d}=fixture(),id='42345678-1234-4234-a234-123456789abc'
  assert.equal((await d.dispatch('create_daily_action',{id,projectId,title:'Synthetic manual',date:'2026-11-02',notes:'',minutes:20,operationKey:'manual_create_001'},context)).state,'applied')
  assert.equal(db.rows.get(id)!.data.source,'manual-project')
  const before=structuredClone(db.rows.get(preparationId)!.data)
  assert.equal((await d.dispatch('update_preparation',{id:preparationId,expectedVersion:1,status:'paused',progress:'Synthetic progress',operationKey:'preparation_0001'},context)).state,'applied')
  assert.deepEqual(db.rows.get(preparationId)!.data.topics,before.topics);assert.deepEqual(db.rows.get(preparationId)!.data.event,before.event)
  assert.equal(db.rows.get(preparationId)!.data.unknown,'retain');assert.equal(db.requested,true)
  assert.equal((await d.dispatch('update_preparation_topic',{id:preparationId,topicId:'topic',expectedVersion:2,title:'Reviewed topic',operationKey:'topic_update_0001'},context)).state,'applied')
  assert.equal(db.rows.get(preparationId)!.data.topics[0].title,'Reviewed topic')
  assert.equal(db.rows.get(preparationId)!.data.topics[0].id,'topic')
})
test('inbox/price projections are bounded cached reads without URLs, HTML, attachments or configuration',async()=>{
  const {db,d}=fixture()
  for(const [tool,args] of [['search_inbox',{query:'Synthetic',account:'all',importantOnly:false,limit:10}],['get_inbox_message',{id:'synthetic-mail',offset:10,limit:2}],['list_prices',{limit:1}]] as const){
    const result=await d.dispatch(tool,args,context)
    assert.equal(result.state,'ok',tool);assert.equal(JSON.stringify(result).includes('must-not-leak'),false)
  }
  assert.equal(db.fetches.length,0)
  assert.equal((await d.dispatch('get_inbox_message',{id:'synthetic-mail',offset:0,limit:10001},context)).state,'rejected')
})
test('authoritative calendar series details expose master, rule, selectors and ETag without resource URL',async()=>{
  const {db,d}=fixture()
  const result=await d.dispatch('get_calendar_series',{calendarId:'Calendar_A',eventId:'snapshot-event-id'},context)
  assert.equal(result.state,'ok');assert.equal(JSON.stringify(result).includes('https:'),false)
  if(result.state==='ok'){const data=result.data as Record<string,unknown>;assert.equal(data.rrule,'FREQ=WEEKLY;COUNT=4');assert.equal(data.etag,'"original"');assert.equal(data.uid,'original@daymark')}
  assert.equal(db.puts,0)
})

test('planner receipt/data roll back together on zero affected rows, and parser contexts cannot acquire writes',async()=>{
  const {db,d}=fixture(),args={id:actionId,expectedVersion:1,operationKey:'zero_planner_0001',completed:true}
  db.zero='entity-update'
  assert.equal((await d.dispatch('update_daily_action',args,context)).state,'uncertain')
  assert.equal(db.rows.get(actionId)!.data.completed,false)
  assert.equal((await d.dispatch('update_daily_action',{...args,operationKey:'parser_planner_01'},{...context,purpose:'parser'})).state,'rejected')
  assert.equal(db.rows.get(actionId)!.data.completed,false)
})

test('preparation note pagination is explicit and never includes unknown topic metadata',async()=>{
  const {db,d}=fixture()
  db.rows.get(preparationId)!.data.topics[0].notes='x'.repeat(700)
  db.rows.get(preparationId)!.data.topics[0].privateField='must-not-leak'
  const first=await d.dispatch('list_preparations',{id:preparationId,limit:1},context)
  assert.equal(first.state,'ok');assert.equal(JSON.stringify(first).includes('must-not-leak'),false)
  if(first.state==='ok'){
    const data=first.data as {items:{topics:{notes:string;nextNotesOffset:number|null}[]}[]}
    assert.equal(data.items[0]!.topics[0]!.notes.length,512)
    assert.equal(data.items[0]!.topics[0]!.nextNotesOffset,512)
  }
  const next=await d.dispatch('list_preparations',{id:preparationId,topicId:'topic',notesOffset:512,limit:1},context)
  assert.equal(next.state,'ok')
  if(next.state==='ok')assert.equal((next.data as {items:{topics:{notes:string}[]}[]}).items[0]!.topics[0]!.notes.length,188)
  assert.equal((await d.dispatch('list_preparations',{id:preparationId,limit:2},context)).state,'rejected')
})

test('preparation create/relink/topic insertion/removal retain history, versions and atomic receipts',async()=>{
  const {db,d}=fixture(),id='52345678-1234-4234-a234-123456789abc'
  const create={id,calendarId:'Calendar_A',eventId:'snapshot-event-id',title:'Study',startDate:'2026-10-01',progress:'Known progress',topicTitle:'First topic',topicNotes:'References',topicMinutes:45,operationKey:'prep_create_00001'}
  assert.equal((await d.dispatch('create_preparation',create,context)).state,'applied')
  const first=structuredClone(db.rows.get(id)!.data)
  assert.equal(first.event.uid,'original@daymark');assert.equal(db.requested,true)
  assert.equal((await d.dispatch('create_preparation',create,context)).state,'applied')
  assert.equal(db.rows.get(id)!.version,1)
  const insert={id,expectedVersion:1,title:'Inserted',notes:'',minutes:30,position:0,operationKey:'prep_insert_00001'}
  assert.equal((await d.dispatch('insert_preparation_topic',insert,context)).state,'applied')
  const topics=db.rows.get(id)!.data.topics
  assert.deepEqual(topics[1],first.topics[0]);assert.notEqual(topics[0].id,topics[1].id)
  assert.equal((await d.dispatch('insert_preparation_topic',{...insert,operationKey:'prep_stale_000001'},context)).state,'conflict')
  const history=structuredClone(db.rows.get(actionId))
  assert.equal((await d.dispatch('remove_preparation_topic',{id,expectedVersion:2,topicId:topics[0].id,operationKey:'prep_remove_00001'},context)).state,'applied')
  assert.deepEqual(db.rows.get(actionId),history)
  assert.deepEqual(db.rows.get(id)!.data.topics,first.topics)
  assert.equal((await d.dispatch('remove_preparation_topic',{id,expectedVersion:3,topicId:first.topics[0].id,operationKey:'prep_last_0000001'},context)).state,'rejected')
  db.snapshot.events.push({...db.snapshot.events[0]!,id:'new-exam',uid:'new-exam-uid',start:'2026-11-20T10:00:00Z',end:'2026-11-20T11:00:00Z'})
  assert.equal((await d.dispatch('relink_preparation',{id,expectedVersion:3,calendarId:'Calendar_A',eventId:'new-exam',operationKey:'prep_relink_00001'},context)).state,'applied')
  assert.equal(db.rows.get(id)!.data.event.uid,'new-exam-uid');assert.deepEqual(db.rows.get(id)!.data.topics,first.topics)
  assert.equal((await d.dispatch('relink_preparation',{id,expectedVersion:4,calendarId:'Calendar_A',eventId:'missing',operationKey:'prep_missing_0001'},context)).state,'conflict')
  const before=structuredClone(db.rows.get(id))
  db.zero='planning'
  assert.equal((await d.dispatch('insert_preparation_topic',{...insert,expectedVersion:4,operationKey:'prep_rollback_001'},context)).state,'uncertain')
  assert.deepEqual(db.rows.get(id),before)
  assert.ok(db.statements.some(s=>s.sql==='SELECT pg_advisory_xact_lock(817340)'))
})
