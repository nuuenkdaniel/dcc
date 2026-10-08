import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import {afterEach,test,expect,vi} from 'vitest'
import {usePlanner} from './usePlanner'
const snapshot={projects:[],actions:[],status:{}}
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear()})
test('focus recovers failed task loading without wiping cache',async()=>{const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ok:true,status:200,json:async()=>snapshot});vi.stubGlobal('fetch',fetcher);const {result}=renderHook(()=>usePlanner());await waitFor(()=>expect(result.current.loadState).toBe('offline'));act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(result.current.loadState).toBe('ready'));expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)})
test('sign-in notification reloads tasks immediately',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({status:401}).mockResolvedValue({ok:true,status:200,json:async()=>snapshot}));const {result}=renderHook(()=>usePlanner());await waitFor(()=>expect(result.current.loadState).toBe('signed-out'));act(()=>window.dispatchEvent(new Event('dcc-auth-changed')));await waitFor(()=>expect(result.current.loadState).toBe('ready'))})
test('back-to-back selected task saves retain both stable IDs in the offline planner queue',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')))
 const {result}=renderHook(()=>usePlanner());await waitFor(()=>expect(result.current.loadState).toBe('offline'))
 const base={source:'manual-project' as const,projectId:'11111111-1111-4111-8111-111111111111',date:'2026-10-10',minutes:30,notes:'',completed:false,dismissed:false}
 act(()=>{
  expect(result.current.save('action',{...base,id:'44444444-4444-4444-8444-444444444444',title:'First'})).toBe(true)
  expect(result.current.save('action',{...base,id:'55555555-5555-4555-8555-555555555555',title:'Second'})).toBe(true)
 })
 const cache=JSON.parse(localStorage.getItem('daymark.planner.v1')!)
 expect(cache.pending.map((item:{data:{id:string}})=>item.data.id)).toEqual(['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'])
 expect(result.current.actions.map(action=>action.title)).toEqual(['First','Second'])
})
