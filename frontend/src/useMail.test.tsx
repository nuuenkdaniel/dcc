import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useMail} from './useMail'

const mocks=vi.hoisted(()=>({protectedFetch:vi.fn()}))
vi.mock('./auth',()=>({protectedFetch:mocks.protectedFetch,AUTH_REQUIRED_EVENT:'dcc-auth-required'}))

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response
const message=(id:string)=>({data:{id,account:'personal',address:'me@example.test',subject:id,sender:'sender',to:'me',receivedAt:'2026-10-06T12:00:00Z',body:'',bodyNotice:'',unread:false,attachments:[]},analysis:null,override:null})
const snapshot=(id?:string)=>({messages:id?[message(id)]:[],accounts:[],today:'2026-10-06'})

function fakeIndexedDb(initial?:unknown,{delayRead=false,failWrite=false}:{delayRead?:boolean;failWrite?:boolean}={}){
 let value=initial,writes=0,reads=0,releaseRead=()=>{}
 const factory={open:()=>{const request:any={};queueMicrotask(()=>{const db={createObjectStore:()=>({}),close:()=>{},transaction:(_name:string,mode:string)=>{const tx:any={};const complete=()=>queueMicrotask(()=>failWrite&&mode==='readwrite'?tx.onerror?.():tx.oncomplete?.());return { ...tx,objectStore:()=>({get:()=>{reads++;const op:any={result:value};if(delayRead){releaseRead=complete}else complete();return op},put:(next:unknown)=>{writes++;value=next;complete();return {result:undefined}}}),set oncomplete(fn:unknown){tx.oncomplete=fn},set onerror(fn:unknown){tx.onerror=fn},get error(){return failWrite?new Error('storage failed'):null}}}};request.result=db;request.onsuccess?.()});return request}} as unknown as IDBFactory
 vi.stubGlobal('indexedDB',factory)
 return {get writes(){return writes},get reads(){return reads},releaseRead:()=>releaseRead()}
}

function Probe({enabled}:{enabled:boolean}){const mail=useMail(enabled);return <><span data-testid="message">{mail.message}</span><span data-testid="subjects">{mail.snapshot.messages.map(m=>m.data.subject).join(',')}</span><button onClick={()=>void mail.refresh(true)}>Manual</button><button onClick={()=>void mail.feedback('message',true)}>Feedback</button></>}
const settle=async()=>{await act(async()=>{for(let i=0;i<8;i++)await Promise.resolve()})}
const visibility=(value:'visible'|'hidden')=>Object.defineProperty(document,'visibilityState',{configurable:true,value})

beforeEach(()=>{mocks.protectedFetch.mockReset();visibility('visible')})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();visibility('visible')})

it('restores cache while disabled and only polls in the visible Inbox lifecycle',async()=>{
 vi.useFakeTimers();fakeIndexedDb(snapshot('cached'));mocks.protectedFetch.mockResolvedValue(response(snapshot('network')))
 const view=render(<Probe enabled={false}/>);await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('cached');expect(mocks.protectedFetch).not.toHaveBeenCalled()
 view.rerender(<Probe enabled/>);await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
 await act(async()=>vi.advanceTimersByTime(30_000));await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(2)
 visibility('hidden');document.dispatchEvent(new Event('visibilitychange'));await act(async()=>vi.advanceTimersByTime(60_000));await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(2)
 visibility('visible');document.dispatchEvent(new Event('visibilitychange'));await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(3)
 window.dispatchEvent(new Event('online'));await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(4)
})

it('keeps manual refresh and feedback callable while automatic polling is disabled',async()=>{
 fakeIndexedDb();mocks.protectedFetch.mockImplementation((input)=>Promise.resolve(response(String(input).endsWith('/snapshot')?snapshot('manual'):{saved:true})))
 render(<Probe enabled={false}/>);await settle();expect(mocks.protectedFetch).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Manual'}));await settle()
 const manual=mocks.protectedFetch.mock.calls.find(([input])=>String(input).endsWith('/refresh'))
 expect(manual).toBeDefined();expect(manual![1]).toMatchObject({method:'POST'});expect((manual![1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
 fireEvent.click(screen.getByRole('button',{name:'Feedback'}));await settle()
 expect(mocks.protectedFetch.mock.calls.some(([input])=>String(input).endsWith('/feedback'))).toBe(true)
})

it('deduplicates automatic refresh while preserving a queued manual request',async()=>{
 fakeIndexedDb();let resolveFirst:(value:Response)=>void=()=>{}
 mocks.protectedFetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveFirst=resolve})).mockResolvedValue(response(snapshot('manual-after-auto')))
 render(<Probe enabled/>);await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'Manual'}));expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
 resolveFirst(response(snapshot('automatic')));await settle()
 expect(mocks.protectedFetch.mock.calls.some(([input,init])=>String(input).endsWith('/refresh')&&(init as RequestInit)?.method==='POST')).toBe(true)
})

