import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {TellHermes} from './TellHermes'
import {protectedFetch} from './auth'
vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
const commandFetch=vi.hoisted(()=>vi.fn())
const STORAGE='dcc.tell-hermes.submission.v1'
let enabled=true
beforeEach(()=>{
 localStorage.clear();enabled=true;commandFetch.mockReset();vi.mocked(protectedFetch).mockReset()
 vi.mocked(protectedFetch).mockImplementation(async(input,init)=>['/api/v1/hermes/capabilities','/api/v1/hermes/action-capabilities'].includes(String(input))?new Response(JSON.stringify({taskActions:enabled,productActions:enabled})):commandFetch(input,init))
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers()})
const command=()=>screen.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
const submit=()=>fireEvent.submit(command().closest('form')!)
const enter=(text='Synthetic request')=>fireEvent.change(command(),{target:{value:text}})
const stored=()=>JSON.parse(localStorage.getItem(STORAGE)!)
const retained=()=>JSON.parse(localStorage.getItem('dcc.tell-hermes.retained.v1')??'[]')
const body=(value:{key:string;prompt:string})=>({key:value.key,prompt:value.prompt})
const applied={tool:'set_task_completed',state:'applied',id:'synthetic-task',version:2}
const summary=(effects:unknown[]=[])=>({phase:'completed',outcome:effects.length?'effects_recorded':'no_effects_recorded',effects,pending:0,reads:[]})
const receipt=(value:unknown)=>new Response(JSON.stringify({message:'Receipts checked.',summary:value}))
const legacyReply={code:200,message:'Legacy receipt saved.',id:'12345678-1234-4234-a234-123456789abc',kind:'task',origin:'hermes'}
function seed(mode?:'legacy'|'tasks'|'actions',settled=false){const value={key:'retained_submission_key_01',prompt:'Synthetic original',...(mode?{mode}:{}),settled};localStorage.setItem(STORAGE,JSON.stringify(value));return value}
async function ready(){await waitFor(()=>{expect(command()).toBeEnabled();if(enabled)expect(screen.getByRole('status')).not.toHaveTextContent('MCP actions are unavailable')})}

test('one visible single-line unified composer, without selector, preview or manual mode choice',async()=>{
 const {container}=render(<TellHermes onCreated={vi.fn()}/>);await ready()
 expect(command()).toBeVisible();expect(command().tagName).toBe('INPUT')
 expect(command()).toHaveAttribute('type','text');expect(command()).toHaveAttribute('placeholder','Hermes')
 expect(command()).toHaveAttribute('required');expect(command()).toHaveAttribute('maxlength','4000')
 expect(container.querySelector('select,details,summary,textarea,button')).toBeNull()
 expect(screen.getByRole('status')).toHaveAttribute('id',command().getAttribute('aria-describedby'))
 submit();expect(commandFetch).not.toHaveBeenCalled()
})

test('fresh request goes directly through MCP, persists before sending and unchanged reload replays its key',async()=>{
 const created=vi.fn();commandFetch.mockImplementation(async()=>receipt(summary([applied])))
 const first=render(<TellHermes onCreated={created}/>);await ready();enter();submit()
 await screen.findByText('DCC actions saved.')
 expect(created).toHaveBeenCalledWith('tasks')
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/actions')
 const original=stored();expect(original.mode).toBe('actions');expect(original.settled).toBe(true)
 expect(original.key).toMatch(/^[a-f0-9-]{36}$/)
 first.unmount();render(<TellHermes onCreated={created}/>);await ready();submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual([body(original),body(original)])
})
test('typed clarification renders without success claims; an edited answer starts a fresh intent',async()=>{
  commandFetch.mockImplementationOnce(async()=>receipt({...summary(),clarifications:[{reason:'missing_duration',question:'How many minutes should this take?'}]})).mockImplementation(async()=>receipt(summary()))
  const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter('Plan a synthetic event');submit()
  await screen.findByText('How many minutes should this take?')
  const old=stored();expect(old.settled).toBe(true);expect(created).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).not.toHaveTextContent(/saved|applied/i)
  enter('Plan a synthetic event for 30 minutes');submit()
  await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse(commandFetch.mock.calls[1][1].body).key).not.toBe(old.key)
})
test('clarification preserves partial applied receipts and rejects arbitrary question prose',async()=>{
  commandFetch.mockImplementationOnce(async()=>receipt({...summary([applied]),clarifications:[{reason:'missing_calendar',question:'Which calendar should I use?'}]}))
  const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter();submit()
  await screen.findByText('Which calendar should I use?')
  expect(created).toHaveBeenCalledWith('tasks');expect(screen.getByRole('status')).toHaveTextContent('DCC actions saved.')
  expect(screen.getByRole('status')).toHaveTextContent('remaining work')
  commandFetch.mockImplementationOnce(async()=>receipt({...summary(),clarifications:[{reason:'missing_duration',question:'All tasks were applied!'}]}))
  enter('Different request');submit()
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Action was not confirmed'))
   expect(screen.queryByText('All tasks were applied!')).toBeNull();expect(stored()).toBeNull();expect(retained()).toHaveLength(1)
})

