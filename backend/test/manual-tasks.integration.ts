import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import {migratePlanner,plannerSnapshot} from '../src/planner.js'
import {taskSnapshot,saveTasks} from '../src/manual-tasks.js'
process.loadEnvFile('.env')
test('shared tasks round trip, conflicts, deletion and planner isolation',async()=>{
 const root=new Pool({connectionString:process.env.DATABASE_URL});const schema='manual_test_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 try{await migratePlanner(pool);const task={id:'legacy-0.123',title:'Test',date:'2026-10-04',notes:'',completed:false}
 assert.equal((await taskSnapshot(pool)).version,0)
 assert.equal((await saveTasks(pool,0,[task])).code,200)
 assert.deepEqual((await taskSnapshot(pool)).data.tasks,[task])
 assert.equal((await saveTasks(pool,0,[{...task,title:'stale'}])).code,409)
 assert.deepEqual((await taskSnapshot(pool)).data.tasks,[task])
 assert.equal((await plannerSnapshot(pool)).actions.length,0)
 assert.equal((await saveTasks(pool,1,[])).code,200);assert.deepEqual((await taskSnapshot(pool)).data.tasks,[])
 }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end()}
})
