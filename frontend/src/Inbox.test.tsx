import {fireEvent,render,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Inbox} from './Inbox'
import type {MailState} from './useMail'

afterEach(()=>{vi.unstubAllGlobals();window.history.replaceState({},'','/')})

function mailState():MailState{return {snapshot:{messages:[{data:{id:'a'.repeat(64),account:'school',address:'student@example.invalid',subject:'Synthetic HTML',sender:'Sender',to:'Recipient',receivedAt:'2026-10-06T12:00:00Z',body:'Text fallback',bodyNotice:'',unread:true,hasHtml:true,attachments:[]},analysis:null,override:null}],accounts:[],today:'2026-10-06'},message:'Ready',busy:false,refresh:vi.fn(),feedback:vi.fn()} as unknown as MailState}

it('does not request HTML while collapsed and aborts an in-flight request on collapse',async()=>{
 window.history.replaceState({},'','/inbox')
 let signal:AbortSignal|undefined
 const fetchMock=vi.fn((_url:string,options?:RequestInit)=>{signal=options?.signal as AbortSignal;return new Promise<Response>(()=>{})})
 vi.stubGlobal('fetch',fetchMock)
 const {container}=render(<Inbox mail={mailState()}/>)
 const details=container.querySelector<HTMLDetailsElement>('.email-card')!
 expect(details.open).toBe(false);expect(fetchMock).not.toHaveBeenCalled()
 details.open=true;fireEvent(details,new Event('toggle'))
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1))
 expect(signal?.aborted).toBe(false)
 details.open=false;fireEvent(details,new Event('toggle'))
 await waitFor(()=>expect(signal?.aborted).toBe(true))
 expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('keeps all collapsed messages ineligible for HTML retrieval',()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 const state=mailState(),copy=structuredClone(state.snapshot.messages[0]);copy.data.id='b'.repeat(64);copy.data.subject='Second message';state.snapshot.messages.push(copy)
 const {container}=render(<Inbox mail={state}/>)
 expect(container.querySelectorAll('.email-card')).toHaveLength(2)
 expect(fetchMock).not.toHaveBeenCalled()
})
