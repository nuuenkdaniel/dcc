// Pure metadata/schema/fixture regressions. No executable runner import, model,
// listener, SQL connection, profile/bootstrap discovery or browser launch.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EVERYDAY_CASES,EVERYDAY_MODEL_CAP,EVERYDAY_SEED,EVERYDAY_ORIGIN,everydayOptions,everydayRequestHeaders,RECURRENCE_SENTINEL,CALENDAR_WINDOW,TASK_WINDOW} from '../acceptance/everyday-actions-cases.js'
import {JourneyRuntime} from '../acceptance/journey-runtime.js'
import {SyntheticCalendarProvider,expanded,calendars,PROVIDER} from '../acceptance/calendar-provider.js'
import {TOOLS,ACTIVE_TOOLS,isActiveTool as isTool} from '../../src/mcp/contracts.js'
import {validateServiceArguments} from '../../src/mcp/service-contracts.js'
import {validManualTask} from '../../src/manual-tasks.js'

const env={DCC_QA_EVERYDAY_APPROVED:'synthetic-everyday-actions-model',DCC_QA_RUNTIME_APPROVED:'synthetic-loopback-model',DCC_QA_DATABASE:'dcc_qa_everyday_01',DCC_QA_PG_USER:'postgres'}
test('first login and every app GET/POST/replay/conflict use closing connections across case rebinds',()=>{
  assert.deepEqual(everydayRequestHeaders('',true),{Connection:'close',Cookie:'',Origin:EVERYDAY_ORIGIN,'Content-Type':'application/json'})
  for(const hasBody of [false,true,true,true]){
    const headers=everydayRequestHeaders('synthetic-cookie',hasBody)
    assert.equal(headers.Connection,'close');assert.equal(headers.Cookie,'synthetic-cookie')
    assert.equal(headers.Origin,hasBody?EVERYDAY_ORIGIN:undefined)
    assert.equal(headers['Content-Type'],hasBody?'application/json':undefined)
  }
})
test('everyday opt-in and endpoint arguments are exact; ambient production defaults are refused',()=>{
  assert.deepEqual(everydayOptions([],env),{database:'dcc_qa_everyday_01',user:'postgres',preflightOnly:false})
  assert.equal(everydayOptions(['--preflight-only'],env).preflightOnly,true)
  for(const args of [['--retry'],['--model','anything'],['--callback-url','http://example.invalid'],['--preflight-only','extra']])assert.throws(()=>everydayOptions(args,env))
  for(const patch of [{DCC_QA_EVERYDAY_APPROVED:undefined},{DCC_QA_RUNTIME_APPROVED:undefined},{DCC_QA_DATABASE:'production'},{DCC_QA_DATABASE:'dcc_qa_example\n'},{DCC_QA_PG_USER:'postgres\n'},{DATABASE_URL:'never-connect'},{PGHOST:'elsewhere'},{PGPASSFILE:'/never-open'},{NODE_OPTIONS:'--never-use'}])assert.throws(()=>everydayOptions([],{...env,...patch}))
})
test('one seed/twelve requests, every expected write is a real service tool under existing per-request limits',()=>{
  assert.equal(EVERYDAY_SEED,20261107);assert.equal(EVERYDAY_MODEL_CAP,12);assert.equal(EVERYDAY_CASES.length,12)
  assert.equal(new Set(EVERYDAY_CASES.map(c=>c.id)).size,12)
  assert.equal(EVERYDAY_CASES.reduce((n,c)=>n+c.tools.length,0),19)
  assert.equal(ACTIVE_TOOLS.length,35)
  for(const c of EVERYDAY_CASES){assert.ok(c.tools.length<=4);for(const tool of c.tools){assert.equal(isTool(tool),true);assert.equal(TOOLS[tool].write,true);assert.ok(!tool.includes('timer')&&!tool.includes('queue'))}}
  assert.deepEqual(EVERYDAY_CASES.find(c=>c.id==='EA09')!.tools,[])
  assert.deepEqual(EVERYDAY_CASES.slice(-3).map(c=>c.tools[0]),['create_calendar_event','update_calendar_event','cancel_calendar_event'])
})
test('standalone task estimate is notes only; daily-action numeric minutes and assignment deadline update are supported',()=>{
  const id='12345678-1234-4234-a234-123456789abc',key='qa_operation_20261107_001'
  const task={operationKey:key,id,title:'Synthetic',date:'2030-11-07',notes:'Estimate: 25 minutes',important:true,expectedVersion:0}
  assert.equal(validateServiceArguments('create_task',task).valid,true)
  assert.equal(validateServiceArguments('create_task',{...task,minutes:25}).valid,false)
  assert.equal(validateServiceArguments('update_task',{operationKey:key,id,expectedVersion:1,minutes:35}).valid,false)
  assert.equal(validateServiceArguments('create_daily_action',{operationKey:key,id,projectId:id,title:'Synthetic child',date:'2030-11-07',notes:'Draft',minutes:25}).valid,true)
  assert.equal(validateServiceArguments('update_daily_action',{operationKey:key,id,expectedVersion:1,minutes:40,completed:true}).valid,true)
  assert.equal(validateServiceArguments('update_project',{operationKey:key,id,expectedVersion:1,deadline:'2030-11-22'}).valid,true)
  assert.equal(validateServiceArguments('update_project',{operationKey:key,id,expectedVersion:1,courseId:'invented'}).valid,false)
  assert.equal(isTool('delete_project'),false)
})
test('finite task/calendar read windows satisfy actual service validation and recurrence sentinel is valid',()=>{
  assert.equal(validateServiceArguments('list_tasks',TASK_WINDOW).valid,true)
  assert.equal(validateServiceArguments('list_calendar_events',{...CALENDAR_WINDOW,calendarId:calendars[0]!.id}).valid,true)
  assert.equal(validateServiceArguments('list_calendar_events',{...CALENDAR_WINDOW,calendarId:calendars[0]!.id,from:'2030-10-01T00:00:00Z',to:'2030-12-01T00:00:00Z'}).valid,false)
  assert.equal(validManualTask(RECURRENCE_SENTINEL),true)
  assert.equal(new Date(RECURRENCE_SENTINEL.date+'T00:00:00Z').getUTCDay(),RECURRENCE_SENTINEL.recurrence.weekday)
})
test('2030 donor is real parseable named-zone ICS, while existing calendar fixture defaults stay 2026',()=>{
  const normal=new SyntheticCalendarProvider(),future=new SyntheticCalendarProvider(2030)
  assert.equal(normal.year,2026);assert.equal(future.year,2030)
  for(const calendar of calendars){
    const path=new URL(calendar.url).pathname+'zone-donor.ics',resource=future.resources.get(path)!
    assert.ok(normal.resources.get(path)!.body.includes('20261026T090000'))
    assert.ok(resource.body.includes('20301026T090000'))
    const events=expanded(resource.body,calendar.id,PROVIDER+path,resource.etag)
    assert.equal(events.length,1);assert.equal(events[0]!.start,'2030-10-26T13:00:00.000Z')
  }
  assert.throws(()=>new SyntheticCalendarProvider(2029 as 2030))
})
test('reviewed twelve-call budget cannot grow to thirteen; old ten-call default remains intact',async()=>{
  const signal=new AbortController().signal,normal=new JourneyRuntime(signal),everyday=new JourneyRuntime(signal,12)
  const input={mode:'product-action' as const,prompt:'Never dispatched',callbackCapability:'a'.repeat(64),expiresAt:Date.now()+120000}
  assert.equal(normal.maxCalls,10);assert.equal(everyday.maxCalls,12)
  normal.calls=10;everyday.calls=12
  await assert.rejects(normal.invoke(input,signal));await assert.rejects(everyday.invoke(input,signal))
  assert.throws(()=>new JourneyRuntime(signal,13 as 12))
  assert.equal(normal.calls,10);assert.equal(everyday.calls,12)
})
