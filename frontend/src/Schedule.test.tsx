import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {Schedule} from './Schedule'
import {protectedFetch} from './auth'
import {SyntheticWorkspaceSession} from './test/WorkspaceSession'
import type {Planner} from './usePlanner'

vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
vi.mock('./PreparationPanel',()=>({PreparationPanel:()=>null}))
const event={id:'existing',calendarId:'synthetic',title:'Cached event',start:'2026-11-02',end:'2026-11-03',allDay:true}
const snapshot={calendars:[{id:'synthetic',name:'Test calendar'}],events:[event],lastSuccess:'2026-11-02T10:00:00Z'}
beforeEach(()=>{
 localStorage.clear()
 vi.mocked(protectedFetch).mockReset().mockImplementation(async()=>Response.json(snapshot))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function mount(){
 render(<SyntheticWorkspaceSession><Schedule date="2026-11-02" planner={{} as Planner}/></SyntheticWorkspaceSession>)
 await screen.findByText('Cached event')
 await waitFor(()=>expect(screen.getByRole('button',{name:'New event'})).toBeEnabled())
 vi.mocked(protectedFetch).mockClear()
}
test('Hermes and reconnect refresh the server projection without asking the provider to sync',async()=>{
 await mount()
 vi.mocked(protectedFetch).mockImplementation(async()=>Response.json({...snapshot,events:[event,{...event,id:'other',title:'Hermes-created event'}]}))
 fireEvent(window,new Event('dcc-calendar-actions-saved'))
 await screen.findByText('Hermes-created event')
 fireEvent(window,new Event('online'))
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>call[0])).toEqual(['/api/v1/calendar/snapshot','/api/v1/calendar/snapshot'])
 expect(screen.queryByRole('button',{name:'Sync calendar'})).toBeNull()
})
test('a calendar event appears while sending and is removed on failure with its editor recoverable',async()=>{
 await mount()
 let reply!:(response:Response)=>void
 vi.mocked(protectedFetch).mockImplementation(async url=>String(url).endsWith('/writes')?new Promise<Response>(resolve=>{reply=resolve}):Response.json(snapshot))
 fireEvent.click(screen.getByRole('button',{name:'New event'}))
 fireEvent.change(screen.getByLabelText('Event title'),{target:{value:'Tentative event'}})
 fireEvent.click(screen.getByRole('button',{name:'Save event'}))
 expect(screen.getByText('Tentative event')).toBeInTheDocument()
 await act(async()=>reply(Response.json({state:'failed',code:400},{status:400})))
 expect(screen.queryByText('Tentative event')).toBeNull()
 expect(screen.getByText('Couldn’t sync this event.')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Edit failed event'}))
 expect(screen.getByLabelText('Event title')).toHaveValue('Tentative event')
})
