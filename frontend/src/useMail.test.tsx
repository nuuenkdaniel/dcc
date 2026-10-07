import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useMail} from './useMail'

const mocks=vi.hoisted(()=>({protectedFetch:vi.fn(),pages:new Map<string,unknown>(),bodies:new Map<string,string>(),writes:0,failWrites:false,failBodyWrites:false,patches:[] as {id:string;override:boolean|null}[]}))
vi.mock('./auth',()=>({protectedFetch:mocks.protectedFetch,AUTH_REQUIRED_EVENT:'dcc-auth-required'}))
vi.mock('./mailStorage',()=>({
 DEFAULT_MAIL_PAGE_KEY:'account=all&q=&important=false',LEGACY_MAIL_PAGE_KEY:'__legacy_snapshot_archive__',migrateLegacyMail:vi.fn(async()=>{}),
 readMailPage:vi.fn(async(key:string)=>mocks.pages.get(key)),writeMailPage:vi.fn(async(key:string,value:unknown)=>{mocks.writes++;if(mocks.failWrites)throw Error('storage');mocks.pages.set(key,value)}),
 readMailBody:vi.fn(async(id:string)=>mocks.bodies.get(id)),writeMailBody:vi.fn(async(id:string,body:string)=>{if(mocks.failBodyWrites)throw Error('body storage');mocks.bodies.set(id,body)}),
 patchMailOverride:vi.fn(async(id:string,override:boolean|null)=>{mocks.patches.push({id,override})}),
}))

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response
const message=(id:string,receivedAt='2026-10-06T12:00:00Z')=>({data:{id,account:'personal',address:'me@example.test',subject:'Subject '+id,sender:'sender',to:'me',receivedAt,bodyNotice:'',unread:false,attachments:[]},analysis:null,override:null})
const page=(messages:ReturnType<typeof message>[],nextCursor:string|null=null,total=messages.length)=>({messages,nextCursor,total,accounts:[],today:'2026-10-06',briefing:[]})
const settle=async()=>{await act(async()=>{for(let index=0;index<12;index++)await Promise.resolve()})}

function Probe({enabled=true}:{enabled?:boolean}){const mail=useMail(enabled);return <><span data-testid="subjects">{mail.snapshot.messages.map(item=>item.data.subject).join(',')}</span><span data-testid="status">{mail.message}</span><span data-testid="total">{mail.total}</span><span data-testid="body">{mail.snapshot.messages[0]?.data.body}</span><span data-testid="override">{String(mail.snapshot.messages[0]?.override)}</span><span data-testid="cached-older">{mail.cachedOlderMessages.map(item=>item.data.id).join(',')}</span><button onClick={()=>void mail.loadMore()}>More</button><button onClick={()=>void mail.setFilters({account:'all',search:'needle',important:false})}>Search</button><button onClick={()=>void mail.setFilters({account:'work',search:'',important:true})}>Other filter</button><button onClick={()=>void mail.refresh(true)}>Manual</button><button onClick={()=>void mail.feedback(mail.snapshot.messages[0]?.data.id??'missing',true)}>Feedback</button><button onClick={()=>void mail.feedback(mail.snapshot.messages[0]?.data.id??'missing',false)}>Feedback false</button><button onClick={()=>void mail.loadBody(mail.snapshot.messages[0]?.data.id??'missing').catch(()=>{})}>Body</button><button onClick={()=>void Promise.all([mail.loadBody(mail.snapshot.messages[0]?.data.id??'missing'),mail.loadBody(mail.snapshot.messages[0]?.data.id??'missing')]).catch(()=>{})}>Body twice</button></>}

beforeEach(()=>{mocks.protectedFetch.mockReset();mocks.pages.clear();mocks.bodies.clear();mocks.writes=0;mocks.failWrites=false;mocks.failBodyWrites=false;mocks.patches=[];Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})})
afterEach(()=>{vi.useRealTimers()})

