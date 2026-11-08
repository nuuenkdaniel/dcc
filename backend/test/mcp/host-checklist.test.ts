// Query-contract fixtures only. Real PostgreSQL proof is opt-in in
// checklist-persistence.integration.ts; these tests never access a database.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RequestController} from '../../src/mcp/request-controller.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {projectConversationReceipt} from '../../src/mcp/conversation.js'
import {ACTIVE_TOOLS} from '../../src/mcp/contracts.js'
import {IntentPool} from './intent-pool.js'
import {ServicePool} from './service-pool.js'

const policy={executor:'mcp-action-v1' as const,allowedTools:ACTIVE_TOOLS}
function fixture(count:number){
  const journal=new IntentPool(),domain=new ServicePool(),store=new SqlIntentStore(journal.pool,'checklist-fixture')
  const transport=new ServiceTransport({pool:domain.pool,actorId:'checklist-fixture'})
  let bridges=0
  const controller=new RequestController({store,transport,now:()=>1000,nativeRunner:async()=>{bridges++;throw Error('External channel unavailable before completion')}})
  const tasks=Array.from({length:count},(_,i)=>({title:`Synthetic café 界 ${i+1}`,date:i%2?'2026-11-08':'2026-11-07'}))
  const input={key:`host_checklist_case_0${count}`,prompt:'Host-resolved immutable checklist',guard:{version:1 as const,binding:'a'.repeat(64),checklist:{version:1 as const,kind:'create_tasks' as const,tasks}}}
  return {journal,domain,store,transport,controller,input,tasks,bridges:()=>bridges}
}
test('host checklist completes three guarded writes without invoking the external native runner',async()=>{
  const h=fixture(3)
  assert.equal((await h.controller.run(h.input,policy)).phase,'completed')
  assert.equal(h.bridges(),0)
  assert.deepEqual(h.domain.rows.get(COLLECTION)!.data.tasks.map((t:{title:string;date:string})=>({title:t.title,date:t.date})),h.tasks)
  const record=await h.store.read(h.input.key),receipt=await projectConversationReceipt(record,h.transport)
  assert.equal(record.rounds,1);assert.equal(record.calls.length,6)
  assert.equal(receipt.outcome,'complete');assert.equal(receipt.verified,3)
  await h.controller.run(h.input,policy)
  assert.equal(h.domain.rows.get(COLLECTION)!.version,3);assert.equal(h.bridges(),0)
})
test('one and four host goals read actual versions rather than consuming one model round per goal',async()=>{
  for(const count of [1,4]){
    const h=fixture(count)
    const execute=h.transport.execute.bind(h.transport)
    h.transport.execute=async(command,context)=>{
      const result=await execute(command,context)
      // Simulate unrelated version-only maintenance after a successful write.
      // The next create must use a fresh authoritative collection read.
      if(command.tool==='create_task'&&result.state==='applied')h.domain.rows.get(COLLECTION)!.version+=2
      return result
    }
    assert.equal((await h.controller.run(h.input,policy)).phase,'completed')
    const record=await h.store.read(h.input.key)
    assert.deepEqual(record.calls.filter(c=>c.command.tool==='create_task').map(c=>c.command.args.expectedVersion),Array.from({length:count},(_,i)=>i*3))
    assert.equal(record.rounds,1);assert.equal(record.calls.length,count*2);assert.equal(h.bridges(),0)
  }
})
test('unbound, mixed, clarification and generic guards retain the external path',async()=>{
  for(const guard of [undefined,{version:1 as const,questionOnly:true as const,questionReason:'task_topics'},
    {...fixture(1).input.guard,readOnly:true as const},
    {version:1 as const,checklist:fixture(1).input.guard.checklist}]){
    const h=fixture(1)
    const {guard:_guard,...base}=h.input
    await h.controller.run({...base,...(guard?{guard}:{})},policy)
    assert.equal(h.bridges(),1);assert.equal(h.domain.rows.size,0)
  }
})
test('an already reserved bound checklist is receipts-only, never a fresh host sequence',async()=>{
  const h=fixture(3)
  await h.store.admit({...h.input,purpose:'action'},policy)
  const owner=(await h.store.start(h.input.key,1000)).owner!
  await h.store.round(h.input.key,owner,1000)
  await h.store.reserve(h.input.key,owner,'old_native_write','create_task',{...h.tasks[0],expectedVersion:0},1000)
  const result=await h.controller.run(h.input,policy)
  assert.equal(result.phase,'uncertain');assert.equal(result.pending,1)
  assert.equal((await h.store.read(h.input.key)).calls.length,1)
  assert.equal(h.bridges(),0);assert.equal(h.domain.rows.size,0)
})
