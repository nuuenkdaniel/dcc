import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Pool} from 'pg'
import {validateCommand,easternInstant,tellHermes} from '../src/tell-hermes.js'
import {buildApp} from '../src/app.js'

test('only three bounded create shapes or fixed missing/rejected results are accepted',()=>{
 assert.equal(validateCommand({action:'create-manual-task',title:'Read',date:'2026-10-27',notes:''}).action,'create-manual-task')
 for(const action of ['delete','edit','send-email','fetch','create-file','run-code'])assert.throws(()=>validateCommand({action,title:'Bad'}))
 for(const extra of [{url:'https://example.invalid'},{code:'return 1'},{id:'injected'},{completed:true}])assert.throws(()=>validateCommand({action:'create-manual-task',title:'Read',date:'2026-10-27',notes:'',...extra}))
 for(const date of ['',null,'tomorrow','2026-02-30'])assert.throws(()=>validateCommand({action:'create-manual-task',title:'Read',date,notes:''}))
 assert.throws(()=>validateCommand({action:'create-manual-task',title:'x'.repeat(241),date:'2026-10-27',notes:''}))
 assert.throws(()=>validateCommand({action:'create-manual-task',title:' ',date:'2026-10-27',notes:''}))
 assert.deepEqual(validateCommand({action:'missing',fields:['title','date']}),{action:'missing',fields:['title','date']})
 assert.throws(()=>validateCommand({action:'missing',fields:['arbitrary prose']}))
 assert.deepEqual(validateCommand({action:'rejected'}),{action:'rejected'})
})

test('New York local times resolve independently of host zone and reject DST gaps/ambiguity',()=>{
 assert.equal(easternInstant('2026-10-27T09:00'),'2026-10-27T13:00:00.000Z')
 assert.equal(easternInstant('2026-12-27T09:00'),'2026-12-27T14:00:00.000Z')
 for(const value of ['2026-03-08T02:30','2026-11-01T01:30','2026-02-30T09:00','2026-10-27T25:00','2026-10-27T09:00Z'])assert.throws(()=>easternInstant(value))
})

test('calendar requires explicit target, real start and bounded duration; assignments require deadline',()=>{
 const event={action:'create-calendar-event',title:'Review',calendar:'Fake',start:'2026-10-27T09:00',minutes:30,description:'',location:''}
 assert.equal(validateCommand(event).action,'create-calendar-event')
 for(const patch of [{minutes:0},{minutes:10081},{minutes:1.5},{start:'tomorrow'},{calendar:''},{eventId:'edit'}])assert.throws(()=>validateCommand({...event,...patch}))
 assert.throws(()=>validateCommand({action:'create-project-or-assignment',kind:'assignment',title:'Essay',deadline:null,description:'',remainingMinutes:null}))
})

// Synthetic storage only. Transaction snapshots also test rollback of a failed
// receipt update after an otherwise successful local insert.
function fakePool(){
 type Row={kind:string;version:number;data:any}
 let rows=new Map<string,Row>(),backup:Map<string,Row>|undefined
 const calls:string[]=[]
 let failReceipt=false
 const query=async(sql:string,values:any[]=[])=>{
  calls.push(sql)
  if(sql==='BEGIN')backup=structuredClone(rows)
  if(sql==='ROLLBACK'&&backup)rows=backup
  if(sql==='COMMIT')backup=undefined
  if(sql.startsWith('SELECT snapshot'))return {rows:[{snapshot:{calendars:[{id:'fake-calendar',name:'Fake'}]}}]}
  if(sql.startsWith('SELECT data FROM planner_entities')){const row=rows.get(values[0]);return {rows:row?.kind==='hermes-command'?[structuredClone(row)]:[]}}
  if(sql.startsWith('SELECT version,data FROM planner_entities')){const row=rows.get(values[0]);return {rows:row?[structuredClone(row)]:[]}}
  if(sql.startsWith('INSERT INTO planner_entities')){
   const kind=sql.includes("'hermes-command'")?'hermes-command':sql.includes("'manual-tasks'")?'manual-tasks':'project',old=rows.get(values[0])
   if(old&&kind!=='manual-tasks')throw Error('duplicate insert')
   rows.set(values[0],{kind,version:(old?.version??0)+1,data:structuredClone(values[1])})
  }
  if(sql.startsWith('UPDATE planner_entities')){
   if(failReceipt){failReceipt=false;throw Error('synthetic receipt failure')}
   const old=rows.get(values[0])!;rows.set(values[0],{...old,version:old.version+1,data:structuredClone(values[1])})
  }
  return {rows:[]}
 }
 return {pool:{connect:async()=>({query,release(){}}),query} as unknown as Pool,calls,rows:()=>rows,failNextReceipt:()=>{failReceipt=true}}
}
const submission={key:'synthetic-command-key-01',prompt:'Create a task called Read tomorrow'}
const task={action:'create-manual-task',title:'Read',date:'2026-10-27',notes:''}

