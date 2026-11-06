// Finite real-Web-Lock/reload races against a strict synthetic collection API.
// No model, provider or database is used. Logs contain only known synthetic IDs
// and version/deletion stages, never arbitrary request bodies or user content.
import {test,expect,saveSyntheticTasks} from './authenticated'
import type {SharedTask} from '../src/sharedTasks'
import type {Request} from '@playwright/test'

for(const seed of Array.from({length:10},(_,i)=>20261105+i)){
 test(`pending Undo survives immediate reload and duplicate clicks, seed ${seed}`,async({page},testInfo)=>{
  const original:SharedTask={id:`undo-${seed}`,title:'Practice questions',date:'2026-11-05',notes:'Review mistakes',completed:false,important:true,futureMetadata:{synthetic:true,seed}}
  const state={manualTasks:[original],manualVersion:1}
  const events:{id:string;stage:string;version:number;code?:number;restored?:boolean}[]=[]
  let pauseNextGet=false,getHeld=false,releaseGet=()=>{}
  let heldRequest:Request|undefined,heldOutcome:'finished'|'failed'|undefined,heldRouteDone=false
  const terminal=new Map<Request,'finished'|'failed'>()
  const settled=(request:Request,outcome:'finished'|'failed')=>{
   if(request.method()!=='GET'||new URL(request.url()).pathname!=='/api/v1/planner/manual-tasks')return
   terminal.set(request,outcome)
   if(request===heldRequest)heldOutcome=outcome
  }
  page.on('requestfinished',request=>settled(request,'finished'))
  page.on('requestfailed',request=>settled(request,'failed'))
  const getGate=new Promise<void>(resolve=>{releaseGet=resolve})
  await page.clock.install({time:new Date('2026-11-05T12:00:00')})
  await page.addInitScript(task=>{
   if(localStorage.getItem('productivity-app.tasks.v1')===null)localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([task]))
   if(localStorage.getItem('dcc.manual-tasks.base.v1')===null)localStorage.setItem('dcc.manual-tasks.base.v1',JSON.stringify([task]))
  },original)
  await page.route('**/api/v1/planner/manual-tasks',async route=>{
   if(route.request().method()==='GET'){
    const snapshot=JSON.parse(JSON.stringify({version:state.manualVersion,data:{tasks:state.manualTasks}}))
    const held=pauseNextGet
    if(held){pauseNextGet=false;getHeld=true;heldRequest=route.request();heldOutcome=terminal.get(heldRequest);events.push({id:original.id,stage:'held-get',version:snapshot.version});await getGate}
    try{await route.fulfill({json:snapshot})}catch(error){if(!held||!route.request().failure())throw error}finally{if(held)heldRouteDone=true}
    return
   }
   const wasDeleted=state.manualTasks[0]?.deleted===true
   const result=saveSyntheticTasks(state,route.request().postDataJSON())
   events.push({id:original.id,stage:'post',version:state.manualVersion,code:result.code,restored:result.code===200&&wasDeleted&&state.manualTasks[0]?.deleted===false})
   await route.fulfill({status:result.code,json:result})
  })
  try{
   await page.goto('/')
   await page.getByRole('button',{name:'Expand Practice questions',exact:true}).click()
   await expect(page.getByLabel('Important',{exact:true})).toBeChecked()
   await page.getByRole('button',{name:'Delete task',exact:true}).click()
   await expect(page.getByRole('button',{name:'Expand Practice questions',exact:true})).toHaveCount(0)
   await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeVisible()
   await expect.poll(()=>state.manualTasks[0]?.deleted).toBe(true)
   await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dcc.manual-tasks.base.v1')??'[]')[0]?.deleted)).toBe(true)
   if(seed%2===0){
    pauseNextGet=true
    await page.getByText('Task sync',{exact:true}).click()
    await page.getByRole('button',{name:'Sync tasks',exact:true}).click()
    await expect.poll(()=>getHeld).toBe(true)
   }
   await page.evaluate(()=>{
    const synthetic=window as typeof window&{undoLockHeld?:boolean}
    void navigator.locks.request('daymark.manual-tasks.v1',async()=>{
     synthetic.undoLockHeld=true
     await new Promise<void>(()=>{/* This old document's lock releases on reload. */})
    })
   })
   await expect.poll(()=>page.evaluate(()=>(window as typeof window&{undoLockHeld?:boolean}).undoLockHeld)).toBe(true)
   await page.getByRole('button',{name:'Undo',exact:true}).click({clickCount:seed%3===0?2:1})
   await expect(page.getByRole('button',{name:'Restoring…',exact:true})).toBeDisabled()
   await expect(page.getByText('Restoring task… Undo is retained in this tab for recovery after reload.',{exact:false})).toBeVisible()
   const staged=await page.evaluate(()=>({pending:JSON.parse(sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1')!),saved:JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)}))
   expect(staged.pending.expected).toEqual({...original,deleted:true})
   expect(staged.saved).toEqual([{...original,deleted:true}])
   if(getHeld){
    releaseGet()
    await expect.poll(()=>heldRouteDone).toBe(true)
    await expect.poll(()=>heldOutcome).toMatch(/^(finished|failed)$/)
    if(heldOutcome==='finished'){
     const response=await heldRequest!.response()
     expect(response?.status()).toBe(200)
     expect(await response!.finished()).toBeNull()
     expect((await response!.json()).data.tasks[0].deleted).toBe(true)
    }else expect(heldRequest!.failure()?.errorText).toMatch(/ERR_ABORTED|ERR_FAILED/)
    events.push({id:original.id,stage:`held-get-${heldOutcome}`,version:state.manualVersion})
   }
   await page.reload() // No wait for Undo's storage grant: the old lock still held it.
   await page.getByRole('button',{name:'Important',exact:true}).click()
   await expect(page.getByRole('button',{name:'Expand Practice questions',exact:true})).toBeVisible()
   await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!))).toEqual([{...original,deleted:false}])
   await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1'))).toBeNull()
   await expect.poll(()=>state.manualTasks).toEqual([{...original,deleted:false}])
   expect(events.filter(event=>event.restored)).toHaveLength(1)
   await page.getByRole('button',{name:'Expand Practice questions',exact:true}).click()
   await expect(page.getByLabel('Important',{exact:true})).toBeChecked()
   await expect(page.getByLabel('Practice questions notes')).toHaveValue('Review mistakes')
  }finally{
   releaseGet()
   await testInfo.attach('synthetic-undo-stages',{body:JSON.stringify({seed,events}),contentType:'application/json'})
  }
 })
}

test('synthetic task API rejects stale changes/stripped tombstones and permits exact idempotent readback',()=>{
 const old:SharedTask={id:'synthetic-cas',title:'Synthetic',date:'2026-11-05',notes:'',completed:false,deleted:true,futureMetadata:{synthetic:true}}
 const state={manualTasks:[old],manualVersion:3}
 expect(saveSyntheticTasks(state,{version:2,tasks:[{...old,deleted:false}]}).code).toBe(409)
 expect(saveSyntheticTasks(state,{version:3,tasks:[]}).code).toBe(409)
 expect(saveSyntheticTasks(state,{version:2,tasks:[old]})).toEqual({code:200,version:3})
 const {futureMetadata:_metadata,...legacy}=old
 expect(saveSyntheticTasks(state,{version:3,tasks:[{...legacy,deleted:false}]}).code).toBe(200)
 expect(state.manualTasks).toEqual([{...old,deleted:false}])
 expect(state.manualVersion).toBe(4)
})
