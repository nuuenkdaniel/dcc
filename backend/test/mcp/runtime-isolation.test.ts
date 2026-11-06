import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {Pool} from 'pg'
import {validateRuntimeIsolation,type RuntimeIsolation} from './authenticated-runtime-fixture.js'
const metadata:RuntimeIsolation={database:{host:'127.0.0.1',port:15432,name:'dcc_qa_synthetic',disposable:true},syntheticDataOnly:true,model:'gpt-6-luna',modelInvocationApproved:true,calendar:'none',calendarOrigins:[]}
const pool={options:{host:'127.0.0.1',port:15432,database:'dcc_qa_synthetic'},query:()=>{throw Error('Must not connect')}} as unknown as Pool
test('inert runtime isolation checks reject mismatched/default/remote targets before any DB call',()=>{
  assert.doesNotThrow(()=>validateRuntimeIsolation(pool,metadata))
  for(const db of [{...metadata.database,name:'production'},{...metadata.database,port:5432},{...metadata.database,host:'remote.invalid'}])assert.throws(()=>validateRuntimeIsolation(pool,{...metadata,database:db} as RuntimeIsolation))
  assert.throws(()=>validateRuntimeIsolation(pool,{...metadata,calendar:'synthetic-loopback',calendarOrigins:['https://calendar.invalid']}))
  assert.throws(()=>validateRuntimeIsolation({...pool,options:{...pool.options,database:'other'}} as Pool,metadata))
})
