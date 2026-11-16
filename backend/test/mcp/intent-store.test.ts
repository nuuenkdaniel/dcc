import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {intentAddress,REQUEST_INTENT_KIND} from '../../src/mcp/request-intent.js'
import {IntentPool} from './intent-pool.js'

export const input={key:'durable_request_key_01',prompt:'Synthetic create request'}
export const policy={executor:'mcp-action-v1' as const,allowedTools:['list_tasks','create_task'] as const}
const task={title:'Synthetic item',date:'2026-11-01',expectedVersion:0}

test('caller-owned cancellation preserves frozen policy and validates binding without execution or nested checkout',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  const guard={version:1 as const,binding:'a'.repeat(64),chatVersion:1 as const}
  const admission={...input,purpose:'action' as const,guard}
  const original=await store.admit(admission,policy)
  const broader={...policy,allowedTools:[...policy.allowedTools,'request_clarification' as const]}
  const c=await db.pool.connect(),connect=db.connect
  try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817350))',['synthetic-chat-slot'])
    db.connect=async()=>{throw Error('No second checkout')}
    await assert.rejects(store.fenceInTransaction(c,{...input,guard:{...guard,binding:'b'.repeat(64)}},broader,1000),/intent_conflict/)
    const start=db.statements.length
    const fenced=await store.fenceInTransaction(c,{...input,guard},broader,1000)
    assert.equal(fenced.phase,'uncertain');assert.deepEqual(fenced.allowedTools,original.allowedTools)
    assert.deepEqual(fenced.guard,guard);assert.deepEqual(fenced.calls,[])
    assert.equal(db.connections,1)
    assert.ok(db.statements.slice(start).every(s=>!['BEGIN','COMMIT','ROLLBACK'].includes(s.sql)))
    await c.query('COMMIT')
  }finally{db.connect=connect;await c.query('ROLLBACK');c.release()}
  const saved=await store.read(input.key)
  assert.equal(saved.phase,'uncertain');assert.deepEqual(saved.allowedTools,original.allowedTools)
  assert.equal((await store.start(input.key,1001)).directive,'receipts_only')
  assert.equal(db.connections,0)
})

test('transaction-owned journal read uses one checkout and leaves commit and release to the caller',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  await store.admit({...input,purpose:'action'},policy)
  const claim=await store.start(input.key,1000);assert.ok(claim.owner)
  await store.round(input.key,claim.owner,1001);await store.finish(input.key,claim.owner)
  const expected=await store.read(input.key),address=intentAddress(input.key)
  assert.equal(expected.phase,'completed')
  const c=await db.pool.connect(),connect=db.connect
  try{
    await c.query('BEGIN')
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817350))',['synthetic-conversation-slot'])
    await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',['synthetic-caller-marker','synthetic-marker',{value:true}])
    db.connect=async()=>{throw Error('A caller-owned read must not check out another connection')}
    const start=db.statements.length
    assert.deepEqual(await store.readInTransaction(c,input.key),expected)
    assert.equal(db.connections,1,'The read must not release the caller connection')
    assert.deepEqual(db.statements.slice(start),[
      {sql:'SELECT pg_advisory_xact_lock(hashtextextended($1,817343))',args:[address.legacyReceiptId]},
      {sql:'SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',args:[address.legacyReceiptId]},
      {sql:'SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',args:[address.id]}
    ])
    assert.equal(db.rows.has('synthetic-caller-marker'),false,'The read must not commit the caller transaction')
    await c.query('COMMIT')
    assert.equal(db.rows.has('synthetic-caller-marker'),true,'The read must not roll back the caller transaction')
  }finally{db.connect=connect;await c.query('ROLLBACK');c.release()}
  assert.equal(db.connections,0)
  assert.deepEqual(await store.read(input.key),expected,'The ordinary read API is unchanged')
})

