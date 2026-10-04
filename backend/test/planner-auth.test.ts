import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildApp} from '../src/app.js'
test('planner data and generation require a session',async()=>{const app=buildApp();try{assert.equal((await app.inject('/api/v1/planner/snapshot')).statusCode,401)}finally{await app.close()}})