test.each([undefined,'legacy','tasks','actions'] as const)('unresolved old %s mode is archived without replay or executor migration; editor stays free',async mode=>{
 const original=seed(mode),created=vi.fn()
 commandFetch.mockImplementation(async()=>receipt(summary()))
 render(<TellHermes onCreated={created}/>);await ready()
 expect(stored()).toBeNull();expect(command()).not.toHaveAttribute('readonly')
 expect(retained()[0]).toMatchObject({key:original.key,prompt:original.prompt,mode:mode??'legacy'})
 submit();expect(commandFetch).not.toHaveBeenCalled()
 expect(screen.getByRole('button',{name:/Send as new request/})).toBeVisible()
 enter('');expect(command()).toHaveValue('');enter('New deliberate text');submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledOnce())
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/actions')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body).key).not.toBe(original.key)
 expect(retained()[0].mode).toBe(mode??'legacy')
})

test.each(['legacy','tasks','actions'] as const)('ordinary editing after settled %s receipt starts a fresh MCP intent',async mode=>{
 const original=seed(mode,true);commandFetch.mockImplementation(async()=>receipt(summary([applied])))
 render(<TellHermes onCreated={vi.fn()}/>);await ready()
 expect(command()).not.toHaveAttribute('readonly');enter('Edited draft');expect(command()).toHaveValue('Edited draft');await ready()
 submit();await screen.findByText('DCC actions saved.')
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/actions');expect(stored().key).not.toBe(original.key)
 expect(stored().settled).toBe(true);expect(command()).not.toHaveAttribute('readonly')
 enter('Second deliberate request');submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));await ready()
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).prompt).toBe('Second deliberate request')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body).key).not.toBe(JSON.parse(commandFetch.mock.calls[1][1].body).key)
})
test('an explicit unchanged successful legacy receipt check stays on its original executor/key',async()=>{
 const old=seed('legacy',true),created=vi.fn()
 commandFetch.mockImplementationOnce(async()=>new Response(JSON.stringify(legacyReply))).mockImplementation(async()=>receipt(summary()))
 render(<TellHermes onCreated={created}/>);await ready();submit()
 await screen.findByText('Legacy receipt saved.')
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/commands')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body)).toEqual(body(old))
 expect(stored()).toMatchObject({key:old.key,mode:'legacy',settled:true})
 enter('New MCP request');await ready();submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls[1][0]).toBe('/api/v1/hermes/actions')
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).key).not.toBe(old.key)
})

