import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {TellHermes} from './TellHermes'
import {protectedFetch} from './auth'
vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
beforeEach(()=>{localStorage.clear();vi.mocked(protectedFetch).mockReset()})
afterEach(cleanup)
const enter=()=>{fireEvent.click(screen.getByText('Tell Hermes',{selector:'summary'}));fireEvent.change(screen.getByLabelText('Create a project, assignment, task, or event'),{target:{value:'Create a task called Read tomorrow'}})}
test('compact composer submits immediately without preview and reuses persisted key after reload',async()=>{
 const created=vi.fn()
 vi.mocked(protectedFetch).mockResolvedValue(new Response(JSON.stringify({message:'Hermes-created task: Read.'})))
 const first=render(<TellHermes onCreated={created}/>);enter()
 fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
 await screen.findByText('Hermes-created task: Read.')
 expect(created).toHaveBeenCalledOnce()
 const body=JSON.parse(String(vi.mocked(protectedFetch).mock.calls[0][1]?.body))
 expect(body.key).toMatch(/^[a-f0-9-]{36}$/)
 expect(screen.queryByText(/Preview suggestions/)).toBeNull()
 first.unmount();render(<TellHermes onCreated={created}/>)
 fireEvent.click(screen.getByText('Tell Hermes',{selector:'summary'}))
 fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(JSON.parse(String(vi.mocked(protectedFetch).mock.calls[1][1]?.body))).toEqual(body)
})
test('missing details retain input, corrected command gets a new key, uncertain retries reuse key',async()=>{
 vi.mocked(protectedFetch).mockResolvedValueOnce(new Response(JSON.stringify({message:'Missing required details: date. Nothing was created.'}),{status:422})).mockRejectedValueOnce(Error('fake timeout')).mockResolvedValueOnce(new Response(JSON.stringify({message:'Hermes-created task: Read.'})))
 const created=vi.fn();render(<TellHermes onCreated={created}/>);enter()
 fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
 await screen.findByText('Missing required details: date. Nothing was created.')
 expect(created).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('Create a project, assignment, task, or event'),{target:{value:'Create a task called Read on October 27'}})
 fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
 await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
 fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
 await screen.findByText('Hermes-created task: Read.')
 const bodies=vi.mocked(protectedFetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)))
 expect(bodies[0].key).not.toBe(bodies[1].key);expect(bodies[1]).toEqual(bodies[2])
})
test('unreadable saved retry state blocks sending instead of discarding it',()=>{
 localStorage.setItem('dcc.tell-hermes.submission.v1','broken')
 render(<TellHermes onCreated={vi.fn()}/>);fireEvent.click(screen.getByText('Tell Hermes',{selector:'summary'}))
 expect(screen.getByRole('button',{name:'Tell Hermes'})).toBeDisabled()
 expect(protectedFetch).not.toHaveBeenCalled()
 expect(localStorage.getItem('dcc.tell-hermes.submission.v1')).toBe('broken')
})

test('double submit is blocked while sending and storage failure prevents any request',async()=>{
 let resolve!:(response:Response)=>void
 vi.mocked(protectedFetch).mockImplementation(()=>new Promise(done=>{resolve=done}))
 const first=render(<TellHermes onCreated={vi.fn()}/>);enter()
 const button=screen.getByRole('button',{name:'Tell Hermes'})
 fireEvent.click(button);fireEvent.click(button)
 expect(protectedFetch).toHaveBeenCalledOnce()
 expect(button).toBeDisabled()
 resolve(new Response(JSON.stringify({message:'Hermes-created task: Read.'})))
 await screen.findByText('Hermes-created task: Read.')
 first.unmount();vi.mocked(protectedFetch).mockClear()
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('synthetic quota exceeded')})
 try{
  render(<TellHermes onCreated={vi.fn()}/>);fireEvent.click(screen.getByText('Tell Hermes',{selector:'summary'}))
  fireEvent.click(screen.getByRole('button',{name:'Tell Hermes'}))
  await screen.findByText('Creation was not confirmed. Keep this command unchanged and retry safely.')
  expect(protectedFetch).not.toHaveBeenCalled()
 }finally{storage.mockRestore()}
})
