import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {TellHermes} from './TellHermes'
import {protectedFetch} from './auth'
vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
const commandFetch=vi.hoisted(()=>vi.fn())
let enabled=false
beforeEach(()=>{
 localStorage.clear();enabled=false;commandFetch.mockReset();vi.mocked(protectedFetch).mockReset()
 vi.mocked(protectedFetch).mockImplementation(async(input,init)=>String(input)==='/api/v1/hermes/capabilities'?new Response(JSON.stringify({taskActions:enabled})):commandFetch(input,init))
})
afterEach(cleanup)
const command=()=>screen.getByRole('textbox',{name:/Create a project, assignment, task, or event|Read, create, or complete tasks/})
const legacyReply=(message:string)=>({code:200,message,id:'12345678-1234-4234-a234-123456789abc',kind:'task',origin:'hermes'})
const payload=(v:{key:string;prompt:string})=>({key:v.key,prompt:v.prompt})
// jsdom does not implement implicit Enter submission; exercise the native form handler.
const submit=()=>fireEvent.submit(command().closest('form')!)
const enter=()=>fireEvent.change(command(),{target:{value:'Create a task called Read tomorrow'}})
test('shows one immediately visible single-line command with no disclosure or helper prose',()=>{
 const {container}=render(<TellHermes onCreated={vi.fn()}/>)
 expect(command()).toBeVisible()
 expect(command().tagName).toBe('INPUT')
 expect(command()).toHaveAttribute('type','text')
 expect(command()).toHaveAttribute('placeholder','Hermes')
 expect(command()).toHaveAttribute('required')
 expect(command()).toHaveAttribute('maxlength','4000')
 expect(container.querySelector('details,summary,textarea,button')).toBeNull()
 expect(screen.getByRole('status')).toHaveAttribute('id',command().getAttribute('aria-describedby'))
 expect(screen.queryByText(/Creates immediately/)).toBeNull()
  submit();expect(commandFetch).not.toHaveBeenCalled()
})
test('compact composer submits immediately without preview and reuses persisted key after reload',async()=>{
 const created=vi.fn()
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify(legacyReply('Hermes-created task: Read.'))))
 const first=render(<TellHermes onCreated={created}/>);enter();submit()
 await screen.findByText('Hermes-created task: Read.')
 expect(created).toHaveBeenCalledOnce()
 const body=JSON.parse(String(commandFetch.mock.calls[0][1]?.body))
 expect(body.key).toMatch(/^[a-f0-9-]{36}$/)
 expect(screen.queryByText(/Preview suggestions/)).toBeNull()
 first.unmount();render(<TellHermes onCreated={created}/>);submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(JSON.parse(String(commandFetch.mock.calls[1][1]?.body))).toEqual(body)
})
test.each([
 'Missing required details: date, calendar. Nothing was created.',
 'Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.'
])('terminal no-write response clears only retry state and unchanged input gets a new key: %s',async message=>{
 commandFetch.mockResolvedValueOnce(new Response(JSON.stringify({code:422,message}),{status:422})).mockRejectedValueOnce(Error('fake timeout')).mockResolvedValueOnce(new Response(JSON.stringify(legacyReply('Created.'))))
 localStorage.setItem('unrelated','keep')
 const created=vi.fn();render(<TellHermes onCreated={created}/>);enter();submit()
 await screen.findByText(message)
 expect(command()).toHaveValue('Create a task called Read tomorrow')
 expect(created).not.toHaveBeenCalled()
 expect(localStorage.getItem('dcc.tell-hermes.submission.v1')).toBeNull()
 expect(localStorage.getItem('unrelated')).toBe('keep')
 submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 submit();await screen.findByText('Created.')
 const bodies=commandFetch.mock.calls.map(call=>JSON.parse(String(call[1]?.body)))
 expect(bodies[0].key).not.toBe(bodies[1].key);expect(bodies[1]).toEqual(bodies[2])
 expect(bodies.every(body=>body.prompt==='Create a task called Read tomorrow')).toBe(true)
 expect(created).toHaveBeenCalledOnce()
})
test.each([
 [422,{code:422,message:'Calendar save not confirmed. Retry this same submission safely.'}],
 [422,{message:'Missing required details: date. Nothing was created.'}],
 [422,{code:422,message:'Missing required details: date.'}],
 [422,{code:422,message:'Nothing was created.'}],
 [422,{code:422,message:'Missing required details: date. Nothing was created.',id:'possibly-created'}],
 [502,{code:422,message:'Missing required details: date. Nothing was created.'}],
 [422,{code:502,message:'Missing required details: date. Nothing was created.'}]
])('non-definitive response retains saved key across reload: %s %j',async(status,result)=>{
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);enter();submit()
 await waitFor(()=>expect(command()).toBeEnabled())
 const saved=localStorage.getItem('dcc.tell-hermes.submission.v1')
 expect(saved).not.toBeNull()
 first.unmount();render(<TellHermes onCreated={created}/>);submit()
 await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual([payload(JSON.parse(saved!)),payload(JSON.parse(saved!))])
 expect(created).not.toHaveBeenCalled()
})
test('invalid JSON retains the exact key across reload and retry',async()=>{
 commandFetch.mockImplementation(async()=>new Response('invalid JSON',{status:422}))
 const first=render(<TellHermes onCreated={vi.fn()}/>);enter();submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 const saved=localStorage.getItem('dcc.tell-hermes.submission.v1')
 first.unmount();render(<TellHermes onCreated={vi.fn()}/>);submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 expect(commandFetch.mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual([payload(JSON.parse(saved!)),payload(JSON.parse(saved!))])
})
test('failed retry-state removal retains both the in-memory and persisted key',async()=>{
 const message='Missing required details: date. Nothing was created.'
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify({code:422,message}),{status:422}))
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw Error('synthetic storage failure')})
 try{
  const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);enter();submit()
  await waitFor(()=>expect(remove).toHaveBeenCalledTimes(1))
  await waitFor(()=>expect(command()).toBeEnabled())
  const saved=localStorage.getItem('dcc.tell-hermes.submission.v1')
  expect(saved).not.toBeNull();expect(command()).toHaveValue('Create a task called Read tomorrow')
  submit();await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2))
  first.unmount();render(<TellHermes onCreated={created}/>);submit()
  await waitFor(()=>expect(remove).toHaveBeenCalledTimes(3))
   expect(commandFetch.mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual(Array(3).fill(payload(JSON.parse(saved!))))
  expect(created).not.toHaveBeenCalled()
 }finally{remove.mockRestore()}
})
test('unreadable saved retry state blocks sending instead of discarding it',()=>{
 localStorage.setItem('dcc.tell-hermes.submission.v1','broken')
 render(<TellHermes onCreated={vi.fn()}/>);submit()
 expect(command()).toBeDisabled()
 expect(screen.getByRole('status')).toHaveTextContent('Sending is paused to protect retries.')
 expect(commandFetch).not.toHaveBeenCalled()
 expect(localStorage.getItem('dcc.tell-hermes.submission.v1')).toBe('broken')
})
test('double submit is blocked while sending and storage failure prevents any request',async()=>{
 let resolve!:(response:Response)=>void
 commandFetch.mockImplementation(()=>new Promise(done=>{resolve=done}))
 const first=render(<TellHermes onCreated={vi.fn()}/>);enter();submit();submit()
 expect(commandFetch).toHaveBeenCalledOnce()
 expect(command()).toBeDisabled()
 expect(command().closest('form')).toHaveAttribute('aria-busy','true')
 expect(screen.getByRole('status')).toHaveTextContent('Creating…')
 resolve(new Response(JSON.stringify(legacyReply('Hermes-created task: Read.'))))
 await screen.findByText('Hermes-created task: Read.')
 expect(command()).toBeEnabled()
 first.unmount();commandFetch.mockClear()
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic quota exceeded')})
 try{
  render(<TellHermes onCreated={vi.fn()}/>);submit()
  await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
   expect(commandFetch).not.toHaveBeenCalled()
 }finally{storage.mockRestore()}
})

