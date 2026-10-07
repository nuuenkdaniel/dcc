import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import {afterEach,test,expect,vi} from 'vitest'
import {usePlanner} from './usePlanner'
const snapshot={projects:[],actions:[],status:{}}
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear()})
test('focus recovers failed task loading without wiping cache',async()=>{const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ok:true,status:200,json:async()=>snapshot});vi.stubGlobal('fetch',fetcher);const {result}=renderHook(()=>usePlanner());await waitFor(()=>expect(result.current.loadState).toBe('offline'));act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(result.current.loadState).toBe('ready'));expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)})
test('sign-in notification reloads tasks immediately',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({status:401}).mockResolvedValue({ok:true,status:200,json:async()=>snapshot}));const {result}=renderHook(()=>usePlanner());await waitFor(()=>expect(result.current.loadState).toBe('signed-out'));act(()=>window.dispatchEvent(new Event('dcc-auth-changed')));await waitFor(()=>expect(result.current.loadState).toBe('ready'))})
