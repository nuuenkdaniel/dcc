import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BrowserTimerBridge} from '../../src/mcp/browser-timer.js'
import {validateServiceArguments} from '../../src/mcp/service-contracts.js'
import type {Command} from '../../src/mcp/contracts.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {ServicePool} from './service-pool.js'
import {applyTimerCommand,freshTimer} from '../../../frontend/src/timerState.js'

const tabId='12345678-1234-4234-a234-123456789abc',key='synthetic_timer_intent_01'
const command:Command={tool:'control_focus_timer',args:{id:tabId,operationKey:'dcc_op_12345678-1234-4234-a234-123456789abc',expectedVersion:1,action:'start'}}
const context={purpose:'action' as const,capabilities:['timer:write'],browserTabId:tabId,invocationKey:key}
test('timer effects await exact originating browser ack; wrong tab/nonce/payload and replay are fenced',async()=>{
  const bridge=new BrowserTimerBridge(()=>1000,10000)
  const pending=bridge.execute(command,context)
  assert.equal(bridge.reconcile(command),undefined)
  assert.deepEqual(bridge.poll(key,'other-tab'),[])
  const entry=bridge.poll(key,tabId)[0]!
  const result={state:'applied',id:tabId,version:2}
  assert.equal(bridge.ack(key,'other-tab',{nonce:entry.nonce,result}),false)
  assert.equal(bridge.ack(key,tabId,{nonce:'f'.repeat(64),result}),false)
  assert.equal(bridge.ack(key,tabId,{nonce:entry.nonce,result:{...result,id:'wrong'}}),false)
  assert.equal(bridge.ack(key,tabId,{nonce:entry.nonce,result}),true)
  assert.deepEqual(await pending,result)
  assert.deepEqual(await bridge.execute(command,context),result)
  assert.equal(bridge.poll(key,tabId).length,0)
  assert.equal((await bridge.execute({...command,args:{...command.args,action:'reset'}},context)).state,'conflict')
  assert.equal(new BrowserTimerBridge().reconcile(command),undefined)
})
test('missing/expired browser cannot claim applied; timer schemas reject generic commands and invented settings',async()=>{
  const bridge=new BrowserTimerBridge(()=>1000,1)
  assert.equal((await bridge.execute(command,{purpose:'action',capabilities:['timer:write']})).state,'rejected')
  assert.equal((await bridge.execute(command,context)).state,'uncertain')
  assert.equal(validateServiceArguments('control_focus_timer',command.args).valid,true)
  for(const extra of [{action:'javascript',source:'alert(1)'},{action:'pause',focusMinutes:25},{action:'configure'},{action:'start',tabId}])assert.equal(validateServiceArguments('control_focus_timer',{...command.args,...extra}).valid,false)
})
test('browser-acknowledged timer operation has durable service receipt and restart replay never dispatches again',async()=>{
  const pool=new ServicePool(),bridge=new BrowserTimerBridge()
  const service=new ServiceTransport({pool:pool.pool,actorId:'synthetic',browserTimer:bridge})
  const pending=service.execute(command,context)
  await new Promise<void>(resolve=>setImmediate(resolve))
  const entry=bridge.poll(key,tabId)[0]!
  assert.ok(entry)
  const result={state:'applied',id:tabId,version:2}
  assert.equal(bridge.ack(key,tabId,{nonce:entry.nonce,result}),true)
  assert.deepEqual(await pending,result)
  const restartedBridge=new BrowserTimerBridge()
  const restarted=new ServiceTransport({pool:pool.pool,actorId:'synthetic',browserTimer:restartedBridge})
  assert.deepEqual(await restarted.execute(command,context),result)
  assert.equal(restartedBridge.poll(key,tabId).length,0)
  assert.deepEqual(await restarted.execute({...command,args:{...command.args,expectedVersion:2,action:'reset'}},context),{state:'conflict',code:'operation_key_mismatch'})
  assert.equal(restartedBridge.poll(key,tabId).length,0)
  assert.deepEqual(await restarted.execute({tool:'get_operation_status',args:{operationKey:command.args.operationKey!}},{purpose:'read',capabilities:['operations:read']}),{state:'ok',data:{operationKey:command.args.operationKey,status:'applied'}})
})
test('lost browser ACK and backend restart reconcile through a fresh receipt-only nonce without reexecution',async()=>{
  const pool=new ServicePool(),originalBridge=new BrowserTimerBridge(()=>1000,1)
  const original=new ServiceTransport({pool:pool.pool,actorId:'synthetic',browserTimer:originalBridge})
  const pending=original.execute(command,context)
  await new Promise<void>(resolve=>setImmediate(resolve))
  const delivered=originalBridge.poll(key,tabId)[0]!
  assert.ok(delivered)
  const browser=applyTimerCommand(freshTimer(1000),delivered.command,1000)
  assert.equal(browser.result.state,'applied') // Applied locally; deliberately drop ACK.
  assert.equal((await pending).state,'uncertain')
  const bridge=new BrowserTimerBridge(()=>2000,10000)
  const restarted=new ServiceTransport({pool:pool.pool,actorId:'synthetic',browserTimer:bridge})
  const recovering=restarted.reconcile(command,context)
  await new Promise<void>(resolve=>setImmediate(resolve))
  const challenge=bridge.poll(key,tabId)[0]!
  assert.equal(challenge.recoverOnly,true);assert.notEqual(challenge.nonce,delivered.nonce)
  const restored=JSON.parse(JSON.stringify(browser.document))
  const proof=applyTimerCommand(restored,challenge.command,2000,challenge.recoverOnly)
  assert.equal(proof.document,restored);assert.deepEqual(proof.result,browser.result)
  assert.equal(bridge.ack(key,'wrong-tab',{nonce:challenge.nonce,result:proof.result}),false)
  assert.equal(bridge.ack(key,tabId,{nonce:challenge.nonce,result:proof.result}),true)
  assert.deepEqual(await recovering,browser.result)
  assert.deepEqual(await restarted.execute(command,context),browser.result)
  assert.equal(bridge.poll(key,tabId).length,0)
})
test('recovery for a reserved but unapplied operation stays uncertain and never starts the browser timer',async()=>{
  const bridge=new BrowserTimerBridge(()=>1000,10000)
  const pending=bridge.recover(command,context)
  const challenge=bridge.poll(key,tabId)[0]!
  const browser=freshTimer(1000)
  const proof=applyTimerCommand(browser,challenge.command,1000,challenge.recoverOnly)
  assert.equal(proof.document,browser);assert.equal(browser.timer.running,false)
  assert.equal(bridge.ack(key,tabId,{nonce:challenge.nonce,result:{state:'rejected',code:'forbidden'}}),false)
  assert.equal(bridge.ack(key,tabId,{nonce:challenge.nonce,result:proof.result}),true)
  assert.deepEqual(await pending,{state:'uncertain',operationKey:command.args.operationKey})
})
