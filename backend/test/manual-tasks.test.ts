import {test} from 'node:test'
import assert from 'node:assert/strict'
import {saveTasks,validManualTask} from '../src/manual-tasks.js'
import {buildApp} from '../src/app.js'
test('manual task validation preserves legacy IDs, accepts optional tombstones and rejects impossible dates',()=>{const t={id:'179100-0.12345',title:'Study',date:'2026-10-04',notes:'',completed:false};assert.equal(validManualTask(t),true);assert.equal(validManualTask({...t,deleted:true}),true);assert.equal(validManualTask({...t,date:'2026-02-30'}),false);assert.equal(validManualTask({...t,title:''}),false)})
test('manual task routes are authenticated',async()=>{const app=buildApp({plannerPool:{query:async()=>{throw Error('Must not query unauthenticated')}} as unknown as import('pg').Pool});try{assert.equal((await app.inject('/api/v1/planner/manual-tasks')).statusCode,401)}finally{await app.close()}})
test('identical manual tasks are a safe no-op even with a stale submitted version',async()=>{
 const tasks=[{id:'task-1',title:'Study',date:'2026-10-04',notes:'',completed:false}]
 const statements:string[]=[]
 const client={query:async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT version'))return {rows:[{version:7,data:{tasks}}]};return {rows:[]}},release(){}}
 const pool={connect:async()=>client} as unknown as import('pg').Pool
 const result=await saveTasks(pool,3,tasks)
 assert.deepEqual(result,{code:200,version:7})
 assert.equal(statements.some(sql=>sql.startsWith('INSERT INTO planner_entities')),false)
})
