// Synthetic retirement regressions. No real Pool, startup, .env, provider or DDL.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import type {Pool} from 'pg'
import {buildApp} from '../src/app.js'
import {checkPrices} from '../src/prices.js'
import {ACTIVE_TOOLS,TOOLS,validateArguments} from '../src/mcp/contracts.js'
import {serviceToolDefinitions,validateServiceArguments} from '../src/mcp/service-contracts.js'
import {inputSchema} from '../src/mcp/schemas.js'
import {Dispatcher} from '../src/mcp/dispatcher.js'
import {ServiceTransport} from '../src/mcp/service-transport.js'
import {readProductCache} from '../src/mcp/cache-reads.js'
import {RequestController} from '../src/mcp/request-controller.js'
import {SqlIntentStore} from '../src/mcp/intent-store.js'
import {intentAddress} from '../src/mcp/request-intent.js'
import {canonicalJson,COLLECTION} from '../src/mcp/service-transport.js'
import {createHash} from 'node:crypto'
import {IntentPool} from './mcp/intent-pool.js'
import {ServicePool} from './mcp/service-pool.js'

test('old due/unpaused rows and configuration cannot schedule checks, mutate storage or call a provider',async()=>{
  const rows={price_items:[{id:'synthetic-old',paused:false}],price_sources:[{item_id:'synthetic-old',store:'dell',next_run:'2000-01-01',status:'verified'}],price_observations:[{id:1,data:{offers:[]}}]}
  const before=structuredClone(rows);let queries=0,fetches=0
  const pool={query(){queries++;throw Error('Price retirement touched SQL')},connect(){queries++;throw Error('Price retirement opened SQL')},oldPriceConfiguration:{enabled:true}} as unknown as Pool
  const original=globalThis.fetch;globalThis.fetch=async()=>{fetches++;throw Error('Price retirement called provider')}
  try{
    assert.deepEqual(await checkPrices(pool),{retired:true});assert.deepEqual(await checkPrices(pool),{retired:true})
    const sessions=new Set<string>()
    const app=buildApp({plannerPool:pool,auth:{username:'synthetic',password:'synthetic-only',origin:'https://synthetic.invalid',store:{async put(id){sessions.add(id)},async has(id){return sessions.has(id)},async remove(id){sessions.delete(id)}}}})
    try{
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://synthetic.invalid'},payload:{username:'synthetic',password:'synthetic-only'}})
      const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value
      for(const [method,url] of [['GET','/api/v1/prices/snapshot'],['POST','/api/v1/prices/settings'],['POST','/api/v1/prices/refresh']] as const){
        const response=await app.inject({method,url,headers:{origin:'https://synthetic.invalid'},cookies:{daymark_session:cookie},...(method==='POST'?{payload:{id:'synthetic-old',paused:false,targetCents:1}}:{})})
        assert.equal(response.statusCode,410);assert.equal(response.json().retired,true);assert.match(response.json().error,/preserved/)
      }
    }finally{await app.close()}
    assert.equal(queries,0);assert.equal(fetches,0);assert.deepEqual(rows,before)
  }finally{globalThis.fetch=original}
  for(const file of ['worker.ts','server.ts']){
    const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8')
    assert.doesNotMatch(source,/\b(?:checkPrices|migratePrices)\s*\(/)
    assert.doesNotMatch(source,/from ['"]\.\/prices\.js['"]/) // No startup or worker entrypoint.
  }
})
test('35-tool schemas, strict validators and all dispatch layers refuse retired prices without SQL',async()=>{
  assert.equal(ACTIVE_TOOLS.length,35);assert.equal(ACTIVE_TOOLS.includes('list_prices'),false)
  assert.equal(serviceToolDefinitions().some(t=>t.name==='list_prices'),false)
  assert.throws(()=>inputSchema('list_prices'),/Retired/)
  assert.equal(validateArguments('list_prices',{limit:1}).valid,false)
  assert.equal(validateServiceArguments('list_prices',{limit:1}).valid,false)
  const pool={query(){throw Error('Retired read reached SQL')},connect(){throw Error('Retired read opened SQL')}} as unknown as Pool
  assert.deepEqual(await new Dispatcher().dispatch('list_prices',{limit:1},{purpose:'read',capabilities:['prices:read']}),{state:'rejected',code:'unknown_tool'})
  const transport=new ServiceTransport({pool,actorId:'synthetic'})
  assert.equal((await transport.execute({tool:'list_prices',args:{limit:1}},{purpose:'read',capabilities:['prices:read']})).state,'rejected')
  assert.deepEqual(await readProductCache(pool,{tool:'list_prices',args:{limit:1}}),{state:'rejected',code:'forbidden'})
})
test('old frozen 36-tool journals retain nonprice receipts without restarting a runtime or rendering archived prices',async()=>{
  const journal=new IntentPool(),domain=new ServicePool(),store=new SqlIntentStore(journal.pool,'synthetic'),transport=new ServiceTransport({pool:domain.pool,actorId:'synthetic'})
  const input={key:'old_product_request_01',prompt:'Synthetic old task'},policy={executor:'mcp-action-v1' as const,allowedTools:ACTIVE_TOOLS}
  const controller=new RequestController({store,transport,now:()=>1000,runner:async()=>({calls:[{id:'create',tool:'create_task',arguments:{title:'Preserved task',date:'2026-11-07',expectedVersion:0}}],done:true})})
  await controller.run(input,policy)
  const row=journal.rows.get(intentAddress(input.key).id)!
  row.data.allowedTools=[...ACTIVE_TOOLS,'list_prices'] // Exact historical persisted-policy fixture, never a new admission.
  const command={tool:'list_prices',args:{limit:1}}
  row.data.calls.push({id:'old-price-read',fingerprint:createHash('sha256').update(canonicalJson(command)).digest('hex'),command,result:{state:'ok',data:{items:[],nextOffset:null}}})
  const frozen=structuredClone(row.data.calls)
  let starts=0
  const current=new RequestController({store,transport,now:()=>1000,nativeRunner:async()=>{starts++;throw Error('Old journal restarted')}})
  for(const phase of ['completed','uncertain']){
    const persisted=journal.rows.get(row.id)!
    persisted.data.phase=phase;if(phase==='uncertain')delete persisted.data.outcome
    const result=await current.run(input,policy)
    assert.equal(result.effects.length,1);assert.equal(result.effects[0]!.state,'applied');assert.deepEqual(result.reads,[])
    assert.equal(starts,0);assert.deepEqual(journal.rows.get(row.id)!.data.calls,frozen)
    assert.equal(domain.rows.get(COLLECTION)!.data.tasks.length,1)
  }
  assert.equal(TOOLS.list_prices.write,false) // Metadata is historical decode-only, not a product capability.
})