const stored=()=>JSON.parse(localStorage.getItem('dcc.tell-hermes.submission.v1')!)
const applied={tool:'set_task_completed',state:'applied',id:'synthetic-task',version:2}
const taskResponse=(summary:unknown)=>new Response(JSON.stringify({message:'Task receipts checked.',summary}))
async function taskMode(){fireEvent.change(await screen.findByRole('combobox',{name:'Hermes mode'}),{target:{value:'tasks'}})}

test('only authenticated feature discovery exposes the compact task selector; general create stays default',async()=>{
 enabled=true
 const {container}=render(<TellHermes onCreated={vi.fn()}/>)
 const selector=await screen.findByRole('combobox',{name:'Hermes mode'})
 expect(selector).toHaveValue('legacy')
 expect(container.querySelectorAll('.tell-hermes input')).toHaveLength(1)
 expect(container.querySelector('button,details,textarea')).toBeNull()
 expect(protectedFetch).toHaveBeenCalledWith('/api/v1/hermes/capabilities',expect.objectContaining({signal:expect.any(AbortSignal)}))
 expect(commandFetch).not.toHaveBeenCalled()
})

test.each([401,503])('failed authenticated discovery hides task mode (%s)',async status=>{
 vi.mocked(protectedFetch).mockResolvedValueOnce(new Response('{}',{status}))
 render(<TellHermes onCreated={vi.fn()}/>)
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledOnce())
 expect(screen.queryByRole('combobox')).toBeNull()
})