it('restores a paged cache while disabled and starts networking only when enabled',async()=>{
 mocks.pages.set('account=all&q=&important=false',page([message('cached')]) );mocks.protectedFetch.mockResolvedValue(response(page([message('network')])))
 const view=render(<Probe enabled={false}/>);await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('cached');expect(mocks.protectedFetch).not.toHaveBeenCalled()
 view.rerender(<Probe/>);await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('network');expect(mocks.protectedFetch).toHaveBeenCalledTimes(1)
})

it('keeps manual refresh and feedback available while automatic polling is disabled',async()=>{
 mocks.pages.set('account=all&q=&important=false',page([message('cached')]));mocks.protectedFetch.mockImplementation((input)=>Promise.resolve(response(String(input).endsWith('/refresh')||String(input).endsWith('/feedback')?{saved:true}:page([message('manual')]))))
 render(<Probe enabled={false}/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Manual'}));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('manual');expect(mocks.protectedFetch.mock.calls.some(([input,init])=>String(input).endsWith('/refresh')&&(init as RequestInit).method==='POST')).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:/^Feedback$/}));await settle();expect(mocks.protectedFetch.mock.calls.some(([input])=>String(input).endsWith('/feedback'))).toBe(true)
})

it('allows an in-flight manual refresh to finish while the document is hidden',async()=>{
 mocks.pages.set('account=all&q=&important=false',page([message('cached')]));let release!:(value:Response)=>void,manualSignal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((input,init)=>{if(String(input).endsWith('/refresh')){manualSignal=(init as RequestInit).signal as AbortSignal;return new Promise<Response>(resolve=>{release=resolve})}return Promise.resolve(response(page([message('manual-finished')])))})
 render(<Probe enabled={false}/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Manual'}));await settle();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));expect(manualSignal?.aborted).toBe(false);release(response({queued:true}));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('manual-finished')
})

it('deduplicates the page request when manual refresh overtakes an automatic load',async()=>{
 let releasePage!:(value:Response)=>void,pageSignal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((input,init)=>String(input).endsWith('/refresh')?Promise.resolve(response({queued:true})):(pageSignal=(init as RequestInit).signal as AbortSignal,new Promise<Response>(resolve=>{releasePage=resolve})))
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Manual'}));await settle();expect(mocks.protectedFetch.mock.calls.filter(([input])=>String(input).includes('/mail/page'))).toHaveLength(1);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));expect(pageSignal?.aborted).toBe(false);releasePage(response(page([message('shared-result')])));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('shared-result')
})

it('loads a capped first page and appends stable cursor pages without duplicates',async()=>{
 const all=Array.from({length:205},(_,index)=>message(String(index),'2026-10-06T12:00:00Z'))
 mocks.protectedFetch.mockImplementation((input)=>{const cursor=new URL(String(input),'https://test').searchParams.get('cursor');return Promise.resolve(response(cursor==='second'?page([...all.slice(99,199)],'third',205):cursor==='third'?page(all.slice(199),null,205):page(all.slice(0,100),'second',205)))})
 render(<Probe/>);await settle();expect(screen.getByTestId('subjects').textContent?.split(',')).toHaveLength(100);expect(screen.getByTestId('total')).toHaveTextContent('205')
 fireEvent.click(screen.getByRole('button',{name:'More'}));await settle();expect(screen.getByTestId('subjects').textContent?.split(',')).toHaveLength(199)
 fireEvent.click(screen.getByRole('button',{name:'More'}));await settle();const subjects=screen.getByTestId('subjects').textContent!.split(',');expect(subjects).toHaveLength(205);expect(new Set(subjects).size).toBe(205)
})

it('sends search/account/important filters to the server so an unloaded result is found',async()=>{
 mocks.protectedFetch.mockImplementation((input)=>{const url=new URL(String(input),'https://test');return Promise.resolve(response(url.searchParams.get('q')==='needle'?page([message('unloaded-204')],null,1):url.searchParams.get('account')==='work'?page([message('work-important')],null,1):page(Array.from({length:100},(_,index)=>message(String(index))),'next',205)))})
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Search'}));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('unloaded-204');expect(mocks.protectedFetch.mock.calls.some(([input])=>String(input).includes('q=needle'))).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Other filter'}));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('work-important');expect(mocks.protectedFetch.mock.calls.some(([input])=>String(input).includes('account=work')&&String(input).includes('important=true'))).toBe(true)
})

