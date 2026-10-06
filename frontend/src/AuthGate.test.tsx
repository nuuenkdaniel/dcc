import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {AuthGate} from './AuthGate'
import {protectedFetch} from './auth'

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response

beforeEach(()=>{window.history.replaceState({},'','/');window.localStorage.clear()})
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})

it('restores a valid HttpOnly session without showing private workspace first',async()=>{
 window.history.replaceState({},'','/projects')
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({authenticated:true,configured:true})))
 render(<AuthGate><div>Private projects</div></AuthGate>)
 expect(screen.queryByText('Private projects')).not.toBeInTheDocument()
 expect(await screen.findByText('Private projects')).toBeInTheDocument()
 expect(window.location.pathname).toBe('/projects')
})

it('gates a signed-out requested route and does not mount protected hooks',async()=>{
 window.history.replaceState({},'','/inbox?filter=unread')
 const protectedHook=vi.fn()
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({authenticated:false,configured:true})))
 function Private(){protectedHook();return <div>Private inbox</div>}
 render(<AuthGate><Private/></AuthGate>)
 expect(await screen.findByLabelText('Username')).toBeEnabled()
 expect(screen.queryByText('Private inbox')).not.toBeInTheDocument()
 expect(protectedHook).not.toHaveBeenCalled()
 expect(window.location.pathname).toBe('/login')
 expect(new URLSearchParams(window.location.search).get('next')).toBe('/inbox?filter=unread')
 expect(screen.queryByRole('button',{name:'Continue locally'})).not.toBeInTheDocument()
})

it('restores the internal login route after successful sign-in',async()=>{
 window.history.replaceState({},'','/login?next=%2Finbox')
 const fetchMock=vi.fn().mockResolvedValueOnce(response({authenticated:false,configured:true})).mockResolvedValueOnce(response({authenticated:true},200))
 vi.stubGlobal('fetch',fetchMock)
 render(<AuthGate><div>Restored inbox</div></AuthGate>)
 fireEvent.change(await screen.findByLabelText('Username'),{target:{value:'user'}})
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'secret'}})
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}))
 expect(await screen.findByText('Restored inbox')).toBeInTheDocument()
 expect(window.location.pathname).toBe('/inbox')
})

it('returns to login on a protected 401 without erasing browser drafts',async()=>{
 window.history.replaceState({},'','/projects')
 localStorage.setItem('daymark.planner.v1','unsynced-draft')
 const fetchMock=vi.fn().mockResolvedValueOnce(response({authenticated:true,configured:true})).mockResolvedValueOnce(response({},401))
 vi.stubGlobal('fetch',fetchMock)
 render(<AuthGate><div>Draft editor</div></AuthGate>)
 expect(await screen.findByText('Draft editor')).toBeInTheDocument()
 await protectedFetch('/api/v1/planner/snapshot')
 expect(await screen.findByLabelText('Username')).toBeEnabled()
 expect(localStorage.getItem('daymark.planner.v1')).toBe('unsynced-draft')
 expect(new URLSearchParams(window.location.search).get('next')).toBe('/projects')
})

it('shows an outage retry gate without clearing data or calling it a bad password',async()=>{
 localStorage.setItem('productivity-app.tasks.v1','saved-tasks')
 const fetchMock=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({authenticated:true,configured:true}))
 vi.stubGlobal('fetch',fetchMock)
 render(<AuthGate><div>Workspace restored</div></AuthGate>)
 expect(await screen.findByRole('heading',{name:'Connection unavailable'})).toBeInTheDocument()
 expect(screen.queryByText(/credentials/i)).not.toBeInTheDocument()
 expect(localStorage.getItem('productivity-app.tasks.v1')).toBe('saved-tasks')
 fireEvent.click(screen.getByRole('button',{name:'Retry'}))
 expect(await screen.findByText('Workspace restored')).toBeInTheDocument()
})

it('keeps a login 401 local instead of emitting global expiry',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({authenticated:false,configured:true})).mockResolvedValueOnce(response({},401)))
 const expired=vi.fn();window.addEventListener('dcc-auth-required',expired)
 const {unmount}=render(<AuthGate><div>Private</div></AuthGate>)
 fireEvent.change(await screen.findByLabelText('Username'),{target:{value:'user'}})
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'wrong'}})
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}))
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent(/sign-in failed/i))
 expect(expired).not.toHaveBeenCalled()
 unmount();window.removeEventListener('dcc-auth-required',expired)
})