it('skips unchanged IndexedDB writes and reports persistence failure separately',async()=>{
 const cached=snapshot('same'),db=fakeIndexedDb(cached);mocks.protectedFetch.mockResolvedValueOnce(response(cached)).mockResolvedValueOnce(response(snapshot('changed')))
 const first=render(<Probe enabled/>);await settle();expect(db.writes).toBe(0)
 window.dispatchEvent(new Event('online'));await settle();expect(db.writes).toBe(1)
 first.unmount()
 const failing=fakeIndexedDb(snapshot('old'),{failWrite:true});mocks.protectedFetch.mockResolvedValue(response(snapshot('new')))
 render(<Probe enabled/>);await settle();expect(failing.writes).toBe(1);expect(screen.getAllByTestId('message').at(-1)).toHaveTextContent(/cache could not be saved/i)
})

it('aborts and ignores an in-flight refresh after unmount',async()=>{
 const db=fakeIndexedDb(),deferred:{resolve?:(value:Response)=>void}={};let signal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((_input,_init)=>{signal=(_init as RequestInit)?.signal as AbortSignal;return new Promise<Response>(resolve=>{deferred.resolve=resolve})})
 const view=render(<Probe enabled/>);await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
 view.unmount();expect(signal?.aborted).toBe(true);deferred.resolve?.(response(snapshot('late')));await settle();expect(db.writes).toBe(0)
})

it('aborts and ignores a delayed automatic refresh when leaving a mail view',async()=>{
 const db=fakeIndexedDb(),deferred:{resolve?:(value:Response)=>void}={};let signal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((_input,init)=>{signal=(init as RequestInit)?.signal as AbortSignal;return new Promise<Response>(resolve=>{deferred.resolve=resolve})})
 const view=render(<Probe enabled/>);await settle();expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
 view.rerender(<Probe enabled={false}/>);expect(signal?.aborted).toBe(true)
 deferred.resolve?.(response(snapshot('late-navigation')));await settle();expect(db.writes).toBe(0);expect(screen.getByTestId('subjects')).not.toHaveTextContent('late-navigation')
})

it('aborts and ignores a delayed automatic refresh when the document becomes hidden',async()=>{
 const db=fakeIndexedDb(),deferred:{resolve?:(value:Response)=>void}={};let signal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((_input,init)=>{signal=(init as RequestInit)?.signal as AbortSignal;return new Promise<Response>(resolve=>{deferred.resolve=resolve})})
 render(<Probe enabled/>);await settle();visibility('hidden');document.dispatchEvent(new Event('visibilitychange'));expect(signal?.aborted).toBe(true)
 deferred.resolve?.(response(snapshot('late-hidden')));await settle();expect(db.writes).toBe(0);expect(screen.getByTestId('subjects')).not.toHaveTextContent('late-hidden')
})

it('allows an in-flight manual refresh to finish after the document becomes hidden',async()=>{
 const db=fakeIndexedDb();let releaseManual:(value:Response)=>void=()=>{},manualSignal:AbortSignal|undefined,snapshots=0
 mocks.protectedFetch.mockImplementation((input,init)=>{
  if(String(input).endsWith('/refresh')){manualSignal=(init as RequestInit)?.signal as AbortSignal;return new Promise<Response>(resolve=>{releaseManual=resolve})}
  snapshots++;return Promise.resolve(response(snapshot(snapshots===1?'initial':'manual-finished')))
 })
 render(<Probe enabled/>);await settle();const writesBefore=db.writes
 fireEvent.click(screen.getByRole('button',{name:'Manual'}));await settle();visibility('hidden');document.dispatchEvent(new Event('visibilitychange'))
 expect(manualSignal?.aborted).toBe(false);releaseManual(response({queued:true}));await settle()
 expect(screen.getByTestId('subjects')).toHaveTextContent('manual-finished');expect(db.writes).toBe(writesBefore+1)
})

it('aborts and ignores an in-flight refresh when logout is reported',async()=>{
 const db=fakeIndexedDb(),deferred:{resolve?:(value:Response)=>void}={};let signal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((_input,init)=>{signal=(init as RequestInit)?.signal as AbortSignal;return new Promise<Response>(resolve=>{deferred.resolve=resolve})})
 render(<Probe enabled/>);await settle();window.dispatchEvent(new Event('dcc-auth-required'));expect(signal?.aborted).toBe(true)
 deferred.resolve?.(response(snapshot('late-logout')));await settle();expect(db.writes).toBe(0);expect(screen.getByTestId('subjects')).not.toHaveTextContent('late-logout')
})

it('does not let a delayed remount cache restore overwrite a newer network result',async()=>{
 const firstDb=fakeIndexedDb(snapshot('earlier'));const first=render(<Probe enabled={false}/>);await settle();expect(firstDb.reads).toBe(1);first.unmount()
 const db=fakeIndexedDb(snapshot('stale'),{delayRead:true});mocks.protectedFetch.mockResolvedValue(response(snapshot('newest')))
 render(<Probe enabled/>);await settle();expect(db.reads).toBe(1);db.releaseRead();await settle()
 expect(screen.getByTestId('subjects')).toHaveTextContent('newest');expect(screen.getByTestId('subjects')).not.toHaveTextContent('stale');expect(db.writes).toBe(1)
})
