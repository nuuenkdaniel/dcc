import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {loadConfig} from '../src/config.js'
import {buildApp} from '../src/app.js'
import {configuredTaskActions,TASK_ACCOUNT_ACTOR} from '../src/mcp/task-actions.js'
import {IntentPool} from './mcp/intent-pool.js'
import {intentAddress} from '../src/mcp/request-intent.js'

test('task startup opt-in is OFF except for exact DCC_TASK_ACTIONS_ENABLED=1',()=>{
  for(const flag of [undefined,'','0','true','TRUE','on','1 ',' 1'])assert.equal(loadConfig(flag===undefined?{}:{DCC_TASK_ACTIONS_ENABLED:flag}).taskActionsEnabled,false)
  assert.equal(loadConfig({DCC_TASK_ACTIONS_ENABLED:'1'}).taskActionsEnabled,true)
  const base={pool:null,authConfigured:false,bridgeConfigured:false,bridge:async()=>({status:'finished'})}
  assert.equal(configuredTaskActions({...base,enabled:false}),undefined)
  assert.throws(()=>configuredTaskActions({...base,enabled:true}),/require database, authentication and curator bridge/)
  const db=new IntentPool()
  assert.throws(()=>configuredTaskActions({...base,pool:db.pool,enabled:true}),/require database/)
  assert.throws(()=>configuredTaskActions({...base,pool:db.pool,enabled:true,authConfigured:true}),/require database/)
})

test('one composed instance uses the source account actor and replays without another bridge run',async()=>{
  const db=new IntentPool();let invoked=0
  const actions=configuredTaskActions({enabled:true,pool:db.pool,authConfigured:true,bridgeConfigured:true,
    bridge:async()=>{invoked++;return {status:'finished'}}})!
  const input={key:'composed_request_key_01',prompt:'Synthetic no-effect request'}
  assert.equal((await actions.run(input)).outcome,'no_effects_recorded')
  await actions.run(input)
  assert.equal(invoked,1)
  assert.equal(db.rows.get(intentAddress(input.key).id)!.data.actorHash,createHash('sha256').update(TASK_ACCOUNT_ACTOR).digest('hex'))
  assert.equal(db.connections,0)
})

test('feature discovery is authenticated and reflects actual configured instance, not the public status or client JSON',async()=>{
  for(const enabled of [false,true]){
    const db=new IntentPool(),sessions=new Set<string>()
    const actions=configuredTaskActions({enabled,pool:db.pool,authConfigured:true,bridgeConfigured:true,bridge:async()=>({status:'finished'})})
    const app=buildApp({...(actions?{taskActions:actions}:{}),auth:{username:'test',password:'synthetic',origin:'https://dcc.invalid',store:{
      async put(id){sessions.add(id)},async has(id){return sessions.has(id)},async remove(id){sessions.delete(id)},
    }}})
    try{
      assert.equal((await app.inject('/api/v1/hermes/capabilities')).statusCode,401)
      assert.equal((await app.inject('/api/v1/status')).json().capabilities.taskActions,undefined)
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://dcc.invalid'},payload:{username:'test',password:'synthetic'}})
      const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value
      const discovery=await app.inject({url:'/api/v1/hermes/capabilities',cookies:{daymark_session:cookie}})
      assert.deepEqual(discovery.json(),{taskActions:enabled})
      assert.equal(discovery.headers['cache-control'],'no-store')
    }finally{await app.close()}
  }
})
