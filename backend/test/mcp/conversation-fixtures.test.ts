// One shared JSON asset consumed by web/native tests. These service-query fakes
// establish projection compatibility, NOT PostgreSQL or installed-model evidence.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {validConversationView} from '../../src/mcp/conversation-wire.js'
import {clarification} from '../../src/mcp/clarification.js'
import {interpretTasks} from '../../src/mcp/conversation-contract.js'
import {projectConversationReceipt} from '../../src/mcp/conversation.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import type {Command} from '../../src/mcp/contracts.js'
import {ServicePool} from './service-pool.js'
import {IntentPool} from './intent-pool.js'
test('shared Android asset equals actual backend receipt projection over synthetic persisted tasks',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../../../frontend-android/app/src/androidTest/assets/hermes-conversation.json',import.meta.url),'utf8'))
  assert.ok(validConversationView(fixture.question));assert.ok(validConversationView(fixture.complete))
  assert.deepEqual({reason:fixture.question.question.reason,question:fixture.question.question.question},clarification('task_topics'))
  const expected=interpretTasks(fixture.question.original,['Lectures, practice problems, and review'],'2026-11-07')
  assert.equal(expected.kind,'checklist');if(expected.kind!=='checklist')throw Error('Fixture interpretation')
  const domain=new ServicePool(),journal=new IntentPool(),transport=new ServiceTransport({pool:domain.pool,actorId:'fixture-actor'})
  const record=await new SqlIntentStore(journal.pool,'fixture-actor').admit({key:fixture.complete.turnKey,prompt:'Synthetic projection fixture',purpose:'action',guard:{version:1,checklist:expected.checklist}},{executor:'mcp-action-v1',allowedTools:['create_task']})
  for(const [i,target] of fixture.complete.receipt.targets.entries()){
    const command:Command={tool:'create_task',args:{operationKey:`fixture_operation_0${i}`,id:target.id,title:target.title,date:target.date,expectedVersion:i}}
    const result=await transport.execute(command,{purpose:'action',capabilities:['tasks:write']})
    assert.equal(result.state,'applied');record.calls.push({id:`fixture${i}`,fingerprint:'projection-only',command,result})
  }
  record.phase='completed';record.outcome='effects_recorded'
  assert.deepEqual(await projectConversationReceipt(record,transport),fixture.complete.receipt)
})