it('ignores stale filter responses and deduplicates matching metadata requests',async()=>{
 let releaseSearch!:(value:Response)=>void
 mocks.protectedFetch.mockImplementation((input)=>{const url=String(input);if(url.includes('q=needle'))return new Promise<Response>(resolve=>{releaseSearch=resolve});if(url.includes('account=work'))return Promise.resolve(response(page([message('new-filter')])));return Promise.resolve(response(page([message('initial')])))})
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(screen.getByRole('button',{name:'Search'}));await settle();expect(mocks.protectedFetch.mock.calls.filter(([input])=>String(input).includes('q=needle'))).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Other filter'}));await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('new-filter');releaseSearch(response(page([message('stale-search')])));await settle();expect(screen.getByTestId('subjects')).not.toHaveTextContent('stale-search')
})

it('loads a body only on demand, reuses offline cached bodies, and deduplicates requests',async()=>{
 mocks.bodies.set('cached','Legacy offline body');mocks.protectedFetch.mockImplementation((input)=>String(input).includes('/message/')?Promise.resolve(response({id:'network',body:'Network body'})):Promise.resolve(response(page([message('cached')]))))
 const cached=render(<Probe/>);await settle();expect(screen.getByTestId('body')).toBeEmptyDOMElement();fireEvent.click(screen.getByRole('button',{name:'Body'}));await settle();expect(screen.getByTestId('body')).toHaveTextContent('Legacy offline body');expect(mocks.protectedFetch.mock.calls.filter(([input])=>String(input).includes('/message/'))).toHaveLength(0);cached.unmount()
 mocks.bodies.clear();mocks.protectedFetch.mockReset();let release!:(value:Response)=>void;mocks.protectedFetch.mockImplementation((input)=>String(input).includes('/message/')?new Promise<Response>(resolve=>{release=resolve}):Promise.resolve(response(page([message('network')]))))
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Body twice'}));await settle();expect(mocks.protectedFetch.mock.calls.filter(([input])=>String(input).includes('/message/'))).toHaveLength(1);release(response({id:'network',body:'Network body'}));await settle();expect(screen.getAllByTestId('body').at(-1)).toHaveTextContent('Network body')
})

it('keeps an opened body hydrated across metadata refresh when durable body storage fails',async()=>{
 mocks.failBodyWrites=true;mocks.protectedFetch.mockImplementation(input=>String(input).includes('/message/')?Promise.resolve(response({id:'open',body:'Memory-only body'})):Promise.resolve(response(page([message('open')]))))
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Body'}));await settle();expect(screen.getByTestId('body')).toHaveTextContent('Memory-only body')
 window.dispatchEvent(new Event('online'));await settle();expect(screen.getByTestId('body')).toHaveTextContent('Memory-only body');fireEvent.click(screen.getByRole('button',{name:'Body'}));await settle();expect(mocks.protectedFetch.mock.calls.filter(([input])=>String(input).includes('/message/'))).toHaveLength(1)
})

it('keeps retained legacy rows separate from a successful one-row server page',async()=>{
 const archive=page([message('legacy-older')]);mocks.pages.set('__legacy_snapshot_archive__',archive);mocks.protectedFetch.mockResolvedValue(response(page([message('current')],null,1)))
 render(<Probe/>);await settle();expect(screen.getByTestId('subjects')).toHaveTextContent('current');expect(screen.getByTestId('total')).toHaveTextContent('1');expect(screen.getByTestId('cached-older')).toHaveTextContent('legacy-older')
})

