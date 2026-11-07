// Synthetic HTTP contracts; not proof of real model or SQL effects.
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {HermesConversation} from './HermesConversation'
import {protectedFetch} from './auth'
import {validConversationView,type ConversationView} from '../../backend/src/mcp/conversation-wire'
vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
const owner='a'.repeat(64),root='conversation_root_01',turn='conversation_answer_01'
const question={version:1,rootKey:root,turnKey:root,expiresAt:Date.now()+86400000,questions:1,original:'Study 3 CSE354 chunks today in my tasks',question:{id:'b'.repeat(64),reason:'task_topics',question:'Should these study chunks use specific topics, or just general chunks? Give the task names, or say “just general chunks”.'},receipt:{version:1,key:root,outcome:'question',line:'Details needed',verified:0,expected:null,targets:[]}} satisfies ConversationView
const targets:ConversationView['receipt']['targets']=['Lectures','practice problems','review'].map((title,i)=>({kind:'task',id:`synthetic-task-${i}`,action:'added',title:`CSE354: ${title}`,date:'2026-11-07',state:'applied',verification:'verified',before:{},after:{title:`CSE354: ${title}`,date:'2026-11-07',completed:false,deleted:false,important:false}}))
const complete={version:1,rootKey:root,turnKey:turn,expiresAt:question.expiresAt,questions:1,receipt:{version:1,key:turn,outcome:'complete',line:'Added 3/3 tasks · 2026-11-07',verified:3,expected:3,targets}} satisfies ConversationView
const response=(v:unknown)=>new Response(JSON.stringify(v))
const forTurn=(fixture:ConversationView)=>async(_input:unknown,init?:RequestInit)=>{
  const b=JSON.parse(String(init?.body)),key=b.key
  return response({...fixture,rootKey:b.rootKey??key,turnKey:key,receipt:{...fixture.receipt,key}})
}
const input=()=>screen.getByRole('textbox')
const submit=()=>fireEvent.submit(input().closest('form')!)
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.mocked(protectedFetch).mockReset()})
afterEach(()=>cleanup())
test('compact → linked question → answer → confirmed collapse and inspectable distinct record details',async()=>{
  expect(validConversationView(question)).toBe(true);expect(validConversationView(complete)).toBe(true)
  vi.mocked(protectedFetch).mockImplementationOnce(forTurn(question)).mockImplementationOnce(forTurn(complete))
  render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);expect(screen.queryByRole('button')).toBeNull()
  fireEvent.change(input(),{target:{value:question.original}});submit()
  await screen.findByText(question.question.question);expect(screen.getByText(`Original request: ${question.original}`)).toBeVisible()
  fireEvent.change(input(),{target:{value:'Lectures, practice problems, and review'}});submit()
  await screen.findByText(complete.receipt.line);expect(screen.queryByText(question.question.question)).toBeNull();expect(input()).toHaveValue('')
  const sent=JSON.parse(String(vi.mocked(protectedFetch).mock.calls[1][1]?.body))
  const first=JSON.parse(String(vi.mocked(protectedFetch).mock.calls[0][1]?.body))
  expect(sent).toMatchObject({op:'answer',rootKey:first.key,parentKey:first.key,questionId:question.question.id,answer:'Lectures, practice problems, and review'})
  fireEvent.click(screen.getByText('View'));expect(screen.getByText('added: CSE354: Lectures')).toBeVisible();expect(screen.getByText(/synthetic-task-2/)).toBeVisible()
  expect(sessionStorage.getItem(`dcc.hermes.conversation.v1.${owner}`)).not.toContain(question.original)
})
test('partial stays visible/editable and is never silently resent',async()=>{
  const partial={...complete,receipt:{...complete.receipt,outcome:'partial',line:'Incomplete: 2/3 tasks verified.',verified:2,targets:targets.slice(0,2)}} satisfies ConversationView
  vi.mocked(protectedFetch).mockImplementation(forTurn(partial))
  render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);fireEvent.change(input(),{target:{value:'Add 3 tasks today: Lectures; practice problems; review'}});submit()
  await screen.findByText(partial.receipt.line);expect(input()).toBeEnabled();submit()
  expect(protectedFetch).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('may already have effects')
  fireEvent.change(input(),{target:{value:''}});expect(input()).toHaveValue('')
})
test('reload reads receipts only; typing and auth changes fence late replies',async()=>{
  let finish!:(v:Response)=>void
  vi.mocked(protectedFetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const first=render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);fireEvent.change(input(),{target:{value:'Initial text'}});submit()
  fireEvent.change(input(),{target:{value:'My new draft'}});finish(response(complete))
  await waitFor(()=>expect(input()).toHaveValue('My new draft'));expect(screen.queryByText(complete.receipt.line)).toBeNull()
  first.unmount();render(<HermesConversation owner={owner} onCreated={vi.fn()}/>)
  await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse(String(vi.mocked(protectedFetch).mock.calls[1][1]?.body)).op).toBe('read')
  window.dispatchEvent(new Event('dcc-auth-required'));finish(response(complete))
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Sign-in changed'));expect(screen.queryByText(complete.receipt.line)).toBeNull()
})
test('forged completion with only two distinct targets is rejected',()=>{
  expect(validConversationView({...complete,receipt:{...complete.receipt,targets:targets.slice(0,2)}})).toBe(false)
})
test('reload receipt-only read preserves an unsent answer to the same typed question',async()=>{
  let q=question
  vi.mocked(protectedFetch).mockImplementation(async(_path,init)=>{
    const body=JSON.parse(String(init?.body))
    if(body.op==='start')q={...question,rootKey:body.key,turnKey:body.key,receipt:{...question.receipt,key:body.key}}
    else expect(body.op).toBe('read')
    return response(q)
  })
  const first=render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);fireEvent.change(input(),{target:{value:question.original}});submit()
  await screen.findByText(question.question.question);fireEvent.change(input(),{target:{value:'Unsent names stay here'}})
  first.unmount();render(<HermesConversation owner={owner} onCreated={vi.fn()}/>)
  await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2));await waitFor(()=>expect(input()).toHaveValue('Unsent names stay here'))
})
test('explicit receipt check can confirm old effects without clearing a newly edited draft',async()=>{
  let key=''
  vi.mocked(protectedFetch).mockImplementation(async(_path,init)=>{
    const body=JSON.parse(String(init?.body))
    if(body.op==='start'){
      key=body.key;return response({...complete,rootKey:key,turnKey:key,receipt:{...complete.receipt,key,outcome:'uncertain',line:'Readback unavailable; effects may have saved.',verified:0,targets:[]}})
    }
    expect(body.op).toBe('read');return response({...complete,rootKey:key,turnKey:key,receipt:{...complete.receipt,key}})
  })
  render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);fireEvent.change(input(),{target:{value:'Add 3 tasks today: Lectures; practice problems; review'}});submit()
  await screen.findByText('Readback unavailable; effects may have saved.')
  fireEvent.change(input(),{target:{value:'My deliberate new draft'}});fireEvent.click(screen.getByRole('button',{name:'Check receipt'}))
  await screen.findByText(complete.receipt.line);expect(input()).toHaveValue('My deliberate new draft');expect(protectedFetch).toHaveBeenCalledTimes(2)
})
test('read-only effects leave the query editable and do not certify a mixed mutation request',async()=>{
  const readonly={...complete,receipt:{...complete.receipt,outcome:'read-only',line:'Read-only effects checked; no writes. Full requested scope is not certified.',verified:0,expected:null,targets:[]}} satisfies ConversationView
  vi.mocked(protectedFetch).mockImplementation(forTurn(readonly))
  render(<HermesConversation owner={owner} onCreated={vi.fn()}/>);fireEvent.change(input(),{target:{value:'Show tasks and then remove them'}});submit()
  await screen.findByText(readonly.receipt.line);expect(input()).toHaveValue('Show tasks and then remove them');expect(input()).toBeEnabled()
  expect(screen.queryByText('Added 3/3 tasks · 2026-11-07')).toBeNull()
})
test.each(['question','error'] as const)('restored answer fences an older receipt read (%s) without another edit',async(late)=>{
  const answer='Lectures, practice problems, and review'
  sessionStorage.setItem(`dcc.hermes.conversation.v1.${owner}`,JSON.stringify({clientId:'11111111-1111-4111-a111-111111111111',rootKey:root,original:question.original,answer,usedChars:question.original.length,usedBytes:new TextEncoder().encode(question.original).length,expiresAt:question.expiresAt,view:question}))
  let resolve!:(value:Response)=>void,reject!:(reason:Error)=>void
  const oldRead=new Promise<Response>((yes,no)=>{resolve=yes;reject=no})
  vi.mocked(protectedFetch).mockImplementationOnce(()=>oldRead).mockImplementationOnce(forTurn(complete))
  const created=vi.fn()
  render(<HermesConversation owner={owner} onCreated={created}/>)
  await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(1))
  expect(input()).toHaveValue(answer);submit() // Deliberately no intervening edit.
  await screen.findByText(complete.receipt.line)
  const saved=sessionStorage.getItem(`dcc.hermes.conversation.v1.${owner}`)
  await act(async()=>{if(late==='question')resolve(response(question));else reject(Error('Old read failed'));await Promise.resolve()})
  expect(screen.getByText(complete.receipt.line)).toBeVisible()
  expect(screen.queryByText(question.question.question)).toBeNull();expect(input()).toHaveValue('')
  expect(screen.getByRole('status')).toHaveTextContent('Hermes ready')
  expect(sessionStorage.getItem(`dcc.hermes.conversation.v1.${owner}`)).toBe(saved)
  expect(JSON.parse(sessionStorage.getItem(`dcc.hermes.conversation.v1.${owner}.receipt`)!)).toMatchObject({outcome:'complete',verified:3,expected:3})
  expect(vi.mocked(protectedFetch).mock.calls.map(([,init])=>JSON.parse(String(init?.body)).op)).toEqual(['read','answer'])
  expect(created).toHaveBeenCalledTimes(1)
})