test('busy request prevents double submit; terminal uncertainty frees text and reload never retries it',async()=>{
 let resolve!:(r:Response)=>void
 commandFetch.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockImplementation(async()=>receipt({phase:'uncertain',effects:[],pending:1,reads:[]}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);await ready();enter();submit();submit()
 expect(commandFetch).toHaveBeenCalledOnce();expect(command()).toBeDisabled();expect(command().closest('form')).toHaveAttribute('aria-busy','true')
 const original=stored();resolve(receipt({phase:'uncertain',effects:[],pending:1,reads:[]}));await ready()
 expect(command()).not.toHaveAttribute('readonly');expect(stored()).toBeNull();expect(retained()[0].key).toBe(original.key)
 enter('');expect(command()).toHaveValue('')
 first.unmount();render(<TellHermes onCreated={created}/>);await ready()
 expect(commandFetch).toHaveBeenCalledTimes(1);expect(created).not.toHaveBeenCalled()
 enter(original.prompt);submit();expect(commandFetch).toHaveBeenCalledTimes(1)
 expect(screen.getByRole('button',{name:/Send as new request/})).toBeVisible()
})
test('uncertainty automatically retains the old key; changed text sends a fresh intent only on submit',async()=>{
 commandFetch.mockImplementationOnce(async()=>receipt({phase:'uncertain',effects:[],pending:1,reads:[]})).mockImplementation(async()=>receipt(summary()))
 render(<TellHermes onCreated={vi.fn()}/>);await ready();enter('Synthetic uncertain action');submit();await ready()
 const old=JSON.parse(commandFetch.mock.calls[0][1].body)
 expect(localStorage.getItem(STORAGE)).toBeNull()
 const retained=JSON.parse(localStorage.getItem('dcc.tell-hermes.retained.v1')!)
 expect(retained[0].key).toBe(old.key);expect(retained[0].settled).toBe(false);expect(retained[0].warning).toMatch(/not rolled back/i)
 expect(commandFetch).toHaveBeenCalledTimes(1)
 expect(command()).not.toHaveAttribute('readonly');enter('Read current state before any different action');submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).key).not.toBe(old.key)
 expect(retained[0].key).toBe(old.key)
})
test('failed archive persistence preserves the old slot without trapping typing or backspace',async()=>{
 localStorage.setItem('dcc.tell-hermes.retained.v1','corrupt')
 commandFetch.mockImplementation(async()=>receipt({phase:'uncertain',effects:[],pending:1,reads:[]}))
 const old=seed('actions');render(<TellHermes onCreated={vi.fn()}/>);await ready()
 expect(stored()).toEqual({...old,mode:'actions'});expect(command()).not.toHaveAttribute('readonly')
 enter('');enter('Editable draft');expect(command()).toHaveValue('Editable draft');submit()
 expect(commandFetch).not.toHaveBeenCalled();expect(stored().key).toBe(old.key)
 expect(screen.getByText(/Local history is unreadable/)).toBeVisible()
})
test('a late receipt refreshes known effects but cannot overwrite a different tab\'s new submission',async()=>{
 let finish!:(r:Response)=>void
 commandFetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter('Synthetic old action');submit()
 const old=stored(),next={key:'synthetic_other_tab_key_01',prompt:'Different request',mode:'actions',settled:false}
 localStorage.setItem('dcc.tell-hermes.retained.v1',JSON.stringify([{...old,warning:'Uncertain, not rolled back'}]))
 localStorage.setItem(STORAGE,JSON.stringify(next))
 finish(receipt(summary([applied])));await ready()
 expect(created).toHaveBeenCalledWith('tasks');expect(stored()).toEqual(next)
 expect(JSON.parse(localStorage.getItem('dcc.tell-hermes.retained.v1')!)[0].key).toBe(old.key)
})