test('transaction-owned reads retain actor, journal codec and legacy fence refusal without owning rollback',async()=>{
  for(const mode of ['missing','actor','version','command','legacy-missing','legacy-mismatch'] as const){
    const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A'),address=intentAddress(input.key)
    await store.admit({...input,purpose:'action'},policy)
    if(mode==='missing')db.rows.delete(address.id)
    else if(mode==='version')db.rows.get(address.id)!.data.version=2
    else if(mode==='command')db.rows.get(address.id)!.data.calls=[{id:'bad',command:{tool:'create_task',args:task},fingerprint:'bad'}]
    else if(mode==='legacy-missing')db.rows.delete(address.legacyReceiptId)
    else if(mode==='legacy-mismatch')db.rows.get(address.legacyReceiptId)!.data.fingerprint='0'.repeat(64)
    const reader=mode==='actor'?new SqlIntentStore(db.pool,'actor-B'):store
    const before=structuredClone([...db.rows.values()]),c=await db.pool.connect(),connect=db.connect
    try{
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817350))',['synthetic-conversation-slot'])
      db.connect=async()=>{throw Error('No second checkout')}
      const start=db.statements.length
      await assert.rejects(reader.readInTransaction(c,input.key),/intent_conflict|executor_conflict/,mode)
      assert.equal(db.connections,1,mode)
      const queries=db.statements.slice(start)
      assert.equal(queries.length,3,mode)
      assert.equal(queries[0]!.sql,'SELECT pg_advisory_xact_lock(hashtextextended($1,817343))',mode)
      assert.equal(queries[1]!.args[0],address.legacyReceiptId,mode)
      assert.equal(queries[2]!.args[0],address.id,mode)
      assert.deepEqual([...db.rows.values()],before,mode)
      await c.query('ROLLBACK')
    }finally{db.connect=connect;c.release()}
    assert.equal(db.connections,0,mode)
  }
})

test('two SQL adapters admit one intent/sentinel and atomically choose only one execution owner',async()=>{
  const db=new IntentPool(),a=new SqlIntentStore(db.pool,'actor-A'),b=new SqlIntentStore(db.pool,'actor-A')
  const admitted=await Promise.all([a.admit({...input,purpose:'action'},policy),b.admit({...input,purpose:'action'},{executor:'legacy-parser-v1',allowedTools:[]})])
  assert.equal(admitted[0].executor,'mcp-action-v1');assert.deepEqual(admitted[0],admitted[1])
  assert.equal(db.rows.size,2)
  const firstQueries=db.statements.slice(0,4)
  assert.equal(firstQueries[1]!.sql,'SELECT pg_advisory_xact_lock(hashtextextended($1,817343))')
  assert.equal(firstQueries[2]!.args[0],intentAddress(input.key).legacyReceiptId)
  assert.equal(firstQueries[3]!.args[0],intentAddress(input.key).id)
  assert.ok(!JSON.stringify([...db.rows.values()]).includes(input.prompt))
  const starts=await Promise.all([a.start(input.key,1000),b.start(input.key,1000)])
  assert.equal(starts.filter(s=>s.owner).length,1)
  assert.deepEqual(starts.map(s=>s.directive),['start_model','receipts_only'])
  const owner=starts[0].owner!
  await a.round(input.key,owner,1001)
  await assert.rejects(b.reserve(input.key,'model-owner','call1','create_task',task,1002),/forbidden/)
  const reserved=await a.reserve(input.key,owner,'call1','create_task',task,1002)
  assert.equal(reserved.directive,'dispatch')
  assert.equal((await b.reserve(input.key,owner,'call1','create_task',task,1003)).directive,'reconcile')
  await a.interrupt(input.key)
  await assert.rejects(a.reserve(input.key,owner,'new-call','create_task',task,1004),/inactive/)
  await a.result(input.key,owner,'call1',{state:'applied',id:String(reserved.command!.args.id),version:1})
  assert.equal((await b.read(input.key)).calls[0].result?.state,'applied','late receipt survives interruption')
  assert.equal((await b.start(input.key,1005)).directive,'receipts_only')
  assert.equal(db.connections,0)
})

