import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {validActionReceipt} from '../../src/mcp/action-receipt.js'
import type {Command} from '../../src/mcp/contracts.js'
import {ServicePool} from './service-pool.js'
const context={purpose:'action' as const,capabilities:['tasks:write']}
test('actual service receipts retain create/edit/status/delete fields and tombstone; no body prose',async()=>{
  const pool=new ServicePool(),transport=new ServiceTransport({pool:pool.pool,actorId:'synthetic-A'})
  const commands:Command[]=[
    {tool:'create_task',args:{operationKey:'receipt_create_key_01',id:'synthetic-task',title:'Original',date:'2026-11-07',notes:'Private notes must not enter receipt details',expectedVersion:0}},
    {tool:'update_task',args:{operationKey:'receipt_update_key_01',id:'synthetic-task',title:'Renamed',expectedVersion:1}},
    {tool:'set_task_completed',args:{operationKey:'receipt_status_key_01',id:'synthetic-task',completed:true,expectedVersion:2}},
    {tool:'remove_task',args:{operationKey:'receipt_remove_key_01',id:'synthetic-task',expectedVersion:3}},
  ]
  const details=[]
  for(const command of commands){
    const result=await transport.execute(command,context);assert.equal(result.state,'applied')
    const detail=await transport.inspect(command,result,true);assert.equal(detail.verification,'verified');details.push(detail)
  }
  assert.deepEqual(details.map(t=>t.action),['added','updated','status','deleted'])
  assert.equal(details[1]!.before!.title,'Original');assert.equal(details[1]!.after!.title,'Renamed')
  assert.equal(details[2]!.after!.completed,true);assert.equal(details[3]!.after!.deleted,true)
  assert.equal(JSON.stringify(details).includes('Private notes'),false)
  const receipt={version:1,key:'receipt_projection_key_01',outcome:'partial',line:'One distinct task changed.',verified:1,expected:null,targets:details}
  assert.equal(validActionReceipt(receipt),true)
  assert.equal(validActionReceipt({...receipt,outcome:'complete',expected:3}),false)
})
