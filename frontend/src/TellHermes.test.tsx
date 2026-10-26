import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {TellHermes} from './TellHermes'
import {protectedFetch} from './auth'
vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
beforeEach(()=>{localStorage.clear();vi.mocked(protectedFetch).mockReset()})
afterEach(cleanup)
const command=()=>screen.getByRole('textbox',{name:'Create a project, assignment, task, or event'})
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
 submit();expect(protectedFetch).not.toHaveBeenCalled()
})
test('compact composer submits immediately without preview and reuses persisted key after reload',async()=>{
 const created=vi.fn()
 vi.mocked(protectedFetch).mockResolvedValue(new Response(JSON.stringify({message:'Hermes-created task: Read.'})))
 const first=render(<TellHermes onCreated={created}/>);enter();submit()
 await screen.findByText('Hermes-created task: Read.')
 expect(created).toHaveBeenCalledOnce()
 const body=JSON.parse(String(vi.mocked(protectedFetch).mock.calls[0][1]?.body))
 expect(body.key).toMatch(/^[a-f0-9-]{36}$/)
 expect(screen.queryByText(/Preview suggestions/)).toBeNull()
 first.unmount();render(<TellHermes onCreated={created}/>);submit()
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(JSON.parse(String(vi.mocked(protectedFetch).mock.calls[1][1]?.body))).toEqual(body)
})
test.each([
 'Missing required details: date, calendar. Nothing was created.',
 'Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.'
])('terminal no-write response clears only retry state and unchanged input gets a new key: %s',async message=>{
 vi.mocked(protectedFetch).mockResolvedValueOnce(new Response(JSON.stringify({code:422,message}),{status:422})).mockRejectedValueOnce(Error('fake timeout')).mockResolvedValueOnce(new Response(JSON.stringify({message:'Created.'})))
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
 const bodies=vi.mocked(protectedFetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)))
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
 vi.mocked(protectedFetch).mockImplementation(async()=>new Response(JSON.stringify(result),{status}))
 const created=vi.fn(),first=render(<TellHermes onCreated={created}/>);enter();submit()
 await waitFor(()=>expect(command()).toBeEnabled())
 const saved=localStorage.getItem('dcc.tell-hermes.submission.v1')
 expect(saved).not.toBeNull()
 first.unmount();render(<TellHermes onCreated={created}/>);submit()
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual([JSON.parse(saved!),JSON.parse(saved!)])
 expect(created).not.toHaveBeenCalled()
})
test('invalid JSON retains the exact key across reload and retry',async()=>{
 vi.mocked(protectedFetch).mockImplementation(async()=>new Response('invalid JSON',{status:422}))
 const first=render(<TellHermes onCreated={vi.fn()}/>);enter();submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 const saved=localStorage.getItem('dcc.tell-hermes.submission.v1')
 first.unmount();render(<TellHermes onCreated={vi.fn()}/>);submit()
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual([JSON.parse(saved!),JSON.parse(saved!)])
})
test('failed retry-state removal retains both the in-memory and persisted key',async()=>{
 const message='Missing required details: date. Nothing was created.'
 vi.mocked(protectedFetch).mockImplementation(async()=>new Response(JSON.stringify({code:422,message}),{status:422}))
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
  expect(vi.mocked(protectedFetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)))).toEqual(Array(3).fill(JSON.parse(saved!)))
  expect(created).not.toHaveBeenCalled()
 }finally{remove.mockRestore()}
})
test('unreadable saved retry state blocks sending instead of discarding it',()=>{
 localStorage.setItem('dcc.tell-hermes.submission.v1','broken')
 render(<TellHermes onCreated={vi.fn()}/>);submit()
 expect(command()).toBeDisabled()
 expect(screen.getByRole('status')).toHaveTextContent('Sending is paused to protect retries.')
 expect(protectedFetch).not.toHaveBeenCalled()
 expect(localStorage.getItem('dcc.tell-hermes.submission.v1')).toBe('broken')
})
test('double submit is blocked while sending and storage failure prevents any request',async()=>{
 let resolve!:(response:Response)=>void
 vi.mocked(protectedFetch).mockImplementation(()=>new Promise(done=>{resolve=done}))
 const first=render(<TellHermes onCreated={vi.fn()}/>);enter();submit();submit()
 expect(protectedFetch).toHaveBeenCalledOnce()
 expect(command()).toBeDisabled()
 expect(command().closest('form')).toHaveAttribute('aria-busy','true')
 expect(screen.getByRole('status')).toHaveTextContent('Creating…')
 resolve(new Response(JSON.stringify({message:'Hermes-created task: Read.'})))
 await screen.findByText('Hermes-created task: Read.')
 expect(command()).toBeEnabled()
 first.unmount();vi.mocked(protectedFetch).mockClear()
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic quota exceeded')})
 try{
  render(<TellHermes onCreated={vi.fn()}/>);submit()
  await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
  expect(protectedFetch).not.toHaveBeenCalled()
 }finally{storage.mockRestore()}
})