test('manual task executes once, survives retries and preserves collection metadata and tombstones',async()=>{
 const fake=fakePool(),collection='ccbf2a93-9be3-45bd-b039-1019cdb8276f'
 const existing={id:'prior',title:'Prior',date:'2026-10-26',notes:'Keep',completed:false,deleted:true,custom:{keep:true}}
 fake.rows().set(collection,{kind:'manual-tasks',version:4,data:{tasks:[existing],custom:'collection metadata'}})
 let parses=0
 const options={pool:fake.pool,curator:async(input:unknown)=>{parses++;assert.deepEqual(input,{mode:'tell-hermes',prompt:submission.prompt,timezone:'America/New_York',referenceTime:'2026-10-26T23:30'});return task},now:()=>new Date('2026-10-27T03:30:00Z')}
 const result=await tellHermes(submission,options)
 assert.equal(result.code,200);assert.equal(result.origin,'hermes')
 assert.deepEqual(await tellHermes(submission,options),result)
 assert.equal(parses,1)
 const saved=fake.rows().get(collection)!
 assert.equal(saved.version,5);assert.equal(saved.data.custom,'collection metadata')
 assert.deepEqual(saved.data.tasks[0],existing)
 assert.equal(saved.data.tasks.length,2);assert.equal(saved.data.tasks[1].origin,'hermes')
 assert.equal((await tellHermes({...submission,prompt:'Different command'},options)).code,409)
 assert.ok(fake.calls.indexOf('SELECT pg_advisory_xact_lock(817342)')<fake.calls.findIndex(sql=>sql.includes("VALUES($1,'manual-tasks'")))
})

test('project/assignment creation keeps parent model; local insert and receipt complete atomically',async()=>{
 for(const kind of ['project','assignment']){
  const fake=fakePool(),command={action:'create-project-or-assignment',kind,title:'Essay',description:'Fake description',deadline:kind==='assignment'?'2026-11-10':null,remainingMinutes:null}
  const options={pool:fake.pool,curator:async()=>command}
  fake.failNextReceipt()
  await assert.rejects(tellHermes(submission,options))
  assert.equal([...fake.rows().values()].filter(row=>row.kind==='project').length,0)
  const result=await tellHermes(submission,options)
  assert.equal(result.code,200)
  const project=fake.rows().get(result.id!)!.data
  assert.equal(project.status,'active');assert.equal(project.kind,kind);assert.equal(project.remainingMinutes,0)
  assert.equal([...fake.rows().values()].some(row=>row.kind==='action'),false)
  assert.deepEqual(await tellHermes(submission,options),result)
 }
})

test('calendar retry uses persisted payload and same mutation ID after uncertain save, never reparses',async()=>{
 const fake=fakePool(),changes:unknown[]=[]
 let parses=0
 const options={pool:fake.pool,curator:async()=>{parses++;return {action:'create-calendar-event',title:'Review',calendar:'Fake',start:'2026-10-27T09:00',minutes:30,description:'Agenda',location:''}},calendarChange:async(change:unknown)=>{changes.push(structuredClone(change));return changes.length===1?{code:502}:{code:200,saved:true}}}
 assert.equal((await tellHermes(submission,options)).code,502)
 const result=await tellHermes(submission,options)
 assert.equal(result.code,200);assert.equal(parses,1)
 assert.deepEqual(changes[0],changes[1])
 assert.deepEqual(changes[0],{id:result.id,calendarId:'fake-calendar',title:'Review',start:'2026-10-27T13:00:00.000Z',end:'2026-10-27T13:30:00.000Z',allDay:false,description:'Hermes-created\nAgenda',location:''})
 await tellHermes(submission,options);assert.equal(changes.length,2)
})