test('old saved submissions remain legacy and pinned until a verified receipt; explicit mode change creates a new intent',async()=>{
 enabled=true
 const old={key:'old_legacy_submission_01',prompt:'Synthetic original'}
 localStorage.setItem('dcc.tell-hermes.submission.v1',JSON.stringify(old))
 commandFetch.mockImplementation(async(url)=>String(url).endsWith('/commands')?new Response(JSON.stringify(legacyReply('Saved legacy task.'))):taskResponse({phase:'completed',outcome:'no_effects_recorded',effects:[],pending:0}))
 render(<TellHermes onCreated={vi.fn()}/>)
 const selector=await screen.findByRole('combobox',{name:'Hermes mode'})
 expect(selector).toHaveValue('legacy');expect(selector).toBeDisabled()
 expect(stored()).toEqual(old)
 fireEvent.change(selector,{target:{value:'tasks'}});expect(selector).toHaveValue('legacy')
 submit();await screen.findByText('Saved legacy task.')
 expect(commandFetch.mock.calls[0][0]).toBe('/api/v1/hermes/commands')
 expect(JSON.parse(commandFetch.mock.calls[0][1].body)).toEqual(old)
 expect(selector).toBeEnabled()
 expect(command()).not.toHaveAttribute('readonly')
 fireEvent.change(selector,{target:{value:'tasks'}})
 expect(commandFetch).toHaveBeenCalledOnce() // Selection alone never executes.
 submit();await screen.findByText('No task writes were recorded. Edit the request to start a new intent.')
 expect(commandFetch.mock.calls[1][0]).toBe('/api/v1/hermes/task-actions')
 expect(JSON.parse(commandFetch.mock.calls[1][1].body).key).not.toBe(old.key)
 expect(stored().mode).toBe('tasks')
})

