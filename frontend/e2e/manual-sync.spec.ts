import {test,expect,type BrowserContext} from '@playwright/test'
test('manual tasks sync between isolated clients without replacing unrelated tasks',async({browser})=>{
 let version=0;let tasks:any[]=[]
 const a=await browser.newContext(),b=await browser.newContext()
 async function setup(context:BrowserContext,id:string){
  await context.addInitScript(({id})=>localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id,title:id,date:'2026-10-04',notes:'',completed:false}])),{id})
  await context.route('**/api/v1/planner/manual-tasks',async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{version,data:{tasks}}})
   const body=route.request().postDataJSON();if(body.version!==version)return route.fulfill({status:409,json:{error:'Changed'}})
   tasks=body.tasks;version++;return route.fulfill({json:{code:200}})
  })
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173/');await page.getByText('Task sync',{exact:true}).click();return page
 }
 try{const pa=await setup(a,'first-client');const pb=await setup(b,'second-client');await pa.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect(pa.getByText('Tasks synced.',{exact:true})).toBeVisible();await pb.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect(pb.getByText('Tasks synced.',{exact:true})).toBeVisible();expect(tasks.map(t=>t.id).sort()).toEqual(['first-client','second-client']);await pa.getByRole('button',{name:'Sync tasks',exact:true}).click();await expect.poll(()=>pa.evaluate(()=>JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!).length)).toBe(2)}finally{await a.close();await b.close()}
})