it('applies saved feedback immediately and reports metadata refresh failure separately',async()=>{
 let pages=0;const item=message('feedback');mocks.protectedFetch.mockImplementation(input=>{if(String(input).endsWith('/feedback'))return Promise.resolve(response({saved:true}));pages++;return pages===1?Promise.resolve(response({...page([item]),briefing:[item]})):Promise.reject(Error('metadata offline'))})
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:/^Feedback$/}));await settle();expect(screen.getByTestId('override')).toHaveTextContent('true');expect(mocks.patches).toEqual([{id:'feedback',override:true}]);expect(screen.getByTestId('status')).toHaveTextContent(/saved and shown, but mailbox metadata could not refresh/i)
})

it('does not let an older feedback response overwrite a newer request',async()=>{
 let releaseTrue!:(value:Response)=>void,releaseFalse!:(value:Response)=>void;mocks.protectedFetch.mockImplementation((input,init)=>{if(!String(input).endsWith('/feedback'))return Promise.resolve(response(page([message('race')])));const important=JSON.parse(String((init as RequestInit).body)).important;return new Promise<Response>(resolve=>{if(important)releaseTrue=resolve;else releaseFalse=resolve})})
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:/^Feedback$/}));fireEvent.click(screen.getByRole('button',{name:'Feedback false'}));await settle();releaseFalse(response({saved:true}));await settle();expect(screen.getByTestId('override')).toHaveTextContent('false');releaseTrue(response({saved:true}));await settle();expect(screen.getByTestId('override')).toHaveTextContent('false');expect(mocks.patches).toEqual([{id:'race',override:false}])
})

it('reports metadata and body failures with an honest offline search message',async()=>{
 mocks.protectedFetch.mockResolvedValueOnce(response(page([message('initial')]))).mockRejectedValueOnce(Error('offline')).mockRejectedValueOnce(Error('body offline'))
 render(<Probe/>);await settle();fireEvent.click(screen.getByRole('button',{name:'Search'}));await settle();expect(screen.getByTestId('status')).toHaveTextContent(/search is limited to messages saved/i)
 fireEvent.click(screen.getByRole('button',{name:'Body'}));await settle();expect(mocks.protectedFetch.mock.calls.some(([input,init])=>String(input).includes('/message/')&&(init as RequestInit).signal instanceof AbortSignal)).toBe(true)
})

it('skips unchanged paged-cache writes and reports a durable-storage failure separately',async()=>{
 const cached=page([message('same')]);mocks.pages.set('account=all&q=&important=false',cached);mocks.protectedFetch.mockResolvedValue(response(cached))
 render(<Probe/>);await settle();expect(mocks.writes).toBe(0)
 mocks.failWrites=true;mocks.protectedFetch.mockResolvedValue(response(page([message('changed')])));window.dispatchEvent(new Event('online'));await settle()
 expect(mocks.writes).toBe(1);expect(screen.getByTestId('subjects')).toHaveTextContent('changed');expect(screen.getByTestId('status')).toHaveTextContent(/cache could not be saved/i)
})

it.each(['hidden','navigation','logout','unmount'] as const)('aborts and ignores an in-flight metadata response after %s',async(action)=>{
 let resolveRequest!:(value:Response)=>void,signal:AbortSignal|undefined
 mocks.protectedFetch.mockImplementation((_input,init)=>{signal=(init as RequestInit).signal as AbortSignal;return new Promise<Response>(resolve=>{resolveRequest=resolve})})
 const view=render(<Probe/>);await settle();expect(signal?.aborted).toBe(false)
 if(action==='hidden'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))}
 if(action==='navigation')view.rerender(<Probe enabled={false}/>)
 if(action==='logout')window.dispatchEvent(new Event('dcc-auth-required'))
 if(action==='unmount')view.unmount()
 expect(signal?.aborted).toBe(true);resolveRequest(response(page([message('late')])));await settle();expect(mocks.writes).toBe(0)
 if(action!=='unmount')expect(screen.getByTestId('subjects')).not.toHaveTextContent('late')
})
