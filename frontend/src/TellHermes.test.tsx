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
afterEach(cleanup)
const command=()=>screen.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
const submit=()=>fireEvent.submit(command().closest('form')!)
const enter=(text='Synthetic request')=>fireEvent.change(command(),{target:{value:text}})
const stored=()=>JSON.parse(localStorage.getItem(STORAGE)!)
const body=(value:{key:string;prompt:string})=>({key:value.key,prompt:value.prompt})
const applied={tool:'set_task_completed',state:'applied',id:'synthetic-task',version:2}
const summary=(effects:unknown[]=[])=>({phase:'completed',outcome:effects.length?'effects_recorded':'no_effects_recorded',effects,pending:0,reads:[]})
const receipt=(value:unknown)=>new Response(JSON.stringify({message:'Receipts checked.',summary:value}))
const legacyReply={code:200,message:'Legacy receipt saved.',id:'12345678-1234-4234-a234-123456789abc',kind:'task',origin:'hermes'}
function seed(mode?:'legacy'|'tasks'|'actions',settled=false){const value={key:'retained_submission_key_01',prompt:'Synthetic original',...(mode?{mode}:{}),settled};localStorage.setItem(STORAGE,JSON.stringify(value));return value}
async function ready(){await waitFor(()=>expect(command()).toBeEnabled())}

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

test.each([undefined,'legacy','tasks'] as const)('unresolved old %s mode stays pinned, readonly and never migrates its executor',async mode=>{
 const original=seed(mode),created=vi.fn()
 commandFetch.mockImplementation(async()=>mode==='tasks'?receipt({phase:'uncertain',effects:[],pending:1}):new Response(JSON.stringify(legacyReply)))
 const first=render(<TellHermes onCreated={created}/>);await ready()
 expect(command()).toHaveAttribute('readonly');expect(screen.queryByRole('combobox')).toBeNull()
 enter('Must not replace');expect(command()).toHaveValue(original.prompt)
 submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledOnce());await ready()
 expect(commandFetch.mock.calls[0][0]).toBe(mode==='tasks'?'/api/v1/hermes/task-actions':'/api/v1/hermes/commands')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body)).toEqual(body(original))
 if(mode==='tasks'){
  first.unmount();render(<TellHermes onCreated={created}/>);await ready();submit()
  await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
  expect(commandFetch.mock.calls[1][0]).toBe('/api/v1/hermes/task-actions');expect(created).not.toHaveBeenCalled()
 }
})

test.each(['legacy','tasks','actions'] as const)('ordinary editing after settled %s receipt starts a fresh MCP intent',async mode=>{
 const original=seed(mode,true);commandFetch.mockImplementation(async()=>receipt(summary([applied])))
 render(<TellHermes onCreated={vi.fn()}/>);await ready()
 expect(command()).not.toHaveAttribute('readonly');enter('Edited draft');expect(command()).toHaveValue('Edited draft')
 submit();await screen.findByText('DCC actions saved.')
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/actions');expect(stored().key).not.toBe(original.key)
 expect(stored().settled).toBe(true);expect(command()).not.toHaveAttribute('readonly')
 enter('Second deliberate request');submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));await ready()
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).prompt).toBe('Second deliberate request')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body).key).not.toBe(JSON.parse(commandFetch.mock.calls[1][1].body).key)
})

test('pending request prevents double submit and uncertainty survives reload without edits or fallback',async()=>{
 let resolve!:(r:Response)=>void
 commandFetch.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockImplementation(async()=>receipt({phase:'uncertain',effects:[],pending:1,reads:[]}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);await ready();enter();submit();submit()
 expect(commandFetch).toHaveBeenCalledOnce();expect(command()).toBeDisabled();expect(command().closest('form')).toHaveAttribute('aria-busy','true')
 const original=stored();resolve(receipt({phase:'uncertain',effects:[],pending:1,reads:[]}));await ready()
 expect(command()).toHaveAttribute('readonly');enter('Do not replace');expect(command()).toHaveValue(original.prompt)
 first.unmount();render(<TellHermes onCreated={created}/>);await ready();submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls.map(c=>c[0])).toEqual(Array(2).fill('/api/v1/hermes/actions'))
 expect(commandFetch.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual(Array(2).fill(body(original)));expect(created).not.toHaveBeenCalled()
})

test.each([401,503])('unavailable discovery (%s) blocks fresh actions without legacy fallback',async status=>{
 vi.mocked(protectedFetch).mockResolvedValueOnce(new Response('{}',{status}))
 render(<TellHermes onCreated={vi.fn()}/>);await waitFor(()=>expect(protectedFetch).toHaveBeenCalled())
 expect(command()).toBeDisabled();submit();expect(commandFetch).not.toHaveBeenCalled();expect(screen.queryByRole('combobox')).toBeNull()
})
test('disabled old task request is retained and never sent to legacy',async()=>{
 enabled=false;const old=seed('tasks');render(<TellHermes onCreated={vi.fn()}/>)
 await screen.findByText(/MCP actions are unavailable/);expect(command()).toBeDisabled();submit()
 expect(commandFetch).not.toHaveBeenCalled();expect(stored()).toEqual(old)
})

test.each([
 [200,{message:'Created.'}], [200,{message:'ok',summary:{...summary(),outcome:'effects_recorded'}}],
 [200,{message:'ok',summary:{...summary([applied]),pending:1}}],
 [200,{message:'ok',summary:summary([{...applied,version:'2'}])}],
 [200,{message:'ok',summary:{phase:'admitted',effects:[applied],pending:0}}],
 [422,{code:422,message:'Missing required details: date. Nothing was created.'}],
 [502,{message:'unconfirmed'}],
 ])('unconfirmed or inconsistent response (%s) never refreshes or unlocks and replays exact key',async(status,result)=>{
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);await ready();enter();submit();await ready()
 const old=stored();expect(old.settled).toBe(false);expect(command()).toHaveAttribute('readonly');expect(created).not.toHaveBeenCalled()
 first.unmount();render(<TellHermes onCreated={created}/>);await ready();submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual(Array(2).fill(body(old)))
})

