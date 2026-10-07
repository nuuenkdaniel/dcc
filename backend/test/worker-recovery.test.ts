import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {FastifyInstance} from 'fastify'
import type {Pool,PoolClient} from 'pg'
import {createExpiredSessionCleanup} from '../src/database.js'
import {classifyMail,mailRoutes,syncMail} from '../src/mail.js'
import {classificationRetryKey,parseClassificationRetry,withoutClassificationRetry} from '../src/mail-retry.js'

test('expired-session cleanup is independent and throttled after success',async()=>{
 let time=new Date('2026-10-06T12:00:00.000Z'),calls=0,fail=true
 const pool={query:async(sql:string,args?:unknown[])=>{assert.equal(sql,'DELETE FROM app_sessions WHERE expires_at<$1');assert.deepEqual(args,[time]);calls++;if(fail)throw Error('database unavailable');return {rows:[]}}} as unknown as Pool
 const cleanup=createExpiredSessionCleanup(()=>time)
 await assert.rejects(()=>cleanup(pool));fail=false;assert.equal(await cleanup(pool),'waiting');assert.equal(calls,1)
 time=new Date('2026-10-06T12:04:59.999Z');assert.equal(await cleanup(pool),'waiting')
 time=new Date('2026-10-06T12:05:00.000Z');assert.equal(await cleanup(pool),'cleaned');assert.equal(await cleanup(pool),'waiting');assert.equal(calls,2)
 time=new Date('2026-10-07T12:04:59.999Z');assert.equal(await cleanup(pool),'waiting')
 time=new Date('2026-10-07T12:05:00.000Z');assert.equal(await cleanup(pool),'cleaned');assert.equal(calls,3)
})

type CachedMessage={id:string;data:Record<string,unknown>;analysis?:unknown}
function classifierPool(messages:CachedMessage[],onSelection:(sql:string)=>void=()=>{}){
 const client={query:async(sql:string,args?:unknown[])=>{
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{ok:true}]}
  if(sql.startsWith('SELECT id,data-')){onSelection(sql);const sorted=messages.filter(message=>message.analysis===undefined).sort((a,b)=>String(b.data.receivedAt).localeCompare(String(a.data.receivedAt))||b.id.localeCompare(a.id));const cursorReceived=args?.[1],cursorId=args?.[2];return {rows:sorted.filter(message=>cursorReceived===null||String(message.data.receivedAt)<String(cursorReceived)||(message.data.receivedAt===cursorReceived&&message.id<String(cursorId))).slice(0,100).map(message=>({id:message.id,data:withoutClassificationRetry(message.data),retry:message.data[classificationRetryKey],received_at:message.data.receivedAt}))}}
  if(sql.startsWith('SELECT rules'))return {rows:[{rules:'fixture rules'}]}
  if(sql.startsWith("SELECT data->>'sender'"))return {rows:[]}
  if(sql.includes('SET data=jsonb_set')){const message=messages.find(item=>item.id===args?.[0])!;message.data[classificationRetryKey]=JSON.parse(String(args?.[1]));return {rows:[],rowCount:1}}
  if(sql.includes('SET analysis=')){const message=messages.find(item=>item.id===args?.[0])!;message.analysis=args?.[1];delete message.data[classificationRetryKey];return {rows:[],rowCount:1}}
  if(sql.includes('pg_advisory_unlock'))return {rows:[]}
  throw Error(`Unexpected query: ${sql}`)
 },release(){}} as unknown as PoolClient
 return {connect:async()=>client} as unknown as Pool
}

const cached=(id:string,receivedAt:string,retry?:unknown):CachedMessage=>({id,data:{id,account:'school',sender:'sender@example.test',subject:id,body:'body',receivedAt,...(retry===undefined?{}:{[classificationRetryKey]:retry})}})
const classification=(id:string)=>({messages:[{id,important:false,summary:'summary',reason:'reason'}]})

test('classification retry is durable per message and a poison message does not block newer work',async()=>{
 let time=new Date('2026-10-06T16:00:00.000Z')
 const poison=cached('poison','2026-10-06T15:59:00.000Z'),next=cached('next','2026-10-06T15:58:00.000Z')
 const pool=classifierPool([poison,next]);const calls:string[]=[]
 const curator=async(input:unknown)=>{const payload=input as {messages:Record<string,unknown>[]};assert.equal(classificationRetryKey in payload.messages[0]!,false);const id=String(payload.messages[0]?.id);calls.push(id);if(id==='poison'&&calls.filter(value=>value==='poison').length===1)throw Error('bad message');return classification(id)}
 const options={curator,now:()=>time,random:()=>0}
 assert.equal(await classifyMail(pool,options),'deferred')
 assert.deepEqual(poison.data[classificationRetryKey],{version:1,attempts:1,nextAttemptAt:'2026-10-06T16:00:30.000Z'})
 assert.equal(await classifyMail(pool,options),'classified');assert.deepEqual(calls,['poison','next'])
 time=new Date('2026-10-06T16:00:30.000Z')
 assert.equal(await classifyMail(pool,options),'classified');assert.equal(poison.data[classificationRetryKey],undefined)
 assert.deepEqual(calls,['poison','next','poison'])
})

