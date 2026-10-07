import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {Inbox} from './Inbox'
import type {MailState} from './useMail'

afterEach(()=>{vi.unstubAllGlobals();window.history.replaceState({},'','/')})

function mailState():MailState{return {snapshot:{messages:[{data:{id:'a'.repeat(64),account:'school',address:'student@example.invalid',subject:'Synthetic HTML',sender:'Sender',to:'Recipient',receivedAt:'2026-10-06T12:00:00Z',body:'Text fallback',bodyNotice:'',unread:true,hasHtml:true,attachments:[]},analysis:null,override:null}],accounts:[],today:'2026-10-06',briefing:[]},message:'Ready',busy:false,loadingMore:false,total:1,nextCursor:null,cachedOlderMessages:[],bodyStates:{},setFilters:vi.fn(),loadMore:vi.fn(),loadBody:vi.fn(),refresh:vi.fn(),feedback:vi.fn()} as unknown as MailState}

it('does not request HTML while collapsed and shares an in-flight request across reopen',async()=>{
 window.history.replaceState({},'','/inbox')
 let resolveRequest!:(response:Response)=>void,signal:AbortSignal|undefined
 const fetchMock=vi.fn((_url:string,options?:RequestInit)=>{signal=options?.signal as AbortSignal;return new Promise<Response>(resolve=>{resolveRequest=resolve})})
 vi.stubGlobal('fetch',fetchMock)
 const {container}=render(<Inbox mail={mailState()}/>)
 const details=container.querySelector<HTMLDetailsElement>('.email-card')!
 expect(details.open).toBe(false);expect(fetchMock).not.toHaveBeenCalled()
 details.open=true;fireEvent(details,new Event('toggle'))
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1))
 expect(signal?.aborted).toBe(false)
 details.open=false;fireEvent(details,new Event('toggle'))
 expect(signal?.aborted).toBe(false)
 details.open=true;fireEvent(details,new Event('toggle'))
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1))
 resolveRequest({ok:true,json:async()=>({html:'<p>Cached formatted message</p>'})} as Response)
 expect(await screen.findByTitle('Formatted email')).toBeInTheDocument()
 expect(fetchMock).toHaveBeenCalledTimes(1)
 details.open=false;fireEvent(details,new Event('toggle'))
 details.open=true;fireEvent(details,new Event('toggle'))
 expect(screen.getByTitle('Formatted email')).toBeInTheDocument()
 expect(screen.queryByText('Loading formatted view…')).not.toBeInTheDocument()
 expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('keeps all collapsed messages ineligible for HTML retrieval',()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 const state=mailState(),copy=structuredClone(state.snapshot.messages[0]);copy.data.id='b'.repeat(64);copy.data.subject='Second message';state.snapshot.messages.push(copy)
 const {container}=render(<Inbox mail={state}/>)
 expect(container.querySelectorAll('.email-card')).toHaveLength(2)
 expect(fetchMock).not.toHaveBeenCalled()
})

it('discloses retained older cache separately without inflating the server count',()=>{
 const state=mailState(),older=structuredClone(state.snapshot.messages[0]);older.data.id='legacy';older.data.subject='Cached legacy message';state.cachedOlderMessages=[older];state.total=1
 render(<Inbox mail={state}/>);expect(screen.getByText('1 current mailbox messages',{exact:false})).toBeVisible();expect(screen.queryByText('Cached legacy message',{exact:true})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Show cached older mail (1)'}));expect(screen.getByText('Cached legacy message',{exact:true})).toBeVisible();expect(screen.getByText(/separate from the current server count/i)).toBeVisible()
})