test.each([
 {phase:'completed',outcome:'partial',effects:[applied,{tool:'create_task',state:'conflict'}],pending:0,reads:[]},
 {phase:'uncertain',effects:[applied],pending:1,reads:[]},
 ])('partial/uncertain known effects refresh only affected domains: %j',async value=>{
 commandFetch.mockImplementation(async()=>receipt(value));const created=vi.fn()
 render(<TellHermes onCreated={created}/>);await ready();enter();submit();await waitFor(()=>expect(created).toHaveBeenCalledWith('tasks'))
 expect(stored().settled).toBe(value.phase==='completed')
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
 expect(command()).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('Sending is paused to protect retries.');expect(localStorage.getItem(STORAGE)).toBe('broken')
 first.unmount();localStorage.clear();render(<TellHermes onCreated={vi.fn()}/>);await ready();enter()
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic quota')})
 try{submit();await screen.findByText('Action was not confirmed. Retry this request unchanged.');expect(commandFetch).not.toHaveBeenCalled()}finally{storage.mockRestore()}
})
test('confirmed writes still refresh when settling storage fails and remain pinned',async()=>{
 commandFetch.mockImplementation(async()=>receipt(summary([applied])))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await ready();enter()
 const original=Storage.prototype.setItem;let writes=0
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(++writes===2)throw Error('synthetic settle failure');original.call(this,key,value)})
 try{submit();await screen.findByText('Saved effects confirmed; retry state remains pinned. Retry this request unchanged.');expect(created).toHaveBeenCalledWith('tasks');expect(stored().settled).toBe(false);expect(command()).toHaveAttribute('readonly')}finally{storage.mockRestore()}
})

test.each([
 'Missing required details: date, calendar. Nothing was created.',
 'Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.',
 ])('only exact legacy terminal no-write contract clears retry state: %s',async message=>{
 seed('legacy');localStorage.setItem('unrelated','keep')
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify({code:422,message}),{status:422}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);submit();await screen.findByText(message)
 expect(localStorage.getItem(STORAGE)).toBeNull();expect(localStorage.getItem('unrelated')).toBe('keep');expect(created).not.toHaveBeenCalled()
 expect(command()).toHaveValue('Synthetic original')
 commandFetch.mockImplementation(async()=>receipt(summary()))
 await ready();submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));await ready()
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
 const old=seed('legacy');commandFetch.mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);submit();await ready()
 expect(stored().key).toBe(old.key);first.unmount();render(<TellHermes onCreated={created}/>);submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2));expect(commandFetch.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual(Array(2).fill(body(old)));expect(created).not.toHaveBeenCalled()
})
test('invalid JSON and failed legacy retry-state removal never discard the original key',async()=>{
 const old=seed('legacy');commandFetch.mockImplementationOnce(async()=>new Response('invalid JSON')).mockImplementation(async()=>new Response(JSON.stringify({code:422,message:'Missing required details: date. Nothing was created.'}),{status:422}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);submit();await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 expect(stored().key).toBe(old.key)
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('synthetic remove failure')})
 try{
  submit();await waitFor(()=>expect(remove).toHaveBeenCalledOnce());await ready();expect(stored().key).toBe(old.key)
  first.unmount();render(<TellHermes onCreated={created}/>);submit();await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2))
  expect(commandFetch.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual(Array(3).fill(body(old)));expect(created).not.toHaveBeenCalled()
 }finally{remove.mockRestore()}
})
