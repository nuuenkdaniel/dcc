import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import {migratePlanner,saveEntity,plannerSnapshot,runPlanner} from '../src/planner.js'
process.loadEnvFile('.env')
test('study shares budget, follows moved exam, keeps history and pauses when event disappears',async()=>{
 const root=new Pool({connectionString:process.env.DATABASE_URL}),schema='study_test_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 try{
 await migratePlanner(pool);await pool.query('CREATE TABLE calendar_sync_state(id integer,snapshot jsonb,last_success timestamptz)')
 const event={id:'event',calendarId:'c',uid:'uid',recurrenceId:null,title:'Midterm',start:'2026-10-12',end:'2026-10-13',allDay:true}
 await pool.query('INSERT INTO calendar_sync_state VALUES(1,$1,now())',[{events:[event]}])
 const prep={id:randomUUID(),title:'Test midterm',event,startDate:'2026-10-05',status:'active',topics:[{id:'topic',title:'Recall and practice',notes:'Verified source',minutes:90}],progress:''}
 assert.equal((await saveEntity(pool,'preparation',0,prep)).code,200)
 const generate=async(input:any)=>{assert.ok(input.futureAvailability.length);const p=input.projects[0];return {actions:p?[{projectId:p.id,title:'Practice recall',notes:'Do one problem',minutes:30}]:[],summary:'One study block'}}
 assert.equal(await runPlanner(pool,generate,true,new Date('2026-10-05T10:00:00Z')),'generated')
 let snap=await plannerSnapshot(pool);assert.equal(snap.actions[0]!.data.preparationId,prep.id)
 const first=snap.actions[0]!;await saveEntity(pool,'action',first.version,{...first.data,completed:true,feedback:'review'})
 await pool.query('UPDATE calendar_sync_state SET snapshot=$1',[{events:[{...event,id:'moved',start:'2026-10-15',end:'2026-10-16'}]}])
 assert.equal(await runPlanner(pool,async(input:any)=>{assert.equal(input.projects[0].deadline,'2026-10-15');return generate(input)},true,new Date('2026-10-06T10:00:00Z')),'generated')
 snap=await plannerSnapshot(pool);assert.equal(snap.actions.length,2);assert.equal(snap.actions.find(a=>a.data.id===first.data.id)!.data.completed,true)
 await pool.query('UPDATE calendar_sync_state SET snapshot=$1',[{events:[]}])
 assert.equal(await runPlanner(pool,async()=>{throw Error('must not call without event')},true,new Date('2026-10-07T10:00:00Z')),'generated')
 assert.equal((await plannerSnapshot(pool)).actions.length,2)
 }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end()}
})