test('invalid and unsupported bridge output cannot execute, missing details have bounded browser messages',async()=>{
 for(const command of [{action:'delete',id:'anything'},{...task,url:'https://fake.invalid'},[{...task}]]){
  const fake=fakePool()
  assert.equal((await tellHermes(submission,{pool:fake.pool,curator:async()=>command,calendarChange:async()=>{throw Error('must not execute')}})).code,502)
  assert.equal(fake.calls.some(sql=>/INSERT|UPDATE/.test(sql)),false)
 }
 for(const command of [{action:'missing',fields:['date']},{action:'rejected'}]){
  const fake=fakePool(),result=await tellHermes(submission,{pool:fake.pool,curator:async()=>command})
  assert.equal(result.code,422);assert.match(result.message,/Nothing was created/)
  assert.equal([...fake.rows().values()].every(row=>row.kind==='hermes-command'),true)
 }
})

test('Tell Hermes route requires session and same origin before touching storage or bridge',async()=>{
 const app=buildApp({plannerPool:{connect(){throw Error('No access')}} as unknown as Pool,curator:async()=>{throw Error('No bridge')},auth:{username:'fake',password:'fake-only',origin:'https://dcc.invalid',store:{async put(){},async has(){return false},async remove(){}}}})
 try{
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hermes/commands',headers:{origin:'https://other.invalid'},payload:submission})).statusCode,403)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/hermes/commands',headers:{origin:'https://dcc.invalid'},payload:submission})).statusCode,401)
 }finally{await app.close()}
})

test('authenticated route creates immediately, replays results, and rejects invalid request fields',async()=>{
 const fake=fakePool(),app=buildApp({plannerPool:fake.pool,curator:async()=>task,auth:{username:'fake',password:'fake-only',origin:'https://dcc.invalid',store:{async put(){},async has(){return true},async remove(){}}}})
 const headers={origin:'https://dcc.invalid',cookie:'daymark_session='+'a'.repeat(64)}
 try{
  const response=await app.inject({method:'POST',url:'/api/v1/hermes/commands',headers,payload:submission})
  assert.equal(response.statusCode,200);assert.match(response.json().message,/Hermes-created task/)
  assert.deepEqual((await app.inject({method:'POST',url:'/api/v1/hermes/commands',headers,payload:submission})).json(),response.json())
  for(const payload of [{key:'short',prompt:'Create task'},{key:submission.key,prompt:42},{key:submission.key,prompt:'x'.repeat(4001)},{...submission,url:'https://fake.invalid'}])assert.equal((await app.inject({method:'POST',url:'/api/v1/hermes/commands',headers,payload})).statusCode,400)
 }finally{await app.close()}
})

test('a calendar save followed by receipt failure retries the same provider mutation, not a new event',async()=>{
 const fake=fakePool(),ids=new Set<string>(),changes:unknown[]=[]
 const options={pool:fake.pool,curator:async()=>({action:'create-calendar-event',title:'Review',calendar:'Fake',start:'2026-10-27T09:00',minutes:30,description:'',location:''}),calendarChange:async(change:{id:string})=>{changes.push(structuredClone(change));ids.add(change.id);return {code:200,saved:true}}}
 fake.failNextReceipt()
 await assert.rejects(tellHermes(submission,options))
 assert.equal((await tellHermes(submission,options)).code,200)
 assert.equal(ids.size,1);assert.equal(changes.length,2);assert.deepEqual(changes[0],changes[1])
})

test('calendar name must match exactly one cached calendar; unavailable writes never execute',async()=>{
 for(const calendar of ['Unknown','']){
  const fake=fakePool(),command={action:'create-calendar-event',title:'Review',calendar,start:'2026-10-27T09:00',minutes:30,description:'',location:''}
  const result=await tellHermes(submission,{pool:fake.pool,curator:async()=>command,calendarChange:async()=>{throw Error('must not write')}})
  assert.equal(result.code,calendar?422:502)
  assert.equal(fake.calls.some(sql=>sql.startsWith('INSERT')),false)
 }
 const fake=fakePool()
 assert.equal((await tellHermes(submission,{pool:fake.pool,curator:async()=>({action:'create-calendar-event',title:'Review',calendar:'Fake',start:'2026-10-27T09:00',minutes:30,description:'',location:''})})).code,503)
})
