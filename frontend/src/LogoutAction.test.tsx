import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {LogoutAction} from './LogoutAction'

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as Response

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

it('posts an empty body with same-origin credentials and reports auth required after confirmation',async()=>{
  const timeout=vi.spyOn(AbortSignal,'timeout')
  const fetchMock=vi.fn().mockResolvedValue(response({authenticated:false}))
  vi.stubGlobal('fetch',fetchMock)
  const required=vi.fn();window.addEventListener('dcc-auth-required',required,{once:true})
  render(<LogoutAction/>)
  fireEvent.click(screen.getByRole('button',{name:'Sign out'}))
  await waitFor(()=>expect(required).toHaveBeenCalledOnce())
  expect(timeout).toHaveBeenCalledWith(8000)
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout',expect.objectContaining({method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:expect.any(AbortSignal)}))
})

it('blocks duplicate submits and keeps logout retryable when the server does not confirm it',async()=>{
  let finishFirst:(value:Response)=>void=()=>{}
  const first=new Promise<Response>(resolve=>{finishFirst=resolve})
  const fetchMock=vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response({authenticated:false}))
  vi.stubGlobal('fetch',fetchMock)
  const required=vi.fn();window.addEventListener('dcc-auth-required',required)
  const {unmount}=render(<LogoutAction/>)
  const button=screen.getByRole('button',{name:'Sign out'})
  fireEvent.click(button);fireEvent.click(button)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button',{name:'Signing out…'})).toBeDisabled()
  finishFirst(response({error:'unavailable'},503))
  expect(await screen.findByRole('alert')).toHaveTextContent(/status 503.*still considered active.*try again/i)
  expect(required).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Sign out'}))
  await waitFor(()=>expect(required).toHaveBeenCalledOnce())
  expect(fetchMock).toHaveBeenCalledTimes(2)
  unmount();window.removeEventListener('dcc-auth-required',required)
})

it('does not claim success for an unconfirmed successful response',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({signedOut:true})))
  const required=vi.fn();window.addEventListener('dcc-auth-required',required)
  const {unmount}=render(<LogoutAction label="Sign out / test login"/>)
  fireEvent.click(screen.getByRole('button',{name:'Sign out / test login'}))
  expect(await screen.findByRole('alert')).toHaveTextContent(/did not confirm sign out.*still considered active/i)
  expect(required).not.toHaveBeenCalled()
  unmount();window.removeEventListener('dcc-auth-required',required)
})