test.each([401,503])('unavailable discovery (%s) blocks sending, never editing, without legacy fallback',async status=>{
 vi.mocked(protectedFetch).mockResolvedValueOnce(new Response('{}',{status}))
 render(<TellHermes onCreated={vi.fn()}/>);await waitFor(()=>expect(protectedFetch).toHaveBeenCalled())
 expect(command()).toBeEnabled();enter('');enter('Editable offline');submit();expect(commandFetch).not.toHaveBeenCalled();expect(screen.queryByRole('combobox')).toBeNull()
})
test('disabled old task request is retained and never sent to legacy',async()=>{
 enabled=false;const old=seed('tasks');render(<TellHermes onCreated={vi.fn()}/>)
 await screen.findByText(/MCP actions are unavailable/);expect(command()).toBeEnabled();enter('');expect(command()).toHaveValue('');submit()
 expect(commandFetch).not.toHaveBeenCalled();expect(stored()).toBeNull();expect(retained()[0].key).toBe(old.key)
})
test.each(['legacy','tasks','actions'] as const)('capability recovery removes only the derived unavailable status for old %s history',async mode=>{
 enabled=false;const old=seed(mode)
 commandFetch.mockImplementation(async()=>receipt(summary()))
 render(<TellHermes onCreated={vi.fn()}/>)
 await screen.findByText(/MCP actions are unavailable/)
 enter('Editable while unavailable');submit()
 expect(commandFetch).not.toHaveBeenCalled();expect(command()).toHaveValue('Editable while unavailable')
 const historyBefore=localStorage.getItem('dcc.tell-hermes.retained.v1')
 expect(retained()[0]).toMatchObject({key:old.key,mode})
 enabled=true;fireEvent(window,new Event('dcc-auth-changed'));await ready()
 expect(screen.getByRole('status')).not.toHaveTextContent('MCP actions are unavailable')
 expect(commandFetch).not.toHaveBeenCalled()
 expect(localStorage.getItem('dcc.tell-hermes.retained.v1')).toBe(historyBefore)
 enter('Fresh deliberate request');submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledOnce())
 expect(JSON.parse(commandFetch.mock.calls[0][1].body).key).not.toBe(old.key)
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/actions')
})
test.each(['uncertain','http500'] as const)('availability recovery preserves the prior %s status and retained receipt',async failure=>{
 commandFetch.mockImplementation(async()=>failure==='uncertain'?receipt({phase:'uncertain',effects:[],pending:1,reads:[]}):new Response('{}',{status:500}))
 render(<TellHermes onCreated={vi.fn()}/>);await ready();enter();submit();await ready()
 const status=screen.getByRole('status').textContent,historyBefore=localStorage.getItem('dcc.tell-hermes.retained.v1')
 expect(status).toMatch(failure==='uncertain'?/uncertain/:/not confirmed/)
 enabled=false;fireEvent(window,new Event('dcc-auth-changed'));await screen.findByText(/MCP actions are unavailable/)
 submit();expect(commandFetch).toHaveBeenCalledTimes(1)
 enabled=true;fireEvent(window,new Event('dcc-auth-changed'));await ready()
 expect(screen.getByRole('status').textContent).toBe(status)
 expect(localStorage.getItem('dcc.tell-hermes.retained.v1')).toBe(historyBefore)
 expect(commandFetch).toHaveBeenCalledTimes(1)
 expect(command()).toBeEnabled();enter('');expect(command()).toHaveValue('')
})

test.each([
 [200,{message:'Created.'}], [200,{message:'ok',summary:{...summary(),outcome:'effects_recorded'}}],
 [200,{message:'ok',summary:{...summary([applied]),pending:1}}],
 [200,{message:'ok',summary:summary([{...applied,version:'2'}])}],
 [200,{message:'ok',summary:{phase:'admitted',effects:[applied],pending:0}}],
 [422,{code:422,message:'Missing required details: date. Nothing was created.'}],
 [502,{message:'unconfirmed'}],
  ])('unconfirmed or inconsistent response (%s) archives the exact key without refresh or auto replay',async(status,result)=>{
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);await ready();enter();submit();await ready()
 const old=JSON.parse(commandFetch.mock.calls[0][1].body);expect(stored()).toBeNull();expect(command()).not.toHaveAttribute('readonly');expect(created).not.toHaveBeenCalled()
 expect(retained()[0].key).toBe(old.key)
 first.unmount();render(<TellHermes onCreated={created}/>);await ready();enter(old.prompt);submit()
 expect(commandFetch).toHaveBeenCalledTimes(1)
})

test.each([
 {phase:'completed',outcome:'partial',effects:[applied,{tool:'create_task',state:'conflict'}],pending:0,reads:[]},
 {phase:'uncertain',effects:[applied],pending:1,reads:[]},
 ])('partial/uncertain known effects refresh only affected domains: %j',async value=>{
 commandFetch.mockImplementation(async()=>receipt(value));const created=vi.fn()
 render(<TellHermes onCreated={created}/>);await ready();enter();submit();await waitFor(()=>expect(created).toHaveBeenCalledWith('tasks'))
 expect(stored()).toBeNull();expect(retained()).toHaveLength(1);expect(command()).not.toHaveAttribute('readonly')
})
test('project and saved calendar receipts refresh exact domains and disclose pending snapshot truth',async()=>{
 commandFetch.mockImplementation(async()=>receipt(summary([{tool:'archive_project',state:'applied',id:'project-id',version:3},{tool:'create_calendar_event',state:'saved',confirmation:'snapshot_pending'}])))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter();submit()
 await screen.findByText(/Calendar saved; snapshot confirmation pending/)
 expect(created.mock.calls).toEqual([['projects'],['calendar']]);expect(stored().settled).toBe(true)
})