test('wrong actor/prompt, journal version and legacy fence collisions fail closed',async()=>{
  const db=new IntentPool(),a=new SqlIntentStore(db.pool,'actor-A')
  await a.admit({...input,purpose:'action'},policy)
  await assert.rejects(new SqlIntentStore(db.pool,'actor-B').admit({...input,purpose:'action'},policy),/intent_conflict/)
  await assert.rejects(a.admit({...input,prompt:'Different',purpose:'action'},policy),/intent_conflict/)
  const row=db.rows.get(intentAddress(input.key).id)!
  row.data.version=2
  await assert.rejects(a.read(input.key),/intent_conflict/)
  row.data.version=1;row.data.calls=[{id:'bad',command:{tool:'create_task',args:task},fingerprint:'bad'}]
  await assert.rejects(a.read(input.key),/intent_conflict/)
  row.data.calls=[]
  const fence=db.rows.get(intentAddress(input.key).legacyReceiptId)!
  const result=fence.data.result
  delete fence.data.result
  await assert.rejects(a.read(input.key),/executor_conflict/)
  fence.data.result=result
  db.rows.delete(row.id)
  await assert.rejects(a.admit({...input,purpose:'action'},policy),/executor_conflict/)
})

test('a legacy receipt committed under the shared legacy lock wins against a waiting MCP admission',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  const seed=new IntentPool(),r=await new SqlIntentStore(seed.pool,'actor-A').admit({...input,purpose:'action'},policy)
  const c=await db.pool.connect(),id=r.legacyReceiptId
  try{
    await c.query('BEGIN')
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817343))',[id])
    await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[id,'hermes-command',{fingerprint:r.promptHash,command:{action:'rejected'},targetId:'synthetic',result:{code:422,message:'Synthetic legacy rejection'}}])
    const waiting=store.admit({...input,purpose:'action'},policy)
    await c.query('COMMIT')
    assert.equal((await waiting).executor,'legacy-parser-v1')
    assert.equal(db.rows.get(id)!.data._dccIntent,undefined)
  }finally{c.release()}
  assert.equal(db.connections,0)
})

test('real legacy receipt remains untouched; pending and complete legacy selection never becomes MCP',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  const {legacyReceiptId}=intentAddress(input.key)
  // Obtain the exact hash from a separate synthetic admission.
  const seed=new IntentPool(),record=await new SqlIntentStore(seed.pool,'actor-A').admit({...input,purpose:'action'},policy)
  const data={fingerprint:record.promptHash,command:{action:'rejected'},targetId:'synthetic'}
  db.seed({id:legacyReceiptId,kind:'hermes-command',version:3,data})
  assert.equal((await store.admit({...input,purpose:'action'},policy)).executor,'legacy-parser-v1')
  assert.deepEqual(db.rows.get(legacyReceiptId)?.data,data)
  db.rows.get(legacyReceiptId)!.data.result={code:422,message:'Synthetic legacy result'}
  const completed=await store.admit({...input,purpose:'action'},policy)
  assert.equal(completed.phase,'completed');assert.equal(completed.outcome,'legacy_receipt')
  assert.equal(db.rows.get(legacyReceiptId)!.version,3)
})

test('zero sentinel insert rolls back both rows; zero update and ambiguous commit cannot start a second model',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  db.zeroInsertAt=2
  await assert.rejects(store.admit({...input,purpose:'action'},policy),/storage_conflict/)
  assert.equal(db.rows.size,0)
  db.zeroInsertAt=undefined
  await store.admit({...input,purpose:'action'},policy)
  db.zero='entity-update'
  await assert.rejects(store.start(input.key,1000),/storage_conflict/)
  assert.equal((await store.read(input.key)).phase,'admitted')
  db.fail='commit-after'
  await assert.rejects(store.start(input.key,1000),/storage_failure/)
  assert.equal((await store.start(input.key,1001)).directive,'receipts_only')
  assert.equal(db.rows.get(intentAddress(input.key).id)?.kind,REQUEST_INTENT_KIND)
  assert.equal(db.connections,0)
})

test('before-commit failure preserves admission and no execution directive escapes',async()=>{
  const db=new IntentPool(),store=new SqlIntentStore(db.pool,'actor-A')
  db.fail='commit-before'
  await assert.rejects(store.admit({...input,purpose:'action'},policy),/storage_failure/)
  assert.equal(db.rows.size,0);assert.equal(db.connections,0)
})
