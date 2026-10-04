import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validManualTask} from '../src/manual-tasks.js'
import {buildApp} from '../src/app.js'
test('manual task validation preserves legacy IDs and rejects impossible dates',()=>{const t={id:'179100-0.12345',title:'Study',date:'2026-10-04',notes:'',completed:false};assert.equal(validManualTask(t),true);assert.equal(validManualTask({...t,date:'2026-02-30'}),false);assert.equal(validManualTask({...t,title:''}),false)})
test('manual task routes are authenticated',async()=>{const app=buildApp({plannerPool:{query:async()=>{throw Error('Must not query unauthenticated')}} as unknown as import('pg').Pool});try{assert.equal((await app.inject('/api/v1/planner/manual-tasks')).statusCode,401)}finally{await app.close()}})
