import {test} from 'node:test'
import assert from 'node:assert/strict'
import {refreshCoolingDown} from '../src/sync.js'

test('a queued calendar write bypasses the manual refresh cooldown',()=>{
 const now=Date.parse('2026-10-07T12:00:00.000Z')
 const recent={due:false,last_attempt:'2026-10-07T11:59:50.000Z'}
 assert.equal(refreshCoolingDown(true,30,recent,now),true)
 assert.equal(refreshCoolingDown(true,30,{...recent,due:true},now),false)
})
