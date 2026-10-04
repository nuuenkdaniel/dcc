import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import {migratePlanner,plannerSnapshot,saveEntity,runPlanner} from '../src/planner.js'
process.loadEnvFile('.env')
test('projects, optimistic conflict, generation and completed actions survive refresh and failure',async()=>{
 const root=new Pool({connectionString:process.env.DATABASE_URL});const schema='planner_test_'+randomUUID().replaceAll('-','')
 await root.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 try{
 await migratePlanner(pool)
 await pool.query("CREATE TABLE calendar_sync_state(id integer,snapshot jsonb,last_success timestamptz); INSERT INTO calendar_sync_state VALUES(1,'{\"events\":[]}',now())")
 const p={id:randomUUID(),title:'Daymark isolated test project',category:'school',description:'Read a chapter',deadline:'2026-10-08',importance:2,remainingMinutes:60,progress:'',status:'active'}
 assert.equal((await saveEntity(pool,'project',0,p)).code,200)
 assert.equal((await saveEntity(pool,'project',0,{...p,title:'Stale edit'})).code,409)
 const now=new Date('2026-10-05T10:00:00Z')
 assert.equal(await runPlanner(pool,async()=>{throw Error('must not run before 6 AM')},false,new Date('2026-10-05T09:59:00Z')),'not-due')
 await runPlanner(pool,async()=>({actions:[{projectId:p.id,title:'Read the first chapter',notes:'Take notes',minutes:30}],summary:'Start with the nearest deadline.'}),true,now)
 let snap=await plannerSnapshot(pool)
 assert.equal(snap.actions.length,1)
 assert.equal(await runPlanner(pool,async()=>{throw Error('already generated')},false,now),'not-due')
 const action=snap.actions[0]!
 assert.equal((await saveEntity(pool,'action',action.version,{...action.data,completed:true})).code,200)
 await runPlanner(pool,async()=>({actions:[],summary:'Already planned'}),true,now)
 snap=await plannerSnapshot(pool);assert.equal(snap.actions.length,1);assert.equal(snap.actions[0]!.data.completed,true)
 assert.equal(snap.projects[0]!.data.status,'active')
 await runPlanner(pool,async()=>{throw new Error('offline')},true,new Date('2026-10-06T10:00:00Z'))
 assert.equal((await plannerSnapshot(pool)).actions.length,1)
 }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end()}
})
