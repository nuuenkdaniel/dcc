import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {SyntheticWorkspaceSession} from './test/WorkspaceSession'
import {useServerTasks} from './useServerTasks'

const endpoint='/api/v1/workspace/writes'
const entity={id:'manual-task',title:'Read a chapter',date:'2026-11-12',completed:false,notes:''}
const owner='a'.repeat(64)
const summary=(tasks:unknown[],version=0)=>Response.json({version,data:{tasks}})
beforeEach(()=>localStorage.clear())
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();localStorage.clear()})

test('an online create immediately overlays the confirmed snapshot, then commits the server record once',async()=>{
 let complete!:(value:Response)=>void
 const fetcher=vi.fn(async(url:string,request?:RequestInit)=>{
  if(url===endpoint){
   expect(JSON.parse(String(request?.body)).payload).toEqual({task:entity,expected:null})
   return new Promise<Response>(resolve=>{complete=resolve})
  }
  return summary([])
 })
 vi.stubGlobal('fetch',fetcher)
 const {result}=renderHook(useServerTasks,{wrapper:SyntheticWorkspaceSession})
 await waitFor(()=>expect(result.current.ready).toBe(true))
 act(()=>{
  expect(result.current.save(entity)).toBe(true)
  expect(result.current.save(entity)).toBe(false)
 })
 expect(result.current.tasks).toEqual([entity])
 expect(result.current.confirmed).toEqual([])
 expect(result.current.jobs).toHaveLength(1)
 await act(async()=>complete(Response.json({state:'saved',task:entity,version:1})))
 expect(result.current.tasks).toEqual([entity])
 expect(result.current.confirmed).toEqual([entity])
 expect(result.current.jobs).toEqual([])
 expect(result.current.message).toBe('Saved')
 expect(fetcher.mock.calls.filter(([url])=>url===endpoint)).toHaveLength(1)
})

test('a rejected write rolls back the provisional change and retains its draft for review',async()=>{
 const fetcher=vi.fn(async(url:string)=>url===endpoint?Response.json({state:'failed',code:409},{status:409}):summary([entity],1))
 vi.stubGlobal('fetch',fetcher)
 const {result}=renderHook(useServerTasks,{wrapper:SyntheticWorkspaceSession})
 await waitFor(()=>expect(result.current.ready).toBe(true))
 act(()=>expect(result.current.save({...entity,completed:true})).toBe(true))
 await waitFor(()=>expect(result.current.message).toBe('Changed elsewhere. Review and try again.'))
 expect(result.current.tasks).toEqual([entity])
 expect(result.current.failed?.task.completed).toBe(true)
})

test('a dropped response is recovered on remount by reading the original receipt',async()=>{
 let operation=''
 const fetcher=vi.fn(async(url:string,request?:RequestInit)=>{
  if(url===endpoint){operation=JSON.parse(String(request?.body)).id;throw Error('Lost response')}
  if(url===endpoint+'/'+operation)return Response.json({state:'saved',task:entity,version:1})
  return summary([])
 })
 vi.stubGlobal('fetch',fetcher)
 const first=renderHook(useServerTasks,{wrapper:SyntheticWorkspaceSession})
 await waitFor(()=>expect(first.result.current.ready).toBe(true))
 act(()=>expect(first.result.current.save(entity)).toBe(true))
 expect(operation).toBeTruthy()
 first.unmount()
 const reopened=renderHook(useServerTasks,{wrapper:SyntheticWorkspaceSession})
 await waitFor(()=>expect(reopened.result.current.confirmed).toEqual([entity]))
 expect(fetcher.mock.calls.filter(([url])=>url===endpoint)).toHaveLength(1)
 expect(fetcher.mock.calls.some(([url])=>url===endpoint+'/'+operation)).toBe(true)
})

test('offline clients retain confirmed tasks and send no mutation',async()=>{
 vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
 localStorage.setItem('dcc.confirmed.tasks.'+owner,JSON.stringify({version:1,data:{tasks:[entity]}}))
 const fetcher=vi.fn(async(_url:string)=>{throw Error('Offline')})
 vi.stubGlobal('fetch',fetcher)
 const {result}=renderHook(useServerTasks,{wrapper:SyntheticWorkspaceSession})
 expect(result.current.tasks).toEqual([entity])
 act(()=>expect(result.current.save({...entity,completed:true})).toBe(false))
 expect(result.current.message).toBe('Connect to make changes')
 expect(fetcher.mock.calls.every(call=>call[0]!==endpoint)).toBe(true)
})
