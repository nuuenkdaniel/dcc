import {beforeEach,expect,test,vi} from 'vitest'
import {TaskWriteConflict,applyTaskIntent,readStoredTasks,stageTaskRestore,commitPendingTaskRestore,PENDING_RESTORE_KEY,type TaskIntent} from './taskStorage'
import type {SharedTask} from './sharedTasks'

const task=(id:string,title=id):SharedTask=>({id,title,date:'2026-10-06',notes:'',completed:false})
const OWNER='a'.repeat(64)
const access=()=>({owner:OWNER,signal:new AbortController().signal,isCurrent:()=>true})

beforeEach(()=>{localStorage.clear();sessionStorage.clear()})

test('serialized intents re-read storage and preserve writes from another tab',async()=>{
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task('first')]))
 const second={kind:'put',task:task('second'),expected:null} satisfies TaskIntent
 expect(await applyTaskIntent(second)).toEqual([task('first'),task('second')])
})

test('stale edits report a conflict instead of overwriting a newer task',async()=>{
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task('a','newer')]))
 await expect(applyTaskIntent({kind:'put',task:task('a','stale edit'),expected:task('a')})).rejects.toBeInstanceOf(TaskWriteConflict)
 expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([task('a','newer')])
})

test('comparison normalizes optional booleans and preserves forward-compatible fields',async()=>{
 const stored={futureMetadata:{source:'newer-client'},deleted:false,important:false,...task('a')}
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([stored]))
 const saved=await applyTaskIntent({kind:'put',task:task('a','edited'),expected:{...task('a'),futureMetadata:stored.futureMetadata}})
 expect(saved).toEqual([{...stored,title:'edited'}])
})

test('recurrence-only stale edits and explicit metadata stripping fail closed',async()=>{
 const recurrence={version:1,kind:'template',frequency:'weekly',weekday:5,startDate:'2026-10-02',paused:false}
 const old={...task('a'),recurrence},newer={...old,recurrence:{...recurrence,paused:true}}
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([newer]))
 await expect(applyTaskIntent({kind:'put',task:{...old,title:'stale'},expected:old})).rejects.toBeInstanceOf(TaskWriteConflict)
 await expect(applyTaskIntent({kind:'put',task:task('a'),expected:newer})).rejects.toThrow(/recurrence/i)
 expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([newer])
})

test.each([
 {value:[{...task('a'),completed:'no'}]},
 {value:[task('a'),task('a','duplicate')]},
])('invalid or duplicate stored tasks fail closed without changing storage',async({value})=>{
 const raw=JSON.stringify(value)
 localStorage.setItem('productivity-app.tasks.v1',raw)
 await expect(applyTaskIntent({kind:'put',task:task('b'),expected:null})).rejects.toThrow(/Invalid task storage/)
 expect(localStorage.getItem('productivity-app.tasks.v1')).toBe(raw)
})