test('pending request disables controls and uncertainty survives reload with the same mode/key, never legacy fallback',async()=>{
 enabled=true
 let resolve!:(r:Response)=>void
 commandFetch.mockImplementationOnce(()=>new Promise(done=>{resolve=done})).mockImplementation(async()=>taskResponse({phase:'uncertain',effects:[],pending:1}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>)
 await taskMode();enter();submit()
 expect(command()).toBeDisabled();expect(screen.getByRole('combobox')).toBeDisabled()
 const original=stored()
 resolve(taskResponse({phase:'uncertain',effects:[],pending:1}))
 await screen.findByText('Task action uncertain. Recorded saved effects: 0. Retry unchanged to check receipts.')
 expect(command()).toHaveAttribute('readonly')
 expect(screen.getByRole('combobox')).toBeDisabled()
 fireEvent.change(command(),{target:{value:'Do not replace unresolved work'}})
 expect(command()).toHaveValue(original.prompt)
 first.unmount();render(<TellHermes onCreated={created}/>)
 await screen.findByRole('combobox')
 expect(screen.getByRole('combobox')).toHaveValue('tasks')
 submit();await waitFor(()=>expect(commandFetch).toHaveBeenCalledTimes(2))
 expect(commandFetch.mock.calls.map(call=>call[0])).toEqual(Array(2).fill('/api/v1/hermes/task-actions'))
 expect(commandFetch.mock.calls.map(call=>JSON.parse(call[1].body))).toEqual(Array(2).fill(payload(original)))
 expect(created).not.toHaveBeenCalled()
})

test.each(['legacy','tasks'])('ordinary draft editing and new requests stay editable after a verified %s receipt',async mode=>{
 enabled=true
 commandFetch.mockImplementation(async()=>mode==='tasks'
  ?taskResponse({phase:'completed',outcome:'effects_recorded',effects:[applied],pending:0})
  :new Response(JSON.stringify(legacyReply('Saved legacy task.'))))
 render(<TellHermes onCreated={vi.fn()}/>)
 if(mode==='tasks')await taskMode()
 expect(command()).not.toHaveAttribute('readonly')
 enter()
 fireEvent.change(command(),{target:{value:'Edited synthetic draft'}})
 expect(command()).toHaveValue('Edited synthetic draft')
 submit()
 const message=mode==='tasks'?'Task actions saved.':'Saved legacy task.'
 await screen.findByText(message)
 const first=stored()
 expect(first.settled).toBe(true);expect(command()).not.toHaveAttribute('readonly')
 fireEvent.change(command(),{target:{value:'Deliberate new synthetic request'}})
 expect(command()).toHaveValue('Deliberate new synthetic request')
 submit();await screen.findByText(message)
 expect(commandFetch).toHaveBeenCalledTimes(2)
 const bodies=commandFetch.mock.calls.map(call=>JSON.parse(call[1].body))
 expect(bodies[0].prompt).toBe('Edited synthetic draft')
 expect(bodies[1].prompt).toBe('Deliberate new synthetic request')
 expect(bodies[1].key).not.toBe(first.key)
 expect(commandFetch.mock.calls.map(call=>call[0])).toEqual(Array(2).fill(mode==='tasks'?'/api/v1/hermes/task-actions':'/api/v1/hermes/commands'))
 expect(command()).not.toHaveAttribute('readonly')
})

test.each([
 {phase:'completed',outcome:'partial',effects:[applied,{tool:'create_task',state:'conflict'}],pending:0},
 {phase:'uncertain',effects:[applied],pending:1},
])('only verified applied effects refresh tasks, including partial/uncertain results: %j',async summary=>{
 enabled=true;commandFetch.mockImplementation(async()=>taskResponse(summary))
 const created=vi.fn();render(<TellHermes onCreated={created}/>)
 await taskMode();enter();submit()
 await waitFor(()=>expect(created).toHaveBeenCalledWith('tasks'))
 expect(screen.getByRole('status')).toHaveTextContent(summary.phase==='completed'?'Some task actions saved':'Task action uncertain')
 expect(stored().settled).toBe(summary.phase==='completed')
 expect(localStorage.getItem('dcc.tell-hermes.submission.v1')).not.toBeNull()
})

test.each([
 {phase:'completed',outcome:'effects_recorded',effects:[],pending:0},
 {phase:'completed',outcome:'effects_recorded',effects:[applied],pending:1},
 {phase:'completed',outcome:'effects_recorded',effects:[{...applied,version:'2'}],pending:0},
 {phase:'admitted',effects:[applied],pending:0},
])('malformed or inconsistent success claims do not refresh or unlock the intent: %j',async summary=>{
 enabled=true;commandFetch.mockImplementation(async()=>taskResponse(summary))
 const created=vi.fn();render(<TellHermes onCreated={created}/>)
 await taskMode();enter();submit()
 await screen.findByText('Task action was not confirmed. Retry this task request unchanged.')
 expect(created).not.toHaveBeenCalled();expect(stored().settled).toBe(false)
 expect(screen.getByRole('combobox')).toBeDisabled()
})

test('task success retains exact replay key, but deliberate mode change never reexecutes under that key',async()=>{
 enabled=true
 commandFetch.mockImplementation(async(url)=>String(url).endsWith('/task-actions')?taskResponse({phase:'completed',outcome:'effects_recorded',effects:[applied],pending:0}):new Response(JSON.stringify(legacyReply('Legacy new intent.'))))
 const first=render(<TellHermes onCreated={vi.fn()}/>)
 await taskMode();enter();submit();await screen.findByText('Task actions saved.')
 const old=stored()
 first.unmount();render(<TellHermes onCreated={vi.fn()}/>);await screen.findByRole('combobox')
 submit();await screen.findByText('Task actions saved.')
 expect(JSON.parse(commandFetch.mock.calls[1][1].body)).toEqual(payload(old))
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'legacy'}})
 expect(commandFetch).toHaveBeenCalledTimes(2)
 submit();await screen.findByText('Legacy new intent.')
 expect(commandFetch.mock.calls[2][0]).toBe('/api/v1/hermes/commands')
 expect(JSON.parse(commandFetch.mock.calls[2][1].body).key).not.toBe(old.key)
})

