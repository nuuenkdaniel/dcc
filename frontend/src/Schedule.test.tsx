import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {Schedule} from './Schedule'
import {protectedFetch} from './auth'
import type {Planner} from './usePlanner'

vi.mock('./auth',()=>({protectedFetch:vi.fn()}))
vi.mock('./CalendarEditor',()=>({CalendarEditor:()=>null,PendingChanges:()=>null}))
vi.mock('./PreparationPanel',()=>({PreparationPanel:()=>null}))
vi.mock('./calendarOutbox',()=>({reconcile:vi.fn(async()=>[]),isSending:()=>false}))
const snapshot={calendars:[{id:'synthetic',name:'Test calendar'}],events:[{id:'existing',calendarId:'synthetic',title:'Cached event',start:'2026-11-02',end:'2026-11-03',allDay:true}],lastSuccess:'2026-11-02T10:00:00Z'}
const response=(data:unknown)=>new Response(JSON.stringify(data))
beforeEach(()=>{
 localStorage.clear()
 // Browser persistence is unavailable in this isolated test; no real storage or network.
 vi.stubGlobal('indexedDB',{open(){throw Error('Synthetic cache unavailable')}})
 vi.stubGlobal('fetch',vi.fn(async()=>response({authenticated:true})))
 vi.mocked(protectedFetch).mockReset().mockImplementation(async url=>response(String(url).endsWith('/refresh')?{status:'ok'}:snapshot))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
async function mount(){
 render(<Schedule date="2026-11-02" planner={{} as Planner}/> )
 await screen.findByText('Cached event')
 await waitFor(()=>expect(screen.getByRole('button',{name:'Sync calendar'})).toBeEnabled())
 vi.mocked(protectedFetch).mockClear()
}
test('Hermes creation forces upstream refresh before rereading snapshot and keeps cached content while waiting',async()=>{
 await mount()
 let finish!:(value:Response)=>void
 vi.mocked(protectedFetch).mockImplementation(async url=>String(url).endsWith('/refresh')?await new Promise<Response>(resolve=>{finish=resolve}):response({...snapshot,events:[...snapshot.events,{...snapshot.events[0],id:'created',title:'Hermes-created event'}]}))
 fireEvent(window,new Event('dcc-hermes-created'))
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledWith('/api/v1/calendar/refresh',expect.objectContaining({method:'POST'})))
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>call[0])).toEqual(['/api/v1/calendar/refresh'])
 expect(screen.getByText('Cached event')).toBeVisible()
 expect(screen.getByRole('button',{name:'Syncing…'})).toBeDisabled()
 await act(async()=>finish(response({status:'ok'})))
 await screen.findByText('Hermes-created event')
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>call[0])).toEqual(['/api/v1/calendar/refresh','/api/v1/calendar/snapshot'])
})
test('ordinary online and visible polling refreshes only reread the snapshot',async()=>{
 const interval=vi.spyOn(window,'setInterval')
 await mount()
 fireEvent(window,new Event('online'))
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(1))
 const poll=interval.mock.calls.find(call=>call[1]===60000)![0] as ()=>void
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
 await act(async()=>poll())
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>call[0])).toEqual(['/api/v1/calendar/snapshot','/api/v1/calendar/snapshot'])
})
test('manual Sync calendar retains the forced refresh flow',async()=>{
 await mount()
 fireEvent.click(screen.getByRole('button',{name:'Sync calendar'}))
 await waitFor(()=>expect(protectedFetch).toHaveBeenCalledTimes(2))
 expect(vi.mocked(protectedFetch).mock.calls.map(call=>call[0])).toEqual(['/api/v1/calendar/refresh','/api/v1/calendar/snapshot'])
})
