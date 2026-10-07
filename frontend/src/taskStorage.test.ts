import {beforeEach,expect,test} from 'vitest'
import {TaskWriteConflict,applyTaskIntent,type TaskIntent} from './taskStorage'
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
 const saved=await applyTaskIntent({kind:'put',task:task('a','edited'),expected:task('a')})
 expect(saved).toEqual([{...stored,title:'edited'}])
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
