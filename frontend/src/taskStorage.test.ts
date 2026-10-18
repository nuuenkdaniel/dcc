import {beforeEach,expect,test} from 'vitest'
import {TaskWriteConflict,applyTaskIntent,readStoredTasks,type TaskIntent} from './taskStorage'
import type {SharedTask} from './sharedTasks'

const task=(id:string,title=id):SharedTask=>({id,title,date:'2026-10-06',notes:'',completed:false})

beforeEach(()=>localStorage.clear())

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
