import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Pool} from 'pg'
import {buildApp} from '../src/app.js'
import {migrate,sessionStore} from '../src/database.js'
import {migratePlanner,plannerSnapshot} from '../src/planner.js'
import {taskSnapshot} from '../src/manual-tasks.js'
import {processCalendarWrite,type CalendarOperations} from '../src/workspace-writes.js'
import type {EventOccurrence} from '../src/events.js'

const url=process.env.DCC_WORKSPACE_TEST_DB
test('workspace receipts are transactional, owner-scoped and keep calendar writes pending until visible',{skip:!url},async()=>{
 assert.ok(url,'Set DCC_WORKSPACE_TEST_DB to an isolated test PostgreSQL instance')
 const root=new Pool({connectionString:url})
 const schema='workspace_'+randomUUID().replaceAll('-','')
 await root.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:5})
 const origin='http://dcc.example.test'
 const base={calendars:[{id:'calendar',name:'Fixture',url:'https://calendar.example.test/test/'}],events:[] as EventOccurrence[],coverageStart:'2026-01-01T00:00:00Z',coverageEnd:'2027-01-01T00:00:00Z'}
 let snapshot=base,allowRefresh=false,providerCalls=0,rejectProvider=false
 const calendar:CalendarOperations={
  write:async()=>{providerCalls++;return rejectProvider?{code:409,safeFailure:'revision_mismatch'}:{code:200,saved:true}},
  refresh:async()=>allowRefresh?'synced':'busy',
  snapshot:async()=>snapshot,
 }
 const app=buildApp({auth:{username:'qa',password:'test-only',origin,store:sessionStore(pool)},plannerPool:pool,workspaceCalendar:calendar})
 let other:ReturnType<typeof buildApp>|undefined
 try{
  await migrate(pool)
  await migratePlanner(pool)
  await pool.query('UPDATE calendar_sync_state SET snapshot=$1 WHERE id=1',[base])
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'qa',password:'test-only'}})
  const cookie=login.cookies[0]!.name+'='+login.cookies[0]!.value
  const endpoint='/api/v1/workspace/writes'
  const owner=login.json().workspaceOwner
  const post=(payload:object)=>app.inject({method:'POST',url:endpoint,headers:{origin,cookie,'x-dcc-workspace-owner':owner},payload})
  const get=(id:string)=>app.inject({url:endpoint+'/'+id,headers:{cookie}})
  const task={id:'task-a',title:'Read notes',date:'2026-11-10',notes:'',completed:false}
  const id=randomUUID()
  const request={id,kind:'task',payload:{expected:null,task}}
  const wrong=await app.inject({method:'POST',url:endpoint,headers:{origin,cookie,'x-dcc-workspace-owner':'b'.repeat(64)},payload:request})
  assert.equal(wrong.statusCode,409)
  assert.equal((await taskSnapshot(pool)).version,0)
  const [one,two]=await Promise.all([post(request),post(request)])
  assert.equal(one.statusCode,200)
  assert.deepEqual(one.json(),two.json())
  assert.equal((await taskSnapshot(pool)).version,1)
  assert.deepEqual((await get(id)).json().task,task)
  assert.equal((await post({...request,payload:{expected:null,task:{...task,title:'other'}}})).statusCode,409)
  assert.equal((await post({...request,id:randomUUID()})).statusCode,409)
  const edited={...task,completed:true}
  const edit=await post({id:randomUUID(),kind:'task',payload:{expected:task,task:edited}})
  assert.deepEqual(edit.json().task,edited)
  assert.equal((await post({id:randomUUID(),kind:'task',payload:{expected:task,task:{...task,deleted:true}}})).statusCode,409)
  assert.deepEqual((await taskSnapshot(pool)).data.tasks,[edited])
  assert.equal((await app.inject({url:endpoint+'/'+id})).statusCode,401)
  other=buildApp({auth:{username:'other',password:'otherwise',origin,store:sessionStore(pool)},plannerPool:pool})
  const otherLogin=await other.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'other',password:'otherwise'}})
  const otherCookie=otherLogin.cookies[0]!.name+'='+otherLogin.cookies[0]!.value
  assert.equal((await other.inject({url:endpoint+'/'+id,headers:{cookie:otherCookie}})).statusCode,404)

  const project={id:randomUUID(),title:'Assignment',kind:'assignment',category:'school',deadline:'',description:'',progress:'',status:'active',importance:1,remainingMinutes:10}
  const projectWrite=await post({id:randomUUID(),kind:'planner',payload:{kind:'project',version:0,data:project}})
  assert.equal(projectWrite.statusCode,200)
  assert.equal(projectWrite.json().entry.version,1)
  assert.deepEqual((await plannerSnapshot(pool)).projects[0]?.data,project)

  const change={id:randomUUID(),calendarId:'calendar',title:'Event',start:'2026-11-12',end:'2026-11-13',allDay:true,description:'',location:''}
  const eventWrite=await post({id:change.id,kind:'calendar',payload:change})
  assert.equal(eventWrite.statusCode,202)
  await processCalendarWrite(pool,calendar)
  assert.equal((await get(change.id)).json().state,'saving')
  assert.equal(providerCalls,1)
  allowRefresh=true
  snapshot={...base,events:[{...change,resource:'https://calendar.example.test/test/event.ics',etag:'"1"',uid:'fixture',recurrenceId:null,mutationId:change.id}]}
  await pool.query('UPDATE workspace_writes SET next_attempt=now() WHERE id=$1',[change.id])
  await processCalendarWrite(pool,calendar)
  assert.equal((await get(change.id)).json().state,'saved')
  assert.equal((await get(change.id)).json().event.mutationId,change.id)
  const before=providerCalls
  await processCalendarWrite(pool,calendar)
  assert.equal(providerCalls,before)

  rejectProvider=true
  const rejected={...change,id:randomUUID(),title:'Rejected event'}
  assert.equal((await post({id:rejected.id,kind:'calendar',payload:rejected})).statusCode,202)
  await processCalendarWrite(pool,calendar)
  assert.deepEqual((await get(rejected.id)).json(),{state:'failed',code:409})
  assert.equal(snapshot.events.length,1)
  const outside={...change,id:randomUUID(),start:'2040-01-01',end:'2040-01-02'}
  assert.equal((await post({id:outside.id,kind:'calendar',payload:outside})).statusCode,400)
  await processCalendarWrite(pool,calendar)
  assert.equal(providerCalls,before+1)
 }finally{
  await other?.close()
  await app.close()
  await pool.end()
  await root.query(`DROP SCHEMA ${schema} CASCADE`)
  await root.end()
 }
})
