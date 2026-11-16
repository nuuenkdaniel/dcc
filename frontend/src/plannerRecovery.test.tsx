import {renderHook,act,waitFor,cleanup} from '@testing-library/react'
import {afterEach,test,expect,vi} from 'vitest'
import {usePlanner} from './usePlanner'
import {SyntheticWorkspaceSession} from './test/WorkspaceSession'
const snapshot={projects:[],actions:[],status:{}}
const recover=()=>renderHook(usePlanner,{wrapper:SyntheticWorkspaceSession})
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear()})
test('focus recovers failed task loading without wiping cache',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async()=>Response.json(snapshot))
 vi.stubGlobal('fetch',fetcher)
 const {result}=recover()
 await waitFor(()=>expect(result.current.loadState).toBe('offline'))
 act(()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(result.current.loadState).toBe('ready'))
 expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
})
test('an old planner queue stays available for review and never uploads by itself',async()=>{
 const base={id:'44444444-4444-4444-8444-444444444444',title:'Previous draft',source:'manual-project' as const,projectId:'11111111-1111-4111-8111-111111111111',date:'2026-10-10',minutes:30,notes:'',completed:false,dismissed:false}
 localStorage.setItem('daymark.planner.v1',JSON.stringify({snapshot,pending:[{kind:'action',version:0,data:base}]}))
 const fetcher=vi.fn().mockImplementation(async()=>Response.json(snapshot))
 vi.stubGlobal('fetch',fetcher)
 const {result}=recover()
 await waitFor(()=>expect(result.current.loadState).toBe('ready'))
 expect(result.current.legacyChanges).toHaveLength(1)
 expect(result.current.actions).toEqual([])
 expect(fetcher.mock.calls.every(call=>call[1]?.method!=='POST')).toBe(true)
})