test('delete and undo are explicit tombstone intents',async()=>{
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task('a')]))
 const removed=await applyTaskIntent({kind:'delete',id:'a',expected:task('a')})
 expect(removed).toEqual([{...task('a'),deleted:true}])
 const restored=await applyTaskIntent({kind:'restore',id:'a',expected:{...task('a'),deleted:true}})
 expect(restored).toEqual([{...task('a'),deleted:false}])
})
test('Undo is durable before its deferred lock grant, and replay is exact/idempotent',async()=>{
  const locks=navigator.locks,callbacks:(()=>void)[]=[]
  const removed={...task('undo'),important:true,notes:'Retain notes',deleted:true,futureMetadata:{synthetic:true}}
  localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([removed]))
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,...args:unknown[])=>new Promise<SharedTask[]>((resolve,reject)=>callbacks.push(()=>{try{resolve((args.at(-1) as ()=>SharedTask[])())}catch(error){reject(error)}}))}})
  const writes=vi.spyOn(Storage.prototype,'setItem')
  try{
    stageTaskRestore(removed,OWNER)
    const oldPage=commitPendingTaskRestore(access())
    expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).not.toBeNull()
    expect(readStoredTasks()).toEqual([removed])
    const reloadedPage=commitPendingTaskRestore(access())
    callbacks[1]() // Reload recovers the staged intent before a stale callback.
    expect(await reloadedPage).toEqual([{...removed,deleted:false}])
    callbacks[0]()
    expect(await oldPage).toEqual([{...removed,deleted:false}])
    expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBeNull()
    expect(writes.mock.calls.filter(([key])=>key==='productivity-app.tasks.v1')).toHaveLength(1)
  }finally{writes.mockRestore();Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('pending Undo never overwrites a changed external tombstone and retains its durable intent',async()=>{
  const removed={...task('undo'),deleted:true,futureMetadata:{synthetic:true}}
  stageTaskRestore(removed,OWNER)
  const external={...removed,notes:'External edit'}
  localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([external]))
  await expect(commitPendingTaskRestore(access())).rejects.toBeInstanceOf(TaskWriteConflict)
  expect(readStoredTasks()).toEqual([external])
  expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).not.toBeNull()
})
test('cancelled queued restore checks lifecycle inside the lock and a new same-owner session can recover',async()=>{
 const removed={...task('cancelled'),deleted:true,futureMetadata:{synthetic:true}},locks=navigator.locks
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([removed]));stageTaskRestore(removed,OWNER)
 const raw=sessionStorage.getItem(PENDING_RESTORE_KEY),controller=new AbortController()
 let release=()=>{}
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,_options:unknown,callback:()=>SharedTask[])=>new Promise<SharedTask[]>((resolve,reject)=>{release=()=>{try{resolve(callback())}catch(error){reject(error)}}})}})
 try{
  const pending=commitPendingTaskRestore({owner:OWNER,signal:controller.signal,isCurrent:()=>!controller.signal.aborted})
  controller.abort();release()
  await expect(pending).rejects.toMatchObject({name:'AbortError'})
  expect(readStoredTasks()).toEqual([removed]);expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBe(raw)
 }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
 await expect(commitPendingTaskRestore({...access(),owner:'b'.repeat(64)})).rejects.toBeInstanceOf(TaskWriteConflict)
 expect(readStoredTasks()).toEqual([removed]);expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBe(raw)
 expect(await commitPendingTaskRestore(access())).toEqual([{...removed,deleted:false}])
})
test('legacy unverified Undo is quarantined until an explicit action binds the verified owner',async()=>{
 const removed={...task('legacy-undo'),deleted:true}
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([removed]))
 sessionStorage.setItem(PENDING_RESTORE_KEY,JSON.stringify({version:1,expected:removed}))
 await expect(commitPendingTaskRestore(access())).rejects.toBeInstanceOf(TaskWriteConflict)
 expect(readStoredTasks()).toEqual([removed])
 stageTaskRestore(removed,OWNER)
 expect(await commitPendingTaskRestore(access())).toEqual([{...removed,deleted:false}])
})
test('owner labels must be exact; malformed labels cannot stage or recover an Undo',async()=>{
 const removed={...task('owner-format'),deleted:true}
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([removed]))
 expect(()=>stageTaskRestore(removed,OWNER+'\n')).toThrow(TaskWriteConflict)
 stageTaskRestore(removed,OWNER)
 const raw=sessionStorage.getItem(PENDING_RESTORE_KEY)
 await expect(commitPendingTaskRestore({...access(),owner:OWNER+'\n'})).rejects.toBeInstanceOf(TaskWriteConflict)
 expect(readStoredTasks()).toEqual([removed]);expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBe(raw)
})
test.each(['stage','task-write','journal-clear'])('%s storage failure cannot lose the task or pretend an uncommitted Undo applied',async failure=>{
 const removed={...task('failure'),deleted:true,futureMetadata:{synthetic:true}}
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([removed]))
 const originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem
 const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(failure==='stage'&&this===sessionStorage&&key===PENDING_RESTORE_KEY||failure==='task-write'&&this===localStorage&&key==='productivity-app.tasks.v1')throw Error('Synthetic storage failure');originalSet.call(this,key,value)})
 const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key){if(failure==='journal-clear'&&this===sessionStorage&&key===PENDING_RESTORE_KEY)throw Error('Synthetic storage failure');originalRemove.call(this,key)})
 try{
  if(failure==='stage'){expect(()=>stageTaskRestore(removed,OWNER)).toThrow();expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBeNull()}
  else {stageTaskRestore(removed,OWNER);await expect(commitPendingTaskRestore(access())).rejects.toThrow();expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).not.toBeNull()}
  expect(readStoredTasks()).toEqual([{...removed,deleted:failure!=='journal-clear'}])
 }finally{set.mockRestore();remove.mockRestore()}
 if(failure!=='stage'){expect(await commitPendingTaskRestore(access())).toEqual([{...removed,deleted:false}]);expect(sessionStorage.getItem(PENDING_RESTORE_KEY)).toBeNull()}
})

test('unsupported Web Locks fail safely without writing',async()=>{
 const locks=navigator.locks
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task('a')]))
 await expect(applyTaskIntent({kind:'put',task:task('b'),expected:null})).rejects.toBeInstanceOf(TaskWriteConflict)
 expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([task('a')])
 Object.defineProperty(navigator,'locks',{configurable:true,value:locks})
})
test('the 10000 cap includes tombstones and rejects oversized existing storage',async()=>{
 const full=Array.from({length:10000},(_,i)=>({...task(`t-${i}`),deleted:true}))
 const raw=JSON.stringify(full);localStorage.setItem('productivity-app.tasks.v1',raw)
 await expect(applyTaskIntent({kind:'put',task:task('extra'),expected:null})).rejects.toThrow(/10000/)
 expect(localStorage.getItem('productivity-app.tasks.v1')).toBe(raw)
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([...full,task('extra')]))
 expect(()=>readStoredTasks()).toThrow(/Invalid task storage/)
})
