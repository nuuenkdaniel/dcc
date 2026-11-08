// Real authenticated route, registered MCP/SDK adapter and synthetic SQL store.
// No provider/model calls or PostgreSQL concurrency claims.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'
import {buildApp} from '../../src/app.js'
import {TaskActions,TASK_CALLBACK_PATH,type TaskBridgeInput} from '../../src/mcp/task-actions.js'
import {CONVERSATION_PATH} from '../../src/mcp/conversation.js'
import {COLLECTION,type ServiceOptions} from '../../src/mcp/service-transport.js'
import {IntentPool} from './intent-pool.js'
import {ServicePool} from './service-pool.js'
import {CalendarHarness,config} from './calendar-harness.js'
import {createNonRecurringCalendarWriter} from '../../src/calendar-write.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
const clientId='11111111-1111-4111-a111-111111111111',origin='http://synthetic.invalid',time=Date.parse('2026-12-31T12:00:00-05:00')
const result=(v:any)=>v.structuredContent.result
async function fixture(script:(client:Client,input:TaskBridgeInput)=>Promise<string>,db:ServicePool=new IntentPool(),dependencies:Pick<ServiceOptions,'calendarSnapshot'|'guardedCalendarWriter'>={}){
  const sessions=new Set<string>();let app:ReturnType<typeof buildApp>,calls=0
  const actions=new TaskActions({pool:db.pool,actorId:'chat-fixture',now:()=>time,...dependencies,bridge:async input=>{
    calls++
    const client=new Client({name:'synthetic-conversation',version:'1.0.0'})
    const wire:Transport={start:async()=>{},close:async()=>{wire.onclose?.()},send:async message=>{
      const response=await app.inject({method:'POST',url:TASK_CALLBACK_PATH,headers:{authorization:'Bearer '+input.callbackCapability},payload:message as any})
      if(response.statusCode===200)wire.onmessage?.(response.json());else if(response.statusCode!==202)throw Error('Synthetic callback rejected')
    }}
    try{await client.connect(wire);return {status:'finished',replyVersion:1,assistantText:await script(client,input)}}finally{await client.close()}
  }})
  app=buildApp({plannerPool:db.pool,taskActions:actions,auth:{username:'synthetic',password:'synthetic-only',origin,store:{put:async id=>{sessions.add(id)},has:async id=>sessions.has(id),remove:async id=>{sessions.delete(id)}}}})
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'synthetic',password:'synthetic-only'}})
  const cookie=login.cookies.find(c=>c.name==='daymark_session')!.value,owner=login.json().workspaceOwner
  const post=(body:Record<string,unknown>,workspaceOwner=owner)=>app.inject({method:'POST',url:CONVERSATION_PATH,headers:{origin},cookies:{daymark_session:cookie},payload:{...body,workspaceOwner}})
  const start=(key:string,prompt:string,entries:{role:string;text:string;at:number}[]=[])=>({op:'start',clientId,key,prompt,replyVersion:1,chatVersion:1,context:{version:1,entries}})
  const capabilities=()=>app.inject({url:'/api/v1/hermes/action-capabilities',cookies:{daymark_session:cookie}})
  return {app,db,post,start,capabilities,owner,calls:()=>calls,store:new SqlIntentStore(db.pool,'chat-fixture')}
}
test('ordinary chat, natural clarification and topic changes have text without tool transactions',async()=>{
  const h=await fixture(async(client,input)=>{
    assert.equal((await client.listTools()).tools.some(t=>t.name==='request_clarification'),false)
    assert.doesNotMatch(input.prompt,/exact listed|request_clarification\(task_names\)|confirmedAnswers/)
    if(input.prompt.includes('What does a chunk mean?'))return 'A chunk is a manageable part of studying; it need not be a specific topic.'
    if(input.prompt.includes('Let us discuss music instead'))return 'Of course. What music do you enjoy?'
    return 'Hello! What would you like to talk about?'
  })
  try{
    for(const [i,text] of ['hello?','What does a chunk mean?','Let us discuss music instead'].entries()){
      const input=h.start('natural_chat_turn_0'+i,text,[{role:'assistant',text:'Which study material do you mean?',at:time}])
      const response=await h.post(input);assert.equal(response.statusCode,200)
      const reply=response.json();assert.ok(reply.assistantReply.text);assert.equal(reply.question,undefined)
      assert.deepEqual((await h.store.read(input.key)).calls,[])
      assert.deepEqual((await h.post(input)).json(),reply)
    }
    assert.equal(h.calls(),3);assert.equal(h.db.rows.has(COLLECTION),false)
    assert.equal((await h.post(h.start('wrong_owner_chat_01','hello?'),'wrong-owner')).statusCode,409)
  }finally{await h.app.close()}
})
test('old reply-enabled clients retain clarification semantics and new chat requires its own version',async()=>{
  const h=await fixture(async(client,input)=>{
    if(input.chatVersion===undefined){
      assert.match(input.prompt,/Ask request_clarification/)
      assert.ok((await client.listTools()).tools.some(t=>t.name==='request_clarification'))
      await client.callTool({name:'request_clarification',arguments:{reason:'task_topics'}})
      return 'Legacy text does not replace a structured question.'
    }
    assert.equal(input.chatVersion,1);assert.equal(input.replyVersion,1)
    return 'Hello! You can change the subject.'
  })
  try{
    const caps=(await h.capabilities()).json()
    assert.equal(caps.conversationReplyVersion,1);assert.equal(caps.conversationChatVersion,1)
    const old={op:'start',clientId,key:'legacy_reply_question_01',prompt:'I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks using specific topics',replyVersion:1}
    const response=await h.post(old);assert.equal(response.statusCode,200)
    const question=response.json();assert.equal(question.receipt.outcome,'question');assert.ok(question.question)
    assert.equal(question.chatVersion,undefined);assert.equal(question.toolSummary,undefined)
    const modern=h.start('explicit_new_chat_01','hello?')
    const next=(await h.post(modern)).json();assert.equal(next.chatVersion,1);assert.equal(next.assistantReply.text,'Hello! You can change the subject.')
    assert.deepEqual((await h.post({op:'read',clientId,rootKey:old.key})).json(),question)
    const {chatVersion:_,...stripped}=modern
    assert.equal((await h.post(stripped)).statusCode,409)
    assert.equal((await h.post({...old,chatVersion:1})).statusCode,409)
    assert.equal((await h.post({...modern,key:'bad_chat_version_01',chatVersion:2})).statusCode,400)
    assert.equal((await h.post({...modern,key:'missing_chat_reply_01',replyVersion:undefined})).statusCode,400)
    assert.equal(h.calls(),2)
  }finally{await h.app.close()}
})
test('natural explanatory openings are not classified as mutation success keywords',async()=>{
  const replies=['Done explaining the distinction. What would you like to explore next?','Completed the example: a study chunk is just a bounded session.']
  let index=0
  const h=await fixture(async()=>replies[index++]!)
  try{
    for(let i=0;i<replies.length;i++){
      const input=h.start('explanation_opening_0'+i,'Explain the example')
      const reply=(await h.post(input)).json()
      assert.equal(reply.assistantReply.text,replies[i]);assert.equal(reply.toolSummary,undefined)
      assert.deepEqual((await h.store.read(input.key)).calls,[])
    }
    assert.equal(h.db.rows.has(COLLECTION),false)
  }finally{await h.app.close()}
})
test('new chat cancellation fences the stored filtered policy on the caller transaction without dispatch',{timeout:5000},async()=>{
  let arrived!:()=>void,release!:()=>void
  const entry=new Promise<void>(resolve=>{arrived=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const h=await fixture(async()=>{arrived();await gate;return 'Late explanation must not publish.'})
  const input=h.start('cancel_new_chat_policy_01','Wait while explaining')
  const pending=h.post(input)
  try{
    await entry
    const before=await h.store.read(input.key)
    assert.equal(before.guard?.chatVersion,1);assert.equal(before.allowedTools.includes('request_clarification'),false)
    const connect=h.db.connect
    h.db.connect=async()=>{assert.equal(h.db.connections,0,'Cancellation cannot acquire a nested connection');return connect.call(h.db)}
    let response
    try{response=await h.post({op:'cancel',clientId,rootKey:input.key})}finally{h.db.connect=connect}
    assert.equal(response.statusCode,200)
    const after=await h.store.read(input.key)
    assert.equal(after.phase,'uncertain');assert.deepEqual(after.allowedTools,before.allowedTools);assert.deepEqual(after.guard,before.guard);assert.deepEqual(after.calls,[])
    release();const late=(await pending).json();assert.equal(late.assistantReply,undefined)
    assert.equal(h.calls(),1);assert.equal(h.db.rows.has(COLLECTION),false)
  }finally{release();await pending;await h.app.close()}
})
test('agent-selected six generic tasks use actual MCP writes and truthful count, duplicate and follow-up reads',async()=>{
  const h=await fixture(async(client,input)=>{
    const read=async()=>result(await client.callTool({name:'list_tasks',arguments:{from:'2026-12-31',to:'2027-01-01',limit:20}}))
    if(input.prompt.includes('How many are there now?')){
      const current=await read();return `There are ${current.data.items.length} tasks in the returned page.`
    }
    for(let i=1;i<=6;i++){
      const current=await read()
      const saved=result(await client.callTool({name:'create_task',arguments:{title:`Study chunk ${i}`,date:'2026-12-31',expectedVersion:current.data.collectionVersion}}))
      assert.equal(saved.state,'applied')
    }
    return 'Created six generic study tasks. A chunk is a manageable study session, not an invented exam topic.'
  })
  try{
    const input=h.start('six_generic_tasks_01','Please create six study tasks for today; choose generic names.')
    const response=await h.post(input);assert.equal(response.statusCode,200)
    const reply=response.json();assert.equal(reply.assistantReply.text,'Created six generic study tasks. A chunk is a manageable study session, not an invented exam topic.')
    assert.equal(reply.toolSummary.text,'Created 6 tasks.');assert.equal(reply.chatVersion,1)
    const tasks=h.db.rows.get(COLLECTION)!.data.tasks
    assert.equal(tasks.length,6);assert.equal(new Set(tasks.map((t:any)=>t.id)).size,6)
    assert.deepEqual(tasks.map((t:any)=>t.title),Array.from({length:6},(_,i)=>`Study chunk ${i+1}`))
    const journal=await h.store.read(input.key)
    assert.equal(journal.guard?.chatVersion,1)
    assert.equal(journal.calls.filter(c=>c.command.tool==='create_task'&&c.result?.state==='applied').length,6)
    assert.deepEqual((await h.post(input)).json(),reply);assert.equal(h.calls(),1)
    const follow=(await h.post(h.start('six_task_followup_01','How many are there now?'))).json()
    assert.equal(follow.assistantReply.text,'There are 6 tasks in the returned page.')
    assert.equal(h.db.rows.get(COLLECTION)!.data.tasks.length,6)
  }finally{await h.app.close()}
})
test('ambiguous partial writes do not replay or freeze a subsequent unrelated chat',async()=>{
  const h=await fixture(async(client,input)=>{
    if(input.prompt.includes('Talk about music'))return 'What kind of music do you like?'
    const current=result(await client.callTool({name:'list_tasks',arguments:{from:'2026-12-31',to:'2027-01-01',limit:4}}))
    const saved=result(await client.callTool({name:'create_task',arguments:{title:'Synthetic single task',date:'2026-12-31',expectedVersion:current.data.collectionVersion}}))
    assert.equal(saved.state,'applied')
    throw Error('Synthetic lost completion')
  })
  try{
    const input=h.start('interrupted_chat_write_01','Create some tasks')
    const first=(await h.post(input)).json()
    assert.match(first.assistantReply.text,/1 task|not confirmed|interrupted/i)
    assert.doesNotMatch(first.assistantReply.text,/Created 6/)
    await h.post(input);await h.post({op:'read',clientId,rootKey:input.key})
    assert.equal(h.db.rows.get(COLLECTION)!.data.tasks.length,1);assert.equal(h.calls(),1)
    const next=(await h.post(h.start('unrelated_after_failure_01','Talk about music'))).json()
    assert.equal(next.assistantReply.text,'What kind of music do you like?');assert.equal(h.calls(),2)
  }finally{await h.app.close()}
})
test('conversation uses actual assignment and calendar schemas with a strictly isolated provider adapter',async()=>{
  const calendar=new CalendarHarness()
  const h=await fixture(async(client,input)=>{
    const tools=(await client.listTools()).tools
    for(const name of ['create_assignment','create_calendar_event']){
      const schema=tools.find(t=>t.name===name)!.inputSchema
      assert.equal(Object.hasOwn(schema.properties!,'operationKey'),false)
      assert.equal(Object.hasOwn(schema.properties!,'id'),false)
    }
    if(input.prompt.includes('assignment')){
      const created=result(await client.callTool({name:'create_assignment',arguments:{title:'Synthetic assignment',deadline:'2027-01-03',category:'school',importance:2,remainingMinutes:120,progress:''}}))
      assert.equal(created.state,'applied');return 'Your assignment is created. Its parent stays separate from daily study actions.'
    }
    const calendars=result(await client.callTool({name:'list_calendars',arguments:{limit:4}}))
    assert.equal(calendars.data.items[0].id,'Calendar_A')
    const saved=result(await client.callTool({name:'create_calendar_event',arguments:{title:'Synthetic event',calendarId:'Calendar_A',scope:'single',start:'2026-11-01T12:00:00Z',end:'2026-11-01T13:00:00Z',allDay:false}}))
    assert.equal(saved.state,'saved');return 'The calendar change was saved; snapshot confirmation is still pending.'
  },calendar,{calendarSnapshot:async()=>calendar.snapshot,guardedCalendarWriter:createNonRecurringCalendarWriter(calendar.pool,config,calendar.fetch)})
  try{
    const assignment=(await h.post(h.start('chat_assignment_create_01','Create an assignment due January 3, school, importance 2, 120 minutes.'))).json()
    assert.equal(assignment.assistantReply.text,'Your assignment is created. Its parent stays separate from daily study actions.')
    assert.equal(assignment.toolSummary.text,'Created 1 assignment.')
    assert.equal([...h.db.rows.values()].filter(r=>r.kind==='project'&&r.data.kind==='assignment').length,1)
    const input=h.start('chat_calendar_create_01','Create a calendar event in Calendar_A on November 1 from noon to 1 PM UTC.')
    const event=(await h.post(input)).json()
    assert.equal(event.assistantReply.text,'The calendar change was saved; snapshot confirmation is still pending.')
    assert.match(event.toolSummary.text,/pending/i)
    assert.equal(calendar.puts,1);assert.equal(calendar.snapshot.events.length,0)
    await h.post(input);assert.equal(calendar.puts,1)
    const journal=await h.store.read(input.key)
    assert.equal(journal.calls.filter(c=>c.command.tool==='create_calendar_event').length,1)
  }finally{await h.app.close()}
})
