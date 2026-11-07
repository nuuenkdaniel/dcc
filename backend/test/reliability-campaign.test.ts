import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runSourceCampaign} from './run-reliability-campaign.js'
for(const seed of [20261105,20261106])test(`finite source reliability campaign ${seed}`,async()=>{
  const result=await runSourceCampaign(seed)
  assert.equal(result.timer.operations,256)
  assert.equal(result.observations.filter(o=>o.scenario.endsWith('.refusal')).length,35)
  assert.equal(result.pendingInventoryCases,265)
  assert.ok(result.notProven.includes('real PostgreSQL'))
})
