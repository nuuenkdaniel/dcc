import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ACTIVE_TOOLS} from '../src/mcp/contracts.js'
import {Dispatcher} from '../src/mcp/dispatcher.js'
import {validateServiceArguments} from '../src/mcp/service-contracts.js'
import {RELIABILITY_CASES,UI_FEATURES,CAMPAIGNS} from './reliability-matrix.js'

test('reliability matrix enumerates every tool, sixty rendered feature groups and forty adversarial workflows without invented completion',()=>{
  assert.equal(ACTIVE_TOOLS.length,35)
  assert.equal(UI_FEATURES.length,60)
  assert.equal(RELIABILITY_CASES.length,265)
  assert.equal(new Set(RELIABILITY_CASES.map(c=>c.id)).size,265)
  assert.deepEqual(CAMPAIGNS.map(c=>c.seed),[20261105,20261106])
  assert.ok(RELIABILITY_CASES.every(c=>c.status==='pending'&&c.expected.length>20))
  for(const name of ACTIVE_TOOLS)assert.equal(RELIABILITY_CASES.filter(c=>'tool' in c&&c.tool===name).length,3)
})
test('all catalog entries enforce capability/unknown-field refusal without executable domain transports',async()=>{
  for(const name of ACTIVE_TOOLS){
    assert.deepEqual(await new Dispatcher().dispatch(name,{}, {purpose:'action',capabilities:[]}),{state:'rejected',code:'forbidden'})
    assert.equal(validateServiceArguments(name,{shell:'forbidden'}).valid,false,name)
  }
})
