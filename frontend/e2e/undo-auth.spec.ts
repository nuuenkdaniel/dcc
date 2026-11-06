// Real browser locks/auth-gate lifecycle; all HTTP responses/data are synthetic.
import {test,expect,saveSyntheticTasks} from './authenticated'
import type {Page,Request,Route} from '@playwright/test'
import type {SharedTask} from '../src/sharedTasks'

const OWNER_A='a'.repeat(64),OWNER_B='b'.repeat(64)
type ReadPhase='capturing'|'signed-out'|'relogged'
async function prepare(page:Page,id:string){
 const original:SharedTask={id,title:'Auth Undo',date:'2026-11-05',notes:'Keep synthetic notes',important:true,completed:false,futureMetadata:{synthetic:true}}
 const state={manualTasks:[original],manualVersion:1}
 await page.clock.install({time:new Date('2026-11-05T12:00:00')})
 await page.addInitScript(task=>{
  if(localStorage.getItem('productivity-app.tasks.v1')===null)localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task]))
  if(localStorage.getItem('dcc.manual-tasks.base.v1')===null)localStorage.setItem('dcc.manual-tasks.base.v1',JSON.stringify([task]))
 },original)
 await page.route('**/api/v1/planner/manual-tasks',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{version:state.manualVersion,data:{tasks:state.manualTasks}}})
  const result=saveSyntheticTasks(state,route.request().postDataJSON());return route.fulfill({status:result.code,json:result})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Expand Auth Undo',exact:true}).click()
 await page.getByRole('button',{name:'Delete task',exact:true}).click()
 await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible()
 await expect.poll(()=>state.manualTasks[0]?.deleted).toBe(true)
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dcc.manual-tasks.base.v1')??'[]')[0]?.deleted)).toBe(true)
 return {original,state}
}
const saved=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!))
const pending=(page:Page)=>page.evaluate(()=>sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1'))

for(const chain of ['direct-event','cached-http-401','logout-response'] as const)
for(const loginOwner of [OWNER_A,OWNER_B])test(`queued Undo cancels through ${chain}; ${loginOwner===OWNER_A?'same owner recovers':'changed owner is quarantined'}`,async({page})=>{
 let authenticated=true,currentOwner=OWNER_A,nextOwner=loginOwner
 let readPhase:ReadPhase='capturing',unexpectedOldReads=0
 const issued=new Map<Request,ReadPhase>(),terminal=new Map<Request,'finished'|'failed'>()
 const expiredReads:{id:number;request:Request;route:Route}[]=[]
 const isPriceRead=(request:Request)=>new URL(request.url()).pathname==='/api/v1/prices/snapshot'
 page.on('request',request=>{if(isPriceRead(request))issued.set(request,readPhase)})
 page.on('requestfinished',request=>{if(isPriceRead(request))terminal.set(request,'finished')})
 page.on('requestfailed',request=>{if(isPriceRead(request))terminal.set(request,'failed')})
 await page.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated,configured:true,...(authenticated?{workspaceOwner:currentOwner}:{})}}))
 await page.route('**/api/v1/auth/login',route=>{
  expect(route.request().postDataJSON()).toEqual({username:'synthetic-user',password:'synthetic-only'})
  authenticated=true;currentOwner=nextOwner;readPhase='relogged'
  return route.fulfill({json:{authenticated:true,workspaceOwner:currentOwner}})
 })
 let deniedReads=0,logoutResponses=0
 await page.route('**/api/v1/auth/logout',route=>{
  expect(route.request().method()).toBe('POST');expect(route.request().postData()).toBe('{}')
  authenticated=false;logoutResponses++
  return route.fulfill({json:{authenticated:false}})
 })
 const {original,state}=await prepare(page,'auth-undo')
 await page.evaluate(()=>{
  const testState=window as typeof window&{heldUndoLock?:boolean;releaseUndoLock?:()=>void}
  void navigator.locks.request('daymark.manual-tasks.v1',async()=>{testState.heldUndoLock=true;await new Promise<void>(resolve=>{testState.releaseUndoLock=resolve})})
 })
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{heldUndoLock?:boolean}).heldUndoLock)).toBe(true)
 await page.getByRole('button',{name:'Undo',exact:true}).click()
 await expect(page.getByRole('button',{name:'Restoring…',exact:true})).toBeDisabled()
 const raw=await pending(page)
 expect(JSON.parse(raw!).owner).toBe(OWNER_A)
 if(chain==='direct-event'){
  authenticated=false
  await page.evaluate(()=>window.dispatchEvent(new Event('dcc-auth-required')))
 }else if(chain==='cached-http-401'){
  await page.evaluate(()=>{
   const state=window as typeof window&{authUndo401Events?:number}
   state.authUndo401Events=0
   window.addEventListener('dcc-auth-required',()=>{state.authUndo401Events=(state.authUndo401Events??0)+1})
  })
  await page.route('**/api/v1/prices/snapshot',route=>{
   const request=route.request(),phase=issued.get(request)
   expect(request.method()).toBe('GET')
   // A request issued under the expired scope must never fall through to a
   // successful post-login fixture response, even if its route arrives late.
   if(phase==='relogged'&&authenticated)return route.fallback()
   if(phase!=='capturing'||expiredReads.length===2){unexpectedOldReads++;return route.abort('failed')}
   expiredReads.push({id:expiredReads.length+1,request,route})
   // Hold both StrictMode mount reads until the exact request set is known.
  })
  await page.getByRole('button',{name:'Price tracker',exact:true}).click()
  await expect.poll(()=>expiredReads.length).toBe(2)
  expect(unexpectedOldReads).toBe(0)
  const selected=expiredReads[0]!
  const response=page.waitForResponse(r=>r.request()===selected.request&&r.status()===401)
  authenticated=false
  await selected.route.fulfill({status:401,json:{error:'Synthetic expired session'}});deniedReads++
  expect(await (await response).finished()).toBeNull()
  // Prices -> protectedFetch -> reportAuthRequired -> AuthGate. The companion
  // is still held, so this login transition is attributable to selected ID1.
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{authUndo401Events?:number}).authUndo401Events)).toBe(1)
  readPhase='signed-out'
  const companion=expiredReads[1]!
  const companionResponse=page.waitForResponse(r=>r.request()===companion.request&&r.status()===401)
  await companion.route.fulfill({status:401,json:{error:'Synthetic expired session'}});deniedReads++
  expect(await (await companionResponse).finished()).toBeNull()
  await expect.poll(()=>expiredReads.map(entry=>terminal.get(entry.request))).toEqual(['finished','finished'])
  // Network completion alone is not JS-handler completion. Drain both real
  // protectedFetch expiry events before allowing any login response.
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{authUndo401Events?:number}).authUndo401Events)).toBe(2)
  expect(expiredReads.map(entry=>({id:entry.id,path:new URL(entry.request.url()).pathname,method:entry.request.method(),phase:issued.get(entry.request)}))).toEqual([1,2].map(id=>({id,path:'/api/v1/prices/snapshot',method:'GET',phase:'capturing'})))
 }else{
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/logout'&&r.status()===200)
  await page.getByRole('button',{name:'Sign out / test login',exact:true}).click()
  expect(await (await response).json()).toEqual({authenticated:false})
 }
 await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
 expect(deniedReads).toBe(chain==='cached-http-401'?2:0)
 expect(unexpectedOldReads).toBe(0)
 expect(logoutResponses).toBe(chain==='logout-response'?1:0)
 await page.evaluate(()=>(window as typeof window&{releaseUndoLock?:()=>void}).releaseUndoLock?.())
 await expect.poll(()=>page.evaluate(async()=>{const q=await navigator.locks.query();return [...(q.held??[]),...(q.pending??[])].filter(lock=>lock.name==='daymark.manual-tasks.v1').length})).toBe(0)
 expect(await saved(page)).toEqual([{...original,deleted:true}])
 expect(await pending(page)).toBe(raw)
 expect(state.manualTasks).toEqual([{...original,deleted:true}])
 const login=async()=>{await page.getByLabel('Username',{exact:true}).fill('synthetic-user');await page.getByLabel('Password',{exact:true}).fill('synthetic-only');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Home',exact:true}).click()}
 await login()
 if(loginOwner===OWNER_B){
  await expect(page.getByText('Pending Undo is quarantined:',{exact:false})).toBeVisible()
  await expect(page.getByRole('button',{name:'Review and restore Undo',exact:true})).toBeDisabled()
  expect(await saved(page)).toEqual([{...original,deleted:true}]);expect(await pending(page)).toBe(raw)
  expect(state.manualTasks).toEqual([{...original,deleted:true}])
  nextOwner=OWNER_A;authenticated=false
  await page.evaluate(()=>window.dispatchEvent(new Event('dcc-auth-required')))
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible();await login()
 }
 await expect(page.getByRole('button',{name:'Expand Auth Undo',exact:true})).toBeVisible()
 await expect.poll(()=>saved(page)).toEqual([{...original,deleted:false}])
 await expect.poll(()=>pending(page)).toBeNull()
 await expect.poll(()=>state.manualTasks).toEqual([{...original,deleted:false}])
 await page.getByRole('button',{name:'Expand Auth Undo',exact:true}).click()
 await expect(page.getByLabel('Auth Undo notes')).toHaveValue('Keep synthetic notes')
 await expect(page.getByLabel('Important',{exact:true})).toBeChecked()
 expect(unexpectedOldReads).toBe(0)
 expect(deniedReads).toBe(chain==='cached-http-401'?2:0)
 expect(logoutResponses).toBe(chain==='logout-response'?1:0)
})