test('retry validation rejects corrupt metadata and backoff caps at six hours plus jitter',async()=>{
 for(const value of [null,{},[],{version:2,attempts:1,nextAttemptAt:'2026-10-06T00:00:00.000Z'},{version:1,attempts:0,nextAttemptAt:'bad'},{version:1,attempts:1,nextAttemptAt:'2026-10-06'}])assert.equal(parseClassificationRetry(value),null)
 const corrupt=cached('corrupt','2026-10-06T15:00:00.000Z',{version:1,attempts:'many',nextAttemptAt:'2999-01-01T00:00:00.000Z'})
 const pool=classifierPool([corrupt]),time=new Date('2026-10-06T16:00:00.000Z')
 assert.equal(await classifyMail(pool,{curator:async()=>{throw Error('still bad')},now:()=>time,random:()=>0}),'deferred')
 assert.deepEqual(corrupt.data[classificationRetryKey],{version:1,attempts:1,nextAttemptAt:'2026-10-06T16:00:30.000Z'})
 corrupt.data[classificationRetryKey]={version:1,attempts:99,nextAttemptAt:time.toISOString()}
 assert.equal(await classifyMail(pool,{curator:async()=>{throw Error('still bad')},now:()=>time,random:()=>1}),'deferred')
 assert.deepEqual(corrupt.data[classificationRetryKey],{version:1,attempts:100,nextAttemptAt:'2026-10-06T22:00:00.000Z'})
})

test('classifier scans past more than 100 deferred rows and treats an invalid deadline as ready',async()=>{
 const time=new Date('2026-10-06T16:00:00.000Z'),future={version:1,attempts:1,nextAttemptAt:'2026-10-06T17:00:00.000Z'}
 const messages=Array.from({length:100},(_,index)=>cached(`deferred-${index}`,new Date(time.getTime()-index*1000).toISOString(),future))
 const older=cached('older-ready',new Date(time.getTime()-100_000).toISOString(),{version:1,attempts:1,nextAttemptAt:'not-a-date'});messages.push(older)
 let selections=0,classified=''
 assert.equal(await classifyMail(classifierPool(messages,()=>selections++),{curator:async input=>{classified=String((input as {messages:{id:string}[]}).messages[0]?.id);return classification(classified)},now:()=>time,random:()=>0}),'classified')
 assert.equal(selections,2);assert.equal(classified,'older-ready');assert.ok(older.analysis)
})

test('a retry started before midnight remains eligible without enrolling other prior-day mail',async()=>{
 const time=new Date('2026-10-07T04:01:00.000Z'),prior=cached('prior-retry','2026-10-07T03:59:00.000Z',{version:1,attempts:1,nextAttemptAt:'2026-10-07T04:00:00.000Z'});let selectionSql=''
 assert.equal(await classifyMail(classifierPool([prior],sql=>selectionSql=sql),{curator:async()=>classification(prior.id),now:()=>time,random:()=>0}),'classified')
 assert.match(selectionSql,/receivedAt'\)::timestamptz AT TIME ZONE 'America\/New_York' >= \$1::date OR data\?'_classificationRetry'/)
 assert.ok(prior.analysis)
})

test('mail reingestion preserves reserved retry state and never sends it to the curator',async()=>{
 const id='a'.repeat(64),queries:string[]=[]
 const client={query:async(sql:string,args?:unknown[])=>{
  queries.push(sql)
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{ok:true}]}
  if(sql.includes('next_run<=now()'))return {rows:[{due:args?.[0]==='personal'}]}
  if(sql.startsWith('SELECT id FROM'))return {rows:[]}
  if(sql.startsWith('INSERT INTO mail_messages'))return {rows:[],rowCount:1}
  if(sql.startsWith('UPDATE mail_state'))return {rows:[],rowCount:1}
  if(sql.includes('pg_advisory_unlock'))return {rows:[]}
  throw Error(`Unexpected query: ${sql}`)
 },release(){}} as unknown as PoolClient
 const pool={connect:async()=>client} as unknown as Pool
 await syncMail(pool,async input=>{assert.deepEqual(input,{mode:'mail-sync',account:'personal',offset:0,known:[]});return {messages:[{id,account:'personal',body:'body',[classificationRetryKey]:{version:1,attempts:500,nextAttemptAt:'2999-01-01T00:00:00.000Z'}}],next:null,total:1}})
 const insert=queries.find(sql=>sql.startsWith('INSERT INTO mail_messages'))!
 assert.match(insert,/\$3::jsonb-'_classificationRetry'/)
 assert.match(insert,/mail_messages\.data \|\| \(excluded\.data-'_classificationRetry'\)/)
})

test('retry metadata is stripped from public data and manual rules reset only intended rows',async()=>{
 assert.deepEqual(withoutClassificationRetry({id:'one',[classificationRetryKey]:{secret:true}}),{id:'one'})
 const gets=new Map<string,Function>(),posts=new Map<string,Function>(),queries:{sql:string;args?:unknown[]}[]=[]
 const app={get:(path:string,handler:Function)=>{gets.set(path,handler)},post:(path:string,handler:Function)=>{posts.set(path,handler)}} as unknown as FastifyInstance
 const pool={query:async(sql:string,args?:unknown[])=>{queries.push({sql,args});if(sql.includes('ORDER BY data->>\'receivedAt\' DESC'))return {rows:[{data:{id:'one',[classificationRetryKey]:{secret:true}},analysis:null,override:null}]};if(sql.startsWith('SELECT account'))return {rows:[]};return {rows:[],rowCount:1}}} as unknown as Pool
 mailRoutes(app,pool)
 const snapshot=await gets.get('/api/v1/mail/snapshot')!()
 assert.equal(classificationRetryKey in snapshot.messages[0].data,false)
 const reply={code(){return this},send(value:unknown){return value}}
 assert.deepEqual(await posts.get('/api/v1/mail/preferences')!({body:{rules:'new rules'}},reply),{saved:true})
 const reset=queries.find(query=>query.sql.startsWith('UPDATE mail_messages SET analysis=NULL'))!
 assert.match(reset.sql,/data=data-'_classificationRetry'/);assert.match(reset.sql,/WHERE override IS NULL/)
 assert.ok(reset.args?.[0])
})
