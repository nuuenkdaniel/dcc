import {test,expect} from './authenticated'

test('production hides development logout while keeping Settings sign out',async({page})=>{
  await page.goto('http://127.0.0.1:4173/settings')
  await expect(page.getByRole('toolbar',{name:'Development tools'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Sign out / test login',exact:true})).toHaveCount(0)
})

test('a confirmed task survives a cold offline reload of the production app',async({page,context})=>{
 const origin='http://127.0.0.1:4173'
 const now=new Date()
 const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 let online=true,posts=0
 const task={id:'verified-offline',title:'Confirmed offline task',date,completed:false,notes:''}
 await page.route('**/api/v1/auth/session',route=>online?route.fulfill({json:{authenticated:true,configured:true,workspaceOwner:'a'.repeat(64)}}):route.abort())
 await page.route('**/api/v1/planner/manual-tasks',route=>online?route.fulfill({json:{version:1,data:{tasks:[task]}}}):route.abort())
 await page.route('**/api/v1/workspace/writes',route=>{posts++;return route.abort()})
 await page.goto(origin)
 await expect(page.getByText(task.title,{exact:true})).toBeVisible()
 await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true))
 await expect.poll(()=>page.evaluate(async()=>!!await (await caches.open('dcc-workspace-shell-v1')).match(location.origin+'/'))).toBe(true)
 online=false
 await context.setOffline(true)
 await page.reload({waitUntil:'domcontentloaded'})
 await expect(page.getByText(task.title,{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Add task'})).toBeDisabled()
 await expect(page.getByRole('button',{name:'Sync tasks'})).toHaveCount(0)
 expect(posts).toBe(0)
})