test('real storage-write failure retains owner-bound Undo; same-owner reload recovers exact metadata',async({page})=>{
 const {original}=await prepare(page,'storage-undo')
 await page.evaluate(()=>{
  const originalSet=Storage.prototype.setItem
  Storage.prototype.setItem=function(key,value){
   if(this===localStorage&&key==='productivity-app.tasks.v1'&&JSON.parse(value).some((task:{id:string;deleted?:boolean})=>task.id==='storage-undo'&&task.deleted===false))throw new DOMException('Synthetic restore storage failure','QuotaExceededError')
   originalSet.call(this,key,value)
  }
 })
 await page.getByRole('button',{name:'Undo',exact:true}).click()
 await expect(page.getByRole('alert').filter({hasText:'Synthetic restore storage failure'})).toBeVisible()
 expect(await saved(page)).toEqual([{...original,deleted:true}])
 expect(JSON.parse((await pending(page))!).owner).toBe(OWNER_A)
 await page.reload() // Injection belongs to the destroyed document, not the fixture.
 await expect(page.getByRole('button',{name:'Expand Auth Undo',exact:true})).toBeVisible()
 await expect.poll(()=>saved(page)).toEqual([{...original,deleted:false}])
 await expect.poll(()=>pending(page)).toBeNull()
})
