import {test,expect,mockAuthenticatedApi,type BrowserContext} from './authenticated'
test('manual tasks sync between isolated clients without replacing unrelated tasks',async({browser})=>{
 let version=0;let tasks:any[]=[]
 const a=await browser.newContext(),b=await browser.newContext()
 async function setup(context:BrowserContext,id:string){
  await mockAuthenticatedApi(context)
  await context.addInitScript(({id})=>localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id,title:id,date:'2026-10-04',notes:'',completed:false}])),{id})
  await context.route('**/api/v1/planner/manual-tasks',async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{version,data:{tasks}}})
   const body=route.request().postDataJSON();if(body.version!==version)return route.fulfill({status:409,json:{error:'Changed'}})
   tasks=body.tasks;version++;return route.fulfill({json:{code:200}})
  })
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173/');await page.getByText('Task sync',{exact:true}).click();await expect(page.getByText('Tasks synced.',{exact:true}),`${id} initial automatic sync`).toBeVisible();await expect(page.getByRole('button',{name:'Sync tasks',exact:true}),`${id} initial sync settled`).toBeEnabled();return page
 }
 let failure:unknown
 try{
  const pa=await setup(a,'first-client'),pb=await setup(b,'second-client')
  await pa.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect(pa.getByText('Tasks synced.',{exact:true}),'first client manual sync').toBeVisible();await expect(pa.getByRole('button',{name:'Sync tasks',exact:true}),'first client manual sync settled').toBeEnabled()
  await pb.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect(pb.getByText('Tasks synced.',{exact:true}),'second client manual sync').toBeVisible();await expect(pb.getByRole('button',{name:'Sync tasks',exact:true}),'second client manual sync settled').toBeEnabled()
  expect(tasks.map(t=>t.id).sort(),'server retains both clients').toEqual(['first-client','second-client'])
  await pa.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect.poll(()=>pa.evaluate(()=>JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!).length),{message:'first client readback contains both tasks'}).toBe(2)
 }catch(error){failure=error}
 finally{await Promise.allSettled([a.close(),b.close()])}
 if(failure)throw failure
})
