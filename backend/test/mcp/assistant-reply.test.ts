// Scripted transport fixtures, not model/provider acceptance.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'
import {buildApp} from '../../src/app.js'
import {TaskActions,TASK_CALLBACK_PATH,type TaskBridgeInput} from '../../src/mcp/task-actions.js'
import {CONVERSATION_PATH} from '../../src/mcp/conversation.js'
import {validConversationView} from '../../src/mcp/conversation-wire.js'
import {replyTextFits,validRuntimeCompletion} from '../../src/mcp/assistant-reply.js'
import {IntentPool} from './intent-pool.js'
import {COLLECTION} from '../../src/mcp/service-transport.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
const clientId='11111111-1111-4111-a111-111111111111',origin='http://synthetic.invalid'
const done=(text='Synthetic actual final')=>({status:'finished',replyVersion:1,assistantText:text})
async function fixture(script:(client:Client,input:TaskBridgeInput)=>Promise<unknown>){
  let time=Date.parse('2026-12-31T12:00:00-05:00'),calls=0
  const db=new IntentPool(),sessions=new Set<string>()
  let app:ReturnType<typeof buildApp>
  const actions=new TaskActions({pool:db.pool,actorId:'reply-fixture',now:()=>time,bridge:async input=>{
    calls++
    const client=new Client({name:'synthetic-reply-fixture',version:'1.0.0'})
    const wire:Transport={start:async()=>{},close:async()=>{wire.onclose?.()},send:async message=>{
      const r=await app.inject({method:'POST',url:TASK_CALLBACK_PATH,headers:{authorization:'Bearer '+input.callbackCapability},payload:message as any})
      if(r.statusCode===200)wire.onmessage?.(r.json());else if(r.statusCode!==202)throw Error('Synthetic callback denied')
    }}
    try{await client.connect(wire);return await script(client,input)}finally{await client.close()}
  }})
  app=buildApp({plannerPool:db.pool,taskActions:actions,auth:{username:'synthetic',password:'synthetic-only',origin,store:{put:async id=>{sessions.add(id)},has:async id=>sessions.has(id),remove:async id=>{sessions.delete(id)}}}})
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'synthetic',password:'synthetic-only'}})
  const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value,owner=login.json().workspaceOwner
  const post=(body:Record<string,unknown>,workspaceOwner=owner)=>app.inject({method:'POST',url:CONVERSATION_PATH,headers:{origin},cookies:{daymark_session:cookie},payload:{...body,workspaceOwner}})
  const start=(key:string,prompt:string)=>({op:'start',clientId,key,prompt,replyVersion:1,context:{version:1,entries:[]}})
  return {app,db,post,start,owner,calls:()=>calls,store:new SqlIntentStore(db.pool,'reply-fixture'),expire:()=>{time+=86400001}}
}
test('reply codec is bounded Unicode text only, never an arbitrary authority object',()=>{
  for(const v of ['café 🙂','a'.repeat(2048),'界'.repeat(1365)])assert.ok(replyTextFits(v))
  for(const v of ['', ' ', 'a'.repeat(2049),'界'.repeat(1366),'\ud800','\udc00','x\u0000',{}])assert.equal(replyTextFits(v),false)
  assert.ok(validRuntimeCompletion(done()));assert.ok(validRuntimeCompletion({status:'finished',replyVersion:1}))
  for(const v of [{status:'finished'},{...done(),replyVersion:2},{...done(),targets:[]},{...done(),assistantText:{text:'fake'}}])assert.equal(validRuntimeCompletion(v),false)
})
test('authenticated no-action reply is disposable, once-only, fingerprint/owner-bound and legacy callers remain unchanged',async()=>{
  const h=await fixture(async(_client,input)=>input.replyVersion===1?done():{status:'finished'})
  try{
    const input=h.start('reply_explanation_01','Explain why tasks and projects are separate')
    const response=await h.post(input);assert.equal(response.statusCode,200)
    const v=response.json();assert.ok(validConversationView(v));assert.ok(v.assistantReply);assert.equal(v.assistantReply.text,'Synthetic actual final')
    assert.equal(v.receipt.outcome,'read-only');assert.equal(v.receipt.expected,null);assert.equal(v.receipt.verified,0);assert.deepEqual(v.receipt.targets,[])
    assert.deepEqual((await h.post(input)).json(),v);assert.equal(h.calls(),1)
    assert.equal((await h.post({...input,replyVersion:undefined})).statusCode,409)
    assert.equal((await h.post(input,'wrong-owner')).statusCode,409)
    assert.equal((await h.post({op:'read',clientId:'22222222-2222-4222-a222-222222222222',rootKey:input.key})).statusCode,409)
    assert.equal((await h.store.read(input.key)).calls.length,0)
    for(const row of h.db.rows.values())if(row.kind==='dcc-request-intent-v1'||row.kind==='hermes-command')assert.equal(JSON.stringify(row.data).includes('Synthetic actual final'),false)
    h.expire()
    const expired=(await h.post({op:'read',clientId,rootKey:input.key})).json();assert.equal(expired.assistantReply,undefined)
    const legacy=(await h.post({op:'start',clientId,key:'reply_legacy_case_01',prompt:'Explain tasks'})).json()
    assert.equal(legacy.assistantReply,undefined);assert.equal(legacy.replyUnavailable,undefined)
  }finally{await h.app.close()}
})
test('Done prose never certifies zero effects, conflicts or interrupted writes; verified updates retain partial scope',async()=>{
  let mode:'zero'|'update'|'conflict'|'interrupt'='zero'
  let concurrentChange=()=>{}
  const h=await fixture(async(client)=>{
    if(mode!=='zero'){
      const read:any=await client.callTool({name:'list_tasks',arguments:{from:'2026-12-31',to:'2027-01-02',limit:10}})
      const data=read.structuredContent.result.data
      if(mode==='conflict')concurrentChange()
      await client.callTool({name:'update_task',arguments:{id:data.items[0].id,date:'2027-01-01',expectedVersion:data.collectionVersion}})
      if(mode==='interrupt')throw Error('Synthetic interrupted bridge')
    }
    return done('Done with everything.')
  })
  concurrentChange=()=>{h.db.rows.get(COLLECTION)!.version++}
  try{
    const zero=(await h.post(h.start('reply_lying_zero_01','Move all my tasks tomorrow'))).json()
    assert.equal(zero.assistantReply.text,'Done with everything.');assert.equal(zero.receipt.outcome,'read-only');assert.equal(zero.receipt.line,'No actions performed.')
    assert.equal(zero.receipt.verified,0);assert.deepEqual(zero.receipt.targets,[]);assert.equal(zero.receipt.expected,null);assert.equal(zero.continuable,false)
    await h.post({op:'start',clientId,key:'reply_seed_task_01',prompt:'Add 1 study chunk today'})
    mode='update'
    const update=(await h.post(h.start('reply_real_update_01','Move the study chunk tomorrow'))).json()
    assert.equal(update.assistantReply.text,'Done with everything.');assert.equal(update.receipt.outcome,'partial');assert.equal(update.receipt.verified,1);assert.equal(update.receipt.expected,null)
    assert.equal(update.receipt.targets[0].id,h.db.rows.get(COLLECTION)!.data.tasks[0].id)
    mode='conflict'
    const conflict=(await h.post(h.start('reply_real_conflict_01','Move the study chunk tomorrow'))).json()
    assert.equal(conflict.assistantReply.text,'Done with everything.');assert.equal(conflict.receipt.outcome,'failed');assert.equal(conflict.receipt.verified,0);assert.equal(conflict.continuable,false)
    mode='interrupt'
    const interrupted=(await h.post(h.start('reply_interrupted_01','Move the study chunk tomorrow'))).json()
    assert.equal(interrupted.assistantReply,undefined);assert.notEqual(interrupted.receipt.outcome,'complete');assert.equal(interrupted.continuable,false)
  }finally{await h.app.close()}
})
test('wrong runtime reply version is not retried; late text cannot overwrite cancellation or another root',async()=>{
  let release:()=>void=()=>{},arrived:()=>void=()=>{}
  const gate=new Promise<void>(resolve=>{release=resolve}),entry=new Promise<void>(resolve=>{arrived=resolve})
  const h=await fixture(async(_client,input)=>{if(input.prompt.includes('Wait for cancellation')){arrived();await gate;return done('Late text must not publish')}return {...done(),replyVersion:2}})
  try{
    const bad=(await h.post(h.start('reply_bad_version_01','Explain tasks'))).json()
    assert.equal(bad.assistantReply,undefined);assert.equal(h.calls(),1)
    const input=h.start('reply_late_cancel_01','Wait for cancellation before moving tasks')
    const pending=h.post(input);await entry
    const cancelled=(await h.post({op:'cancel',clientId,rootKey:input.key})).json();assert.equal(cancelled.assistantReply,undefined)
    release();assert.equal((await pending).json().assistantReply,undefined)
    assert.equal(h.calls(),2)
  }finally{release();await h.app.close()}
})