test('daily action/preparation receipts refresh planner only and bounded cache reads never manufacture effects',async()=>{
 commandFetch.mockImplementation(async()=>receipt({...summary([{tool:'update_daily_action',state:'applied',id:'daily-id',version:2},{tool:'update_preparation_topic',state:'applied',id:'preparation-id',version:3}]),reads:[{tool:'search_inbox',data:{items:[],nextOffset:null}},{tool:'list_prices',data:{items:[],nextOffset:null}}]}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter();submit()
 await screen.findByText('Authoritative results')
 expect(created.mock.calls).toEqual([['projects']]);expect(stored().settled).toBe(true)
})
test('authoritative reads are displayed without inventing writes',async()=>{
 commandFetch.mockImplementation(async()=>receipt({...summary(),reads:[{tool:'list_projects',data:{items:[{title:'Synthetic project'}],nextOffset:null}}]}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter();submit()
 await screen.findByText('Authoritative results');expect(screen.getByText(/Synthetic project/)).toBeInTheDocument()
 expect(created).not.toHaveBeenCalled();expect(stored().settled).toBe(true)
})
test.each(['create_preparation','relink_preparation','insert_preparation_topic','remove_preparation_topic'])('%s receipt refreshes planner only',async tool=>{
 commandFetch.mockImplementation(async()=>receipt(summary([{tool,state:'applied',id:'preparation-id',version:2}])))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter();submit()
 await screen.findByText('DCC actions saved.')
 expect(created.mock.calls).toEqual([['projects']]);expect(stored().settled).toBe(true)
})
test('unreadable storage blocks sending and quota failure prevents dispatch',async()=>{
 localStorage.setItem(STORAGE,'broken');const first=render(<TellHermes onCreated={vi.fn()}/>);submit()
 expect(command()).toBeEnabled();enter('Editable despite bad storage');expect(screen.getByRole('status')).toHaveTextContent('sending is paused');expect(localStorage.getItem(STORAGE)).toBe('broken')
 first.unmount();localStorage.clear();render(<TellHermes onCreated={vi.fn()}/>);await ready();enter()
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic quota')})
 try{submit();await screen.findByText(/Action was not confirmed/);expect(commandFetch).not.toHaveBeenCalled();enter('');expect(command()).toHaveValue('')}finally{storage.mockRestore()}
})
test('confirmed writes still refresh when settling storage fails; history preserves key without locking input',async()=>{
 commandFetch.mockImplementation(async()=>receipt(summary([applied])))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter()
 const original=Storage.prototype.setItem;let writes=0
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(++writes===2)throw Error('synthetic settle failure');original.call(this,key,value)})
 try{submit();await screen.findByText(/Saved effects confirmed/);expect(created).toHaveBeenCalledWith('tasks');expect(stored()).toBeNull();expect(retained()).toHaveLength(1);expect(command()).not.toHaveAttribute('readonly');enter('');expect(command()).toHaveValue('')}finally{storage.mockRestore()}
})

test.each([
 'Missing required details: date, calendar. Nothing was created.',
 'Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.',
 ])('only exact legacy terminal no-write contract clears retry state: %s',async message=>{
  seed('legacy',true);localStorage.setItem('unrelated','keep')
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify({code:422,message}),{status:422}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);submit();await screen.findByText(message)
 expect(localStorage.getItem(STORAGE)).toBeNull();expect(localStorage.getItem('unrelated')).toBe('keep');expect(created).not.toHaveBeenCalled()
 expect(command()).toHaveValue('Synthetic original')
 commandFetch.mockImplementation(async()=>receipt(summary()))
  await ready();enter('Different request');submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));await ready()
 expect(commandFetch.mock.calls[1][0]).toBe('/api/v1/hermes/actions');expect(stored().mode).toBe('actions')
})
test.each([
 [422,{code:422,message:'Calendar save not confirmed. Retry this same submission safely.'}],
 [422,{message:'Missing required details: date. Nothing was created.'}],
 [422,{code:422,message:'Missing required details: date.'}],
 [422,{code:422,message:'Nothing was created.'}],
 [422,{code:422,message:'Missing required details: date. Nothing was created.',id:'possibly-created'}],
 [502,{code:422,message:'Missing required details: date. Nothing was created.'}],
 [422,{code:502,message:'Missing required details: date. Nothing was created.'}],
 ])('non-definitive legacy response %s retains exact saved key across reload',async(status,result)=>{
  const old=seed('legacy',true);commandFetch.mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);submit();await ready()
  expect(stored()).toBeNull();expect(retained()[0]).toMatchObject({key:old.key,mode:'legacy'});first.unmount();render(<TellHermes onCreated={created}/>);await ready();enter(old.prompt);submit()
  expect(commandFetch).toHaveBeenCalledTimes(1);expect(created).not.toHaveBeenCalled();expect(command()).not.toHaveAttribute('readonly')
})
test('invalid JSON and failed active-slot removal preserve old key without replay or readonly editor',async()=>{
  const old=seed('legacy',true);commandFetch.mockImplementationOnce(async()=>new Response('invalid JSON'))
  const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('synthetic remove failure')})
  try{
   const first=render(<TellHermes onCreated={vi.fn()}/>);submit();await screen.findByText(/Action was not confirmed/)
   expect(stored().key).toBe(old.key);expect(retained()[0].key).toBe(old.key);expect(command()).not.toHaveAttribute('readonly')
   enter('');expect(command()).toHaveValue('');first.unmount();render(<TellHermes onCreated={vi.fn()}/>);await ready()
   enter('Different draft');submit();await waitFor(()=>expect(command()).toBeEnabled())
   expect(commandFetch).toHaveBeenCalledTimes(1);expect(stored().key).toBe(old.key)
  }finally{remove.mockRestore()}
})
test.each(['network','timeout','http500','uncertain','rejected'] as const)('%s failure permits clearing/editing; unchanged text needs explicit new-intent confirmation',async failure=>{
 commandFetch.mockImplementationOnce(async()=>{
  if(failure==='network')throw new TypeError('Synthetic offline')
  if(failure==='timeout')throw new DOMException('Synthetic deadline','TimeoutError')
  if(failure==='http500')return new Response('{}',{status:500})
  return receipt(failure==='uncertain'?{phase:'uncertain',effects:[],pending:1,reads:[]}:{phase:'completed',outcome:'rejected',effects:[{tool:'create_task',state:'rejected'}],pending:0,reads:[]})
 }).mockImplementation(async()=>receipt(summary()))
 const view=render(<TellHermes onCreated={vi.fn()}/>);await ready();enter('Original failed text');submit();await ready()
 const old=retained()[0];expect(old.prompt).toBe('Original failed text');expect(stored()).toBeNull()
 view.rerender(<TellHermes onCreated={vi.fn()}/>);expect(commandFetch).toHaveBeenCalledTimes(1)
 submit();expect(commandFetch).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:/Send as new request/}))
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));await ready()
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).key).not.toBe(old.key)
 expect(retained()[0].key).toBe(old.key)
})
test('busy cancellation releases the editor and never silently resends the cancelled request',async()=>{
 commandFetch.mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Synthetic cancel','AbortError')),{once:true})))
 render(<TellHermes onCreated={vi.fn()}/>);await ready();enter();submit()
 expect(command()).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Stop waiting'}));await ready()
 expect(retained()).toHaveLength(1);enter('');expect(command()).toHaveValue('');expect(commandFetch).toHaveBeenCalledTimes(1)
})
test('retained local history is capped at twenty without changing backend keys',async()=>{
 for(let i=0;i<25;i++){
  localStorage.setItem('dcc.tell-hermes.retained.v1',JSON.stringify([...retained(),{key:`old_synthetic_key_${i}`,prompt:`Old ${i}`,mode:'actions',settled:false,warning:'Unconfirmed'}]))
 }
 const old=seed('actions');render(<TellHermes onCreated={vi.fn()}/>);await ready()
 expect(retained()).toHaveLength(20);expect(retained().at(-1).key).toBe(old.key);expect(commandFetch).not.toHaveBeenCalled()
})
