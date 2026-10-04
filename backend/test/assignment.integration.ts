import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import {migratePlanner} from '../src/planner.js'
import {planAssignments} from '../src/assignment-plan.js'
process.loadEnvFile('.env')
test('assignment gets future steps despite zero capacity today; repeated runs preserve IDs',async()=>{
 const root=new Pool({connectionString:process.env.DATABASE_URL}),schema='assignment_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 try{await migratePlanner(pool);await pool.query('CREATE TABLE calendar_sync_state(snapshot jsonb,last_success timestamptz,id integer)');const date=new Date().toISOString().slice(0,10),tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);await pool.query('INSERT INTO calendar_sync_state VALUES($1,now(),1)',[{events:[{start:date,end:tomorrow,allDay:true}]}]);const id=randomUUID();await pool.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'project',$2)",[id,{id,kind:'assignment',title:'Test',status:'active',deadline:new Date(Date.now()+7*86400000).toISOString().slice(0,10)}]);const model=async()=>({steps:[{title:'Implement',notes:'Check output',minutes:60},{title:'Submit',notes:'Verify submission',minutes:30}],summary:'Estimated 90 minutes'});await planAssignments(pool,model);let rows=(await pool.query("SELECT id,data FROM planner_entities WHERE kind='action' ORDER BY id")).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.data.date>date));const ids=rows.map(r=>r.id);await planAssignments(pool,async()=>{throw Error('must not regenerate')});rows=(await pool.query("SELECT id,data FROM planner_entities WHERE kind='action' ORDER BY id")).rows;assert.deepEqual(rows.map(r=>r.id),ids)}finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end()}
})
