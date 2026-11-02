import {test} from 'node:test'
import assert from 'node:assert/strict'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {intentAddress,REQUEST_INTENT_KIND} from '../../src/mcp/request-intent.js'
import {IntentPool} from './intent-pool.js'

export const input={key:'durable_request_key_01',prompt:'Synthetic create request'}
export const policy={executor:'mcp-action-v1' as const,allowedTools:['list_tasks','create_task'] as const}
const task={title:'Synthetic item',date:'2026-11-01',expectedVersion:0}

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
