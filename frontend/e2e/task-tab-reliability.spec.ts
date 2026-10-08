import {test,expect,mockAuthenticatedApi} from './authenticated'

test('two tabs preserve create edit delete and undo while sync is in flight',async({browser})=>{
 const context=await browser.newContext()
 await mockAuthenticatedApi(context)
 let version=0,tasks:any[]=[]
 let releaseFirstGet:()=>void=()=>{}
 const firstGet=new Promise<void>(resolve=>{releaseFirstGet=resolve})
 let held=false
 await context.route('**/api/v1/planner/manual-tasks',async route=>{
  if(route.request().method()==='GET'){
   if(!held){held=true;await firstGet}
   return route.fulfill({json:{version,data:{tasks}}})
  }
  const body=route.request().postDataJSON()
  if(body.version!==version)return route.fulfill({status:409,json:{error:'Changed'}})
  tasks=body.tasks;version++
  return route.fulfill({json:{code:200}})
 })
 try{
  const a=await context.newPage(),b=await context.newPage()
  await Promise.all([a.goto('/'),b.goto('/')])
  await a.getByLabel('Task title',{exact:true}).fill('From tab A')
  await a.getByRole('button',{name:'Add task',exact:true}).click()
  await b.getByLabel('Task title',{exact:true}).fill('From tab B')
  await b.getByRole('button',{name:'Add task',exact:true}).click()
  releaseFirstGet()
  await expect.poll(async()=>JSON.parse(await a.evaluate(()=>localStorage.getItem('productivity-app.tasks.v1')!)).filter((t:any)=>!t.deleted).length).toBe(2)
  await a.reload();await a.getByRole('button',{name:'Expand From tab A',exact:true}).click();await a.getByLabel('From tab A name').fill('Edited in A')
  await b.reload();await b.getByRole('button',{name:'Expand From tab B',exact:true}).click();await b.getByRole('button',{name:'Delete task',exact:true}).click()
  await expect(b.getByRole('button',{name:'Expand From tab B',exact:true})).toHaveCount(0)
  await expect.poll(async()=>{const stored=await b.evaluate(()=>JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!));return stored.find((t:any)=>t.title==='From tab B')?.deleted}).toBe(true)
  await b.getByRole('button',{name:'Undo',exact:true}).click()
  await expect.poll(async()=>JSON.parse(await a.evaluate(()=>localStorage.getItem('productivity-app.tasks.v1')!)).filter((t:any)=>!t.deleted).map((t:any)=>t.title).sort()).toEqual(['Edited in A','From tab B'])
  await expect.poll(()=>tasks.some(t=>t.title==='Edited in A')&&tasks.some(t=>t.title==='From tab B'&&t.deleted===false)).toBe(true)
 }finally{releaseFirstGet();await context.close()}
})
