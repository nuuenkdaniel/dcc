import {test} from 'node:test'
import assert from 'node:assert/strict'
import {CLARIFICATION_QUESTIONS,clarification} from '../../src/mcp/clarification.js'
import {validateServiceArguments,validServiceResult} from '../../src/mcp/service-contracts.js'
import {Dispatcher} from '../../src/mcp/dispatcher.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {ServicePool} from './service-pool.js'
test('every clarification reason is bounded, exact, read-only and needs its own capability',async()=>{
  const pool=new ServicePool(),dispatcher=new Dispatcher(new ServiceTransport({pool:pool.pool,actorId:'synthetic'}))
  for(const reason of Object.keys(CLARIFICATION_QUESTIONS) as (keyof typeof CLARIFICATION_QUESTIONS)[]){
    const command={tool:'request_clarification' as const,args:{reason}}
    const result=await dispatcher.dispatch(command.tool,command.args,{purpose:'action',capabilities:['clarification:request']})
    assert.deepEqual(result,{state:'ok',data:clarification(reason)})
    assert.equal(validServiceResult(command,result),true)
    assert.equal(validServiceResult(command,{state:'ok',data:{reason,question:'Created everything!'}}),false)
    assert.equal(validServiceResult(command,{state:'applied',id:'invented',version:1}),false)
    assert.deepEqual(await dispatcher.dispatch(command.tool,command.args,{purpose:'action',capabilities:[]}),{state:'rejected',code:'forbidden'})
  }
  for(const input of [{reason:'anything'},{reason:'missing_duration',question:'I applied it'},{reason:['missing_duration']},{}])assert.equal(validateServiceArguments('request_clarification',input).valid,false)
  assert.equal(pool.rows.size,0)
})
