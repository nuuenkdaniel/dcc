import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cachedMailHtml} from '../src/mail.js'
import type {Pool} from 'pg'
import {createHash} from 'node:crypto'

const id=createHash('sha256').update(['school','123','42'].join('\0')).digest('hex')
function fakePool(data:Record<string,unknown>){
 let updates=0
 const pool={query:async(sql:string,args?:unknown[])=>{
  if(sql.startsWith('SELECT account'))return {rows:[{account:data.account,data}]}
  if(sql.startsWith('UPDATE mail_messages')){updates++;data.hasHtml=args?.[4];data.html=JSON.parse(String(args?.[5]));return {rows:[],rowCount:1}}
  throw Error('Unexpected query')
 }} as unknown as Pool
 return {pool,updates:()=>updates}
}

test('HTML retrieval validates cached identity, caches HTML separately, and reuses a no-HTML result',async()=>{
 const fixture=fakePool({id,account:'school',uid:'42',validity:'123',body:'preserved text'});let calls=0
 const none=async(input:unknown)=>{calls++;assert.deepEqual(input,{mode:'mail-html',account:'school',uid:'42',validity:'123'});return {html:null}}
 assert.deepEqual(await cachedMailHtml(fixture.pool,id,none),{code:200,html:null,hasHtml:false})
 assert.deepEqual(await cachedMailHtml(fixture.pool,id,none),{code:200,html:null,hasHtml:false})
 assert.equal(calls,1);assert.equal(fixture.updates(),1)
 const invalid=fakePool({id,account:'school',uid:'42',validity:'wrong'})
 assert.equal((await cachedMailHtml(invalid.pool,id,async()=>{throw Error('must not fetch')})).code,409)
})

test('failed or oversized HTML retrieval does not alter cached text or HTML state',async()=>{
 const workId=createHash('sha256').update(['work','9','7'].join('\0')).digest('hex'),data={id:workId,account:'work',uid:'7',validity:'9',body:'keep me'};const fixture=fakePool(data)
 await assert.rejects(()=>cachedMailHtml(fixture.pool,workId,async()=>({html:'x'.repeat(2*1024*1024+1)})))
 assert.equal(fixture.updates(),0);assert.equal(data.body,'keep me');assert.equal('html' in data,false)
 await assert.rejects(()=>cachedMailHtml(fixture.pool,workId,async()=>{throw Error('connector unavailable')}))
 assert.equal(fixture.updates(),0)
})
