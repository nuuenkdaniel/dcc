// Synthetic SQL query/lock fake + real SDK. Does NOT prove PostgreSQL concurrency
// or installed Luna behavior; the opt-in HTTP/PG/model campaign is separate.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Conversations,validConversationInput,projectConversationReceipt} from '../../src/mcp/conversation.js'
import {validConversationView} from '../../src/mcp/conversation-wire.js'
import {RequestController,type ModelRunner} from '../../src/mcp/request-controller.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {TOOLS,ACTIVE_TOOLS} from '../../src/mcp/contracts.js'
import {CONVERSATION_LIMITS} from '../../src/mcp/conversation-contract.js'
import {IntentPool} from './intent-pool.js'
import {ServicePool} from './service-pool.js'
import {createHash} from 'node:crypto'
import {canonicalJson,RECEIPT_KIND} from '../../src/mcp/service-transport.js'
import type {Command,Result} from '../../src/mcp/contracts.js'
const clientId='11111111-1111-4111-a111-111111111111',owner='synthetic-owner'
const original='I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks'
const actual='I am studying for an upcoming midterm I need to study the first 3 chunks today. Can you put that on my task list?'
const mobile='i have a CSE 354 exam coming up. I broke my studying into chunks. Im doing 3 chunks today. Can you throw that on my tasks?'
const questionRequest=original+' using specific topics'
const policy={executor:'mcp-action-v1' as const,allowedTools:ACTIVE_TOOLS}
function setup(limit=3,prompt=questionRequest){
  const conversations=new IntentPool(),journal=new IntentPool(),domain=new ServicePool(),store=new SqlIntentStore(journal.pool,'actor-A'),transport=new ServiceTransport({pool:domain.pool,actorId:'actor-A'})
  let calls=0,now=Date.parse('2026-11-08T02:00:00Z')
  const runner:ModelRunner=async request=>{
    calls++
    if(request.prompt.startsWith('Ask '))return {calls:[{id:'question',tool:'request_clarification',arguments:{reason:request.prompt.includes('task_names')?'task_names':'task_topics'}}],done:true}
    const tasks=JSON.parse(request.prompt.match(/\[.*\]/)![0]) as {title:string;date:string}[]
    let version=Number(domain.rows.get(COLLECTION)?.version??0)
    return {calls:tasks.slice(0,limit).map((task,i)=>({id:'create'+i,tool:'create_task',arguments:{...task,expectedVersion:version++}})),done:true,final:'All three done!'}
  }
  const controller=new RequestController({store,transport,runner,now:()=>now})
  // Resolved checklists no longer ask the runner to choreograph writes. Preserve
  // partial-persistence coverage by failing the next authoritative version read.
  const execute=transport.execute.bind(transport);let writes=0
  transport.execute=async(command,context)=>{
    if(command.tool==='list_tasks'&&limit<3&&writes>=limit)throw Error('Synthetic collection read interruption')
    const result=await execute(command,context)
    if(command.tool==='create_task'&&result.state==='applied')writes++
    return result
  }
  const api=new Conversations({pool:conversations.pool,store,transport,now:()=>now,run:(input,signal)=>controller.run(input,policy,signal),fence:async input=>{await store.admit({...input,purpose:'action'},policy);await store.fence(input.key,now)}})
  const start=()=>api.handle({op:'start',clientId,key:'conversation_root_01',prompt},owner)
  return {api,store,domain,conversations,start,calls:()=>calls,advance:(ms:number)=>{now+=ms}}
}
test('required topics → question → bound names → three persisted tasks → verified receipt; duplicate/conflicting answers',async()=>{
  const h=setup(),q=await h.start()
  assert.equal(q.receipt.outcome,'question');assert.equal(q.original,questionRequest);assert.equal(h.domain.rows.size,0);assert.ok(validConversationView(q))
  const answer={op:'answer' as const,clientId,rootKey:q.rootKey,key:'conversation_answer_01',parentKey:q.turnKey,questionId:q.question!.id,answer:'Lectures, practice problems, and review'}
  const complete=await h.api.handle(answer,owner)
  assert.equal(complete.receipt.outcome,'complete');assert.equal(complete.receipt.expected,3);assert.equal(complete.receipt.verified,3);assert.equal(complete.original,undefined)
  assert.ok(validConversationView(complete));assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,3)
  assert.deepEqual(complete.receipt.targets.map(t=>[t.title,t.date]),[['CSE354: Lectures','2026-11-07'],['CSE354: practice problems','2026-11-07'],['CSE354: review','2026-11-07']])
  assert.equal(new Set(complete.receipt.targets.map(t=>t.id)).size,3)
  assert.deepEqual(await h.api.handle(answer,owner),complete);assert.equal(h.calls(),1)
  await assert.rejects(h.api.handle({...answer,answer:'Changed answer'},owner),/conversation_conflict/)
  await assert.rejects(h.api.handle({...answer,key:'different_child_key_01'},owner),/closed_question/)
  await assert.rejects(h.api.handle({...answer,clientId:'22222222-2222-4222-a222-222222222222'},owner),/conversation_conflict/)
  await assert.rejects(h.api.handle(answer,'wrong-owner'),/conversation_conflict/)
  assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,3)
  for(const row of h.conversations.rows.values())if(row.kind==='dcc-hermes-conversation-v1'){
    assert.equal(row.data.original,undefined);assert.deepEqual(row.data.answers,[]);assert.equal(row.data.prompt,undefined)
  }
})
test('interrupted two of three cannot claim completion; failed readback stays uncertain',async()=>{
  const h=setup(2),q=await h.start()
  const r=await h.api.handle({op:'answer',clientId,rootKey:q.rootKey,key:'partial_answer_key_01',parentKey:q.turnKey,questionId:q.question!.id,answer:'Lectures; practice problems; review'},owner)
  assert.equal(r.receipt.outcome,'uncertain');assert.equal(r.receipt.expected,3);assert.equal(r.receipt.verified,2)
  assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,2)
  const record=await h.store.read(r.turnKey)
  h.domain.rows.get(COLLECTION)!.data.tasks=[]
  const receipt=await projectConversationReceipt(record,new ServiceTransport({pool:h.domain.pool,actorId:'actor-A'}))
  assert.equal(receipt.outcome,'uncertain');assert.equal(receipt.verified,0)
})
test('unique parent claim precedes two concurrent child executions',async()=>{
  const h=setup(),q=await h.start()
  const body={op:'answer' as const,clientId,rootKey:q.rootKey,parentKey:q.turnKey,questionId:q.question!.id,answer:'Lectures; practice problems; review'}
  const result=await Promise.allSettled([h.api.handle({...body,key:'concurrent_child_key_01'},owner),h.api.handle({...body,key:'concurrent_child_key_02'},owner)])
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.calls(),1);assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,3)
})
test('three questions can be answered, never a fourth; expiration scrubs text not effect journals',async()=>{
  const h=setup();let q=await h.start()
  for(let i=1;i<=3;i++)q=await h.api.handle({op:'answer',clientId,rootKey:q.rootKey,key:'question_answer_key_0'+i,parentKey:q.turnKey,questionId:q.question!.id,answer:'Only two; names'},owner)
  assert.equal(q.questions,3);assert.equal(q.receipt.outcome,'failed');assert.equal(q.question,undefined);assert.equal(h.calls(),3)
  const expired=setup(),pending=await expired.start(),count=expired.store
  expired.advance(CONVERSATION_LIMITS.ttlMs)
  const read=await expired.api.handle({op:'read',clientId,rootKey:pending.rootKey},owner)
  assert.equal(read.question,undefined);assert.equal(read.original,undefined)
  await assert.rejects(expired.api.handle({op:'answer',clientId,rootKey:pending.rootKey,key:'expired_answer_key_01',parentKey:pending.turnKey,questionId:pending.question!.id,answer:'just general chunks'},owner),/closed_question/)
  assert.equal((await count.read(pending.turnKey)).calls.length,1)
})
test('clear three named tasks go directly; one active per owner/client; malformed inputs rejected',async()=>{
  const h=setup(),r=await h.api.handle({op:'start',clientId,key:'direct_named_tasks_01',prompt:'Add 3 tasks today: Lectures; practice problems; review'},owner)
  assert.equal(r.receipt.outcome,'complete');assert.equal(h.calls(),0)
  const pending=setup();await pending.start()
  await assert.rejects(pending.api.handle({op:'start',clientId,key:'another_active_key_01',prompt:original},owner),/active_conversation/)
  for(const bad of [null,{}, {op:'start',clientId,key:'x',prompt:original},{op:'start',clientId,key:'malformed_long_key_01',prompt:'a'.repeat(4001)}, {op:'start',clientId,key:'malformed_actor_key_01',prompt:original,actor:'fake'}])assert.equal(validConversationInput(bad),false)
})
test('answer combined length fails without consuming question; old uncertain keys are never upgraded',async()=>{
  const h=setup(),q=await h.start()
  await assert.rejects(h.api.handle({op:'answer',clientId,rootKey:q.rootKey,key:'oversized_answer_key_01',parentKey:q.turnKey,questionId:q.question!.id,answer:'x'.repeat(4000)},owner),/text_limit/)
  assert.equal((await h.api.handle({op:'read',clientId,rootKey:q.rootKey},owner)).receipt.outcome,'question')
  const old=setup()
  await old.store.admit({key:'conversation_root_01',prompt:'Uncertain older request',purpose:'action'},policy)
  await old.store.start('conversation_root_01',Date.parse('2026-11-08T02:00:00Z'));await old.store.interrupt('conversation_root_01')
  const r=await old.start();assert.equal(r.receipt.outcome,'uncertain');assert.equal(r.question,undefined);assert.equal(old.calls(),0)
  assert.equal((await old.store.read('conversation_root_01')).guard,undefined)
})
test('zero effects is not done; read-only is distinct; calendar saved never means verified event sync',async()=>{
  const h=setup(),record=await h.store.admit({key:'projection_fixture_01',prompt:'Synthetic projection fixture',purpose:'action'},policy)
  record.phase='completed';record.outcome='no_effects_recorded';record.guard={version:1,checklist:{version:1,kind:'create_tasks',tasks:[{title:'Missing',date:'2026-11-07'}]}}
  assert.equal((await projectConversationReceipt(record,new ServiceTransport({pool:h.domain.pool,actorId:'actor-A'}))).outcome,'failed')
  record.guard={version:1,readOnly:true};record.calls=[{id:'read',fingerprint:'synthetic',command:{tool:'list_tasks',args:{from:'2026-11-07',to:'2026-11-08',limit:1}},result:{state:'ok',data:{items:[],nextOffset:null,collectionVersion:0}}}]
  const transport=new ServiceTransport({pool:h.domain.pool,actorId:'actor-A'})
  assert.equal((await projectConversationReceipt(record,transport)).outcome,'read-only')
  const command:Command={tool:'create_calendar_event',args:{operationKey:'saved_calendar_fixture_01',id:'11111111-1111-4111-a111-111111111111',calendarId:'synthetic-calendar',scope:'single',title:'Synthetic',start:'2026-11-07T12:00:00Z',end:'2026-11-07T13:00:00Z',allDay:false}}
  const result:Result={state:'saved',operationKey:String(command.args.operationKey),mutationId:String(command.args.id),confirmation:'snapshot_pending',readback:'pending',providerEtag:null}
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),actorHash=hash('actor-A'),key=String(command.args.operationKey),digest=hash(canonicalJson(['dcc-mcp-operation-v1',actorHash,key]))
  const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`
  h.domain.seed({id,kind:RECEIPT_KIND,version:1,data:{v:1,actorHash,key,fingerprint:hash(canonicalJson(command)),tool:command.tool,state:'saved',result}})
  record.guard={version:1};record.calls=[{id:'calendar',fingerprint:'synthetic',command,result}]
  const receipt=await projectConversationReceipt(record,transport)
  assert.equal(receipt.outcome,'uncertain');assert.equal(receipt.verified,0);assert.match(receipt.line,/snapshot confirmation pending/)
  assert.equal(receipt.targets[0]!.kind,'calendar-mutation');assert.match(receipt.targets[0]!.title,/not an event ID/)
})
test('exact natural study request and CSE request each admit an immutable three-task guard with no clarification',async()=>{
  for(const [prompt,prefix] of [[actual,''],[original,'CSE354: '],[mobile,'CSE354: ']] as const){
    const h=setup(3,prompt),r=await h.start()
    const expected=Array.from({length:3},(_,i)=>({title:`${prefix}Study chunk ${i+1}`,date:'2026-11-07'}))
    assert.equal(h.calls(),0);assert.equal(r.question,undefined);assert.equal(r.original,undefined)
    assert.ok(validConversationView(r));assert.equal(r.receipt.outcome,'complete');assert.equal(r.receipt.expected,3);assert.equal(r.receipt.verified,3)
    const journal=await h.store.read(r.turnKey)
    assert.deepEqual(journal.guard?.checklist?.tasks,expected)
    assert.equal(journal.calls.some(c=>c.command.tool==='request_clarification'),false)
    assert.equal(journal.calls.filter(c=>c.command.tool==='create_task').length,3)
    assert.deepEqual(r.receipt.targets.map(t=>({title:t.title,date:t.date})),expected)
    assert.equal(new Set(r.receipt.targets.map(t=>t.id)).size,3)
    assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,3)
    assert.deepEqual(await h.start(),r);assert.equal(h.calls(),0)
  }
})
test('generic default stops on interrupted reads and still requires all three verified writes',async()=>{
  for(const prompt of [actual,mobile]){
    const h=setup(2,prompt),r=await h.start(),record=await h.store.read(r.turnKey)
    assert.equal(record.guard?.checklist?.tasks.length,3);assert.equal(r.receipt.outcome,'uncertain')
    assert.equal(r.receipt.expected,3);assert.equal(r.receipt.verified,2);assert.equal(h.calls(),0)
    h.domain.rows.get(COLLECTION)!.data.tasks=[]
    assert.equal((await projectConversationReceipt(record,new ServiceTransport({pool:h.domain.pool,actorId:'actor-A'}))).outcome,'uncertain')
  }
})
test('old persisted optional-topics question accepts Just label without another question or duplicate writes',async()=>{
  const h=setup(),q=await h.start()
  // Historical pending root: old code asked about optional labels for this exact
  // plain request. Keep its claimed question/journal, not a new runtime fallback.
  const row=[...h.conversations.rows.values()].find(r=>r.kind==='dcc-hermes-conversation-v1')!
  row.data.original=original
  row.data.turns[0].fingerprint=createHash('sha256').update(original).digest('hex')
  const answer={op:'answer' as const,clientId,rootKey:q.rootKey,key:'legacy_label_answer_01',parentKey:q.turnKey,questionId:q.question!.id,answer:'Just label'}
  const result=await h.api.handle(answer,owner)
  assert.equal(result.question,undefined);assert.equal(result.receipt.outcome,'complete');assert.equal(result.receipt.expected,3);assert.equal(result.receipt.verified,3)
  assert.deepEqual(result.receipt.targets.map(t=>t.title),['CSE354: Study chunk 1','CSE354: Study chunk 2','CSE354: Study chunk 3'])
  assert.equal(h.calls(),1);assert.deepEqual(await h.api.handle(answer,owner),result);assert.equal(h.calls(),1)
  assert.equal(h.domain.rows.get(COLLECTION)!.data.tasks.length,3)
})
test('generic study dates are fixed at each execution admission using the backend NY day',async()=>{
  const h=setup(3,actual),first=await h.start()
  assert.ok(first.receipt.targets.every(t=>t.date==='2026-11-07'))
  h.advance(3*60*60*1000)
  const next=await h.api.handle({op:'start',clientId,key:'next_day_study_01',prompt:actual},owner)
  assert.equal(next.receipt.outcome,'complete');assert.ok(next.receipt.targets.every(t=>t.date==='2026-11-08'))
  assert.equal(h.calls(),0)
})