test('saved task mode never falls back when backend discovery is disabled',async()=>{
 const saved={key:'saved_task_request_01',prompt:'Synthetic pending task',mode:'tasks',settled:false}
 localStorage.setItem('dcc.tell-hermes.submission.v1',JSON.stringify(saved))
 render(<TellHermes onCreated={vi.fn()}/>)
 await screen.findByText('Saved task mode retained. Task actions are unavailable; retry when enabled.')
 expect(screen.queryByRole('combobox')).toBeNull();expect(command()).toBeDisabled()
 submit();expect(commandFetch).not.toHaveBeenCalled();expect(stored()).toEqual(saved)
})

test('a bare HTTP 200 message is not an authoritative legacy write receipt',async()=>{
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify({message:'Created.'})))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);enter();submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 expect(created).not.toHaveBeenCalled();expect(stored().settled).toBe(false)
})

test('legacy no-write text on the task route cannot clear its pinned attempt',async()=>{
 enabled=true
 commandFetch.mockImplementation(async()=>new Response(JSON.stringify({code:422,message:'Missing required details: date. Nothing was created.'}),{status:422}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await taskMode();enter();submit()
 await screen.findByText('Task action was not confirmed. Retry this task request unchanged.')
 expect(stored().mode).toBe('tasks');expect(stored().settled).toBe(false)
 expect(created).not.toHaveBeenCalled()
})

test('completed task no-effect receipt settles but retains the replay key and never refreshes as a write',async()=>{
 enabled=true
 commandFetch.mockImplementation(async()=>taskResponse({phase:'completed',outcome:'no_effects_recorded',effects:[],pending:0}))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);await taskMode();enter();submit()
 await screen.findByText('No task writes were recorded. Edit the request to start a new intent.')
 expect(stored().settled).toBe(true);expect(stored().mode).toBe('tasks')
 expect(created).not.toHaveBeenCalled();expect(screen.getByRole('combobox')).toBeEnabled()
})

test('confirmed writes still refresh if settling browser retry state fails; the original key stays pinned',async()=>{
 enabled=true;commandFetch.mockImplementation(async()=>taskResponse({phase:'completed',outcome:'effects_recorded',effects:[applied],pending:0}))
 const original=Storage.prototype.setItem;let writes=0
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
  if(++writes===2)throw Error('synthetic settle failure')
  return original.call(this,key,value)
 })
 try{
  const created=vi.fn();render(<TellHermes onCreated={created}/>);await taskMode();enter();submit()
  await screen.findByText('Saved effects confirmed; retry state remains pinned. Retry this request unchanged.')
  expect(created).toHaveBeenCalledWith('tasks')
  expect(stored().settled).toBe(false);expect(screen.getByRole('combobox')).toBeDisabled()
 }finally{storage.mockRestore()}
})
