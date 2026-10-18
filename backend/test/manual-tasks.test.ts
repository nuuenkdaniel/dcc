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

const task={id:'weekly',title:'Synthetic task',date:'2026-10-02',notes:'',completed:false}
const recurrence={version:1,kind:'template',frequency:'weekly',weekday:5,startDate:'2026-10-02',paused:false}
function memory(tasks:unknown[],version=7){
 const writes:unknown[]=[]
 const client={query:async(sql:string,args?:unknown[])=>{if(sql.startsWith('SELECT version'))return {rows:[{version,data:{tasks}}]};if(sql.startsWith('INSERT'))writes.push(args?.[1]);return {rows:[]}},release(){}}
 return {pool:{connect:async()=>client} as unknown as import('pg').Pool,writes}
}
test('strict recurrence shapes retain legacy and independent completed/deleted occurrences',()=>{
 assert.equal(validManualTask({...task,recurrence}),true)
 assert.equal(validManualTask({...task,id:'occ.weekly.2026-10-09',date:'2026-10-12',completed:true,deleted:true,recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}}),true)
 for(const value of [null,{}, {...recurrence,version:2},{...recurrence,weekday:7},{...recurrence,weekday:1.5},{...recurrence,paused:'false'},{...recurrence,startDate:'2026-02-30'},{...recurrence,extra:true},{...recurrence,frequency:'daily'},{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}])assert.equal(validManualTask({...task,recurrence:value}),false,JSON.stringify(value))
})
test('recurrence-only changes write at current version and conflict at stale version',async()=>{
 const old={...task,recurrence},next={...task,recurrence:{...recurrence,paused:true}}
 const db=memory([old]);assert.equal((await saveTasks(db.pool,7,[next])).code,200);assert.equal(db.writes.length,1)
 const stale=memory([old]);assert.equal((await saveTasks(stale.pool,6,[next])).code,409);assert.equal(stale.writes.length,0)
})
test('canonical additive metadata no-op tolerates key order and stale version',async()=>{
 const old={...task,recurrence,extension:{a:1,b:2}},db=memory([old])
 assert.deepEqual(await saveTasks(db.pool,1,[{...old,extension:{b:2,a:1}}]),{code:200,version:7})
 assert.equal(db.writes.length,0)
})
test('old-client stripping, omission and occurrence source changes cannot erase server recurrence',async()=>{
 const occurrence={...task,id:'occ.weekly.2026-10-09',completed:true,deleted:true,recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}}
 for(const [old,next] of [[{...task,recurrence},task],[occurrence,{...occurrence,recurrence:undefined}]] as const){
  const db=memory([old]);assert.notEqual((await saveTasks(db.pool,7,[next])).code,200);assert.equal(db.writes.length,0)
 }
 const db=memory([occurrence]);assert.equal((await saveTasks(db.pool,7,[])).code,409);assert.equal(db.writes.length,0)
})
test('ordinary legacy projections retain unknown fields on server and changes remain versioned',async()=>{
 const db=memory([{...task,extension:{future:true}}])
 assert.equal((await saveTasks(db.pool,7,[{...task,title:'edited'}])).code,200)
 assert.deepEqual(db.writes,[{tasks:[{...task,title:'edited',extension:{future:true}}]}])
 const stale=memory([{...task,extension:1}]);assert.equal((await saveTasks(stale.pool,6,[{...task,extension:2}])).code,409)
})
test('invalid metadata, duplicate IDs and collections above 10000 are rejected before storage',async()=>{
 const pool={connect:async()=>{throw Error('must not connect')}} as unknown as import('pg').Pool
 assert.equal((await saveTasks(pool,0,[{...task,recurrence:{...recurrence,weekday:8}}])).code,400)
 assert.equal((await saveTasks(pool,0,[task,task])).code,400)
 assert.equal((await saveTasks(pool,0,Array.from({length:10001},(_,i)=>({...task,id:`task-${i}`})))).code,400)
})
test('unknown-field retention does not change optional legacy boolean semantics',async()=>{
 const db=memory([{...task,important:true,extension:1}])
 assert.equal((await saveTasks(db.pool,7,[task])).code,200)
 assert.deepEqual(db.writes,[{tasks:[{...task,extension:1}]}])
})
test('an old client cannot physically remove an existing tombstone',async()=>{
 const db=memory([{...task,deleted:true}])
 assert.equal((await saveTasks(db.pool,7,[])).code,409)
 assert.equal(db.writes.length,0)
})
test('occurrence kind downgrade and unknown metadata edits are not no-ops',async()=>{
 const old={...task,id:'occ.weekly.2026-10-09',recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}}
 const db=memory([old]);assert.equal((await saveTasks(db.pool,7,[{...old,recurrence}])).code,409);assert.equal(db.writes.length,0)
 const changed=memory([{...task,extension:1}]);assert.equal((await saveTasks(changed.pool,7,[{...task,extension:2}])).code,200);assert.equal(changed.writes.length,1)
})
