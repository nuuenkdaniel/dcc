// Isolated injected model -> real controller/journal/dispatcher -> rendered
// composer. Query fakes only; no listener, startup/env loader, DB or provider.
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {expect,test,vi} from 'vitest'
import {TellHermes} from '../src/TellHermes'
import {protectedFetch} from '../src/auth'
import {RequestController} from '../../backend/src/mcp/request-controller'
import {SqlIntentStore} from '../../backend/src/mcp/intent-store'
import {ServiceTransport} from '../../backend/src/mcp/service-transport'
import {IntentPool} from '../../backend/test/mcp/intent-pool'
import {ServicePool} from '../../backend/test/mcp/service-pool'
vi.mock('../src/auth',()=>({protectedFetch:vi.fn()}))
test('injected model clarification reaches the browser and an answer gets a fresh journal key',async()=>{
  localStorage.clear()
  const journal=new IntentPool(),effects=new ServicePool(),keys:string[]=[]
  const runner=vi.fn(async()=>({calls:[{id:'question',tool:'request_clarification',arguments:{reason:'missing_duration'}}],done:true,final:'Everything was created'}))
  const controller=new RequestController({store:new SqlIntentStore(journal.pool,'synthetic-clarification'),transport:new ServiceTransport({pool:effects.pool,actorId:'synthetic-clarification'}),runner})
  vi.mocked(protectedFetch).mockImplementation(async(path,init)=>{
    if(String(path).endsWith('action-capabilities'))return new Response(JSON.stringify({productActions:true,conversation:false}))
    if(String(path)!=='/api/v1/hermes/actions')throw Error('Unexpected synthetic route')
    const input=JSON.parse(String(init?.body));keys.push(input.key)
    return new Response(JSON.stringify({message:'Receipts only',summary:await controller.run(input,{executor:'mcp-action-v1',allowedTools:['request_clarification']})}))
  })
  const created=vi.fn();render(<TellHermes onCreated={created}/>)
   await waitFor(()=>{expect(screen.getByPlaceholderText('Hermes')).toBeEnabled();expect(screen.getByRole('status')).not.toHaveTextContent('MCP actions are unavailable')})
   const prompt=screen.getByPlaceholderText('Hermes')
  fireEvent.change(prompt,{target:{value:'Synthetic event without duration'}});fireEvent.submit(prompt.closest('form')!)
  await screen.findByText('How many minutes should this take?')
  expect(screen.getByRole('status')).not.toHaveTextContent(/saved|applied|created/i)
  expect(created).not.toHaveBeenCalled();expect(effects.rows.size).toBe(0)
  fireEvent.submit(prompt.closest('form')!)
  await waitFor(()=>expect(keys).toHaveLength(2));expect(keys[1]).toBe(keys[0]);expect(runner).toHaveBeenCalledTimes(1)
  await waitFor(()=>expect(prompt).toBeEnabled())
  fireEvent.change(prompt,{target:{value:'Synthetic event duration 30 minutes'}});fireEvent.submit(prompt.closest('form')!)
  await waitFor(()=>expect(runner).toHaveBeenCalledTimes(2))
  expect(keys[2]).not.toBe(keys[0]);expect(effects.rows.size).toBe(0)
})
