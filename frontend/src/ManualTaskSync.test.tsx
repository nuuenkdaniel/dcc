import type {ReactNode} from 'react'
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import App from './App'
import type {SharedTask} from './sharedTasks'

vi.mock('./AuthGate',()=>({AuthGate:({children}:{children:ReactNode})=>children}))
const TASKS='productivity-app.tasks.v1',BASE='dcc.manual-tasks.base.v1'
const response=(data:unknown)=>({ok:true,status:200,json:async()=>data}) as Response
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
const locks=navigator.locks
beforeEach(()=>{localStorage.clear();window.history.replaceState({},'','/')})
afterEach(()=>{vi.unstubAllGlobals();Object.defineProperty(navigator,'locks',{configurable:true,value:locks})})

function scenario(pauseAutomatic:boolean){
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 const original:SharedTask={id:'local',title:'Local task',date,notes:'',completed:false}
 const incoming:SharedTask={...original,id:'incoming',title:'Remote addition'}
 let server=[original],gets=0,pause=pauseAutomatic
 const readback=deferred<{data:{tasks:SharedTask[]}}>()
 const writes:(()=>Promise<void>)[]=[]
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,...args:unknown[])=>{
  const callback=args.at(-1) as ()=>unknown
  if(name!=='daymark.manual-tasks.v1')return Promise.resolve(callback())
  return new Promise((resolve,reject)=>writes.push(async()=>{try{resolve(await callback())}catch(error){reject(error)}}))
 }}})
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{
  if(String(input)!=='/api/v1/planner/manual-tasks')return {ok:false,status:503,json:async()=>({})} as Response
  if(options?.method==='POST'){server=JSON.parse(String(options.body)).tasks;return response({version:2})}
  gets++
  if(pause&&gets%2===0){pause=false;return {...response({}),json:()=>readback.promise}}
  return response({version:1,data:{tasks:server}})
 }))
 localStorage.setItem(TASKS,JSON.stringify([original]))
 return {original,incoming,writes,get server(){return server},get gets(){return gets},pause(){pause=true},releaseReadback(tasks=[original,incoming]){server=tasks;readback.resolve({data:{tasks:server}})}}
}

async function drain(writes:(()=>Promise<void>)[]){
 for(let i=0;i<12;i++)await act(async()=>{await writes.shift()?.()})
 expect(writes).toHaveLength(0)
}

it.each(['automatic completion','manual add'])('%s overlapping sync apply retains the user intent without a false external-tab warning',async mode=>{
 const s=scenario(mode==='automatic completion');render(<App/> )
 if(mode==='manual add'){
  await waitFor(()=>expect(s.gets).toBe(2));await drain(s.writes)
  await screen.findByText('Tasks synced.')
  s.pause();fireEvent.click(screen.getByRole('button',{name:'Sync tasks'}))
 }
 await waitFor(()=>expect(s.gets).toBe(mode==='manual add'?4:2))
 if(mode==='automatic completion')fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 else {fireEvent.change(screen.getByLabelText('Task title'),{target:{value:'New local task'}});fireEvent.click(screen.getByRole('button',{name:'Add task'}))}
 await act(async()=>{s.releaseReadback()})
 await drain(s.writes)
 expect(screen.queryByText(/Tasks changed in another tab/)).not.toBeInTheDocument()
 await screen.findByText('Tasks synced.')
 const saved=JSON.parse(localStorage.getItem(TASKS)!) as SharedTask[]
 expect(saved).toContainEqual(s.incoming)
 if(mode==='automatic completion'){
  expect(saved.find(t=>t.id==='local')?.completed).toBe(true)
  expect(screen.getByRole('checkbox',{name:'Complete Local task'})).toBeChecked()
 }else expect(saved.some(t=>t.title==='New local task')).toBe(true)
 expect(screen.queryByText(/Tasks changed in another tab/)).not.toBeInTheDocument()
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(BASE)!)).toEqual(s.server))
 expect(s.server).toHaveLength(saved.length)
 expect(s.server).toEqual(expect.arrayContaining(saved))
 expect(s.gets).toBeLessThanOrEqual(8)
})

it('a genuine external storage edit while a completion waits still fails closed visibly',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 const external={...s.original,title:'External saved edit'}
 // Another tab writes under the shared lock before this page obtains it;
 // its storage event has not reached this page yet.
 localStorage.setItem(TASKS,JSON.stringify([external]))
 await drain(s.writes)
 expect(screen.getByRole('alert')).toHaveTextContent(/Tasks changed in another tab/)
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual([external])
 expect(screen.getByRole('checkbox',{name:'Complete External saved edit'})).not.toBeChecked()
})

it('a completion queued after sync reconciliation starts is also retained',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 await act(async()=>{s.releaseReadback()})
 expect(s.writes).toHaveLength(1)
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 await drain(s.writes)
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual(expect.arrayContaining([{...s.original,completed:true},s.incoming]))
 expect(screen.queryByText(/Tasks changed in another tab/)).not.toBeInTheDocument()
 expect(screen.getByRole('checkbox',{name:'Complete Local task'})).toBeChecked()
 expect(s.gets).toBeLessThanOrEqual(8)
})

it('external modification before the sync storage lock is acquired rejects readback and does not advance its baseline',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 await act(async()=>{s.releaseReadback([{...s.original,completed:true},s.incoming])})
 expect(s.writes).toHaveLength(1)
 const external={...s.original,title:'External saved edit'}
 localStorage.setItem(TASKS,JSON.stringify([external]))
 await drain(s.writes)
 expect(screen.getByRole('alert')).toHaveTextContent(/Tasks changed in another tab/)
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual([external])
 expect(localStorage.getItem(BASE)).toBeNull()
})

it('a queued completion already represented by this page\'s sync is a guarded no-op',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 await act(async()=>{s.releaseReadback([{...s.original,completed:true},s.incoming])})
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 await drain(s.writes)
 expect(screen.queryByRole('alert')).not.toBeInTheDocument()
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual(expect.arrayContaining([{...s.original,completed:true},s.incoming]))
 expect(screen.getByRole('checkbox',{name:'Complete Local task'})).toBeChecked()
})

it('a competing sync edit rejects a queued user edit with honest sync conflict messaging',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 const remote={...s.original,title:'Remote changed title'}
 await act(async()=>{s.releaseReadback([remote,s.incoming])})
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 await drain(s.writes)
 expect(screen.getByRole('alert')).toHaveTextContent(/Tasks changed while syncing or editing/)
 expect(screen.queryByText(/Tasks changed in another tab/)).not.toBeInTheDocument()
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual(expect.arrayContaining([remote,s.incoming]))
 expect(screen.getByRole('checkbox',{name:'Complete Remote changed title'})).not.toBeChecked()
})

it('an already represented completion still checks for an external write under its storage lock',async()=>{
 const s=scenario(true);render(<App/> )
 await waitFor(()=>expect(s.gets).toBe(2))
 await act(async()=>{s.releaseReadback([{...s.original,completed:true},s.incoming])})
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete Local task'}))
 await act(async()=>{await s.writes.shift()!()})
 expect(s.writes).toHaveLength(1)
 const external={...s.original,title:'External saved edit',completed:true}
 localStorage.setItem(TASKS,JSON.stringify([external,s.incoming]))
 await drain(s.writes)
 expect(screen.getByRole('alert')).toHaveTextContent(/Tasks changed in another tab/)
 expect(JSON.parse(localStorage.getItem(TASKS)!)).toEqual([external,s.incoming])
})
