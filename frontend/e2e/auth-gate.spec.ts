import {test,expect} from './authenticated'

test('signed-out users never see private cached workspace data',async({page})=>{
 await page.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated:false,configured:true}}))
 await page.addInitScript(()=>{const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id:'private',title:'Private cached task',date,notes:'private',completed:false}]))})
 await page.goto('http://127.0.0.1:5173/')
 await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
 await expect(page.getByText('Private cached task')).toHaveCount(0)
 await expect(page).toHaveURL(/\/login\?next=%2F$/)
})

test('a valid existing session restores the requested route',async({page})=>{
  let loginRequests=0
  await page.route('**/api/v1/auth/login',route=>{loginRequests++;return route.fulfill({json:{authenticated:true}})})
  await page.goto('http://127.0.0.1:5173/projects')
  await expect(page).toHaveURL('http://127.0.0.1:5173/projects')
  await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible()
  await expect(page.getByLabel('Username',{exact:true})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible()
  expect(loginRequests).toBe(0)
})

test('development logout posts an empty object and gates the preserved route',async({page})=>{
  let request:{method:string;body:string|null}|undefined
  await page.addInitScript(()=>{localStorage.setItem('productivity-app.tasks.v1','[]');localStorage.setItem('daymark.planner.v1','kept-draft')})
  await page.route('**/api/v1/auth/logout',route=>{request={method:route.request().method(),body:route.request().postData()};return route.fulfill({json:{authenticated:false}})})
  await page.goto('http://127.0.0.1:5173/projects')
  await page.getByRole('button',{name:'Sign out / test login',exact:true}).click()
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/)
  expect(request).toEqual({method:'POST',body:'{}'})
  expect(await page.evaluate(()=>localStorage.getItem('daymark.planner.v1'))).toBe('kept-draft')
  await expect(page.getByRole('toolbar',{name:'Development tools'})).toHaveCount(0)
})

test('Settings logout uses the real endpoint and preserves the Settings return route',async({page})=>{
  let body:string|null=null
  await page.route('**/api/v1/auth/logout',route=>{body=route.request().postData();return route.fulfill({json:{authenticated:false}})})
  await page.goto('http://127.0.0.1:5173/settings')
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/)
  expect(body).toBe('{}')
})

test('a protected 401 returns to login without changing browser drafts',async({page})=>{
 const plannerDraft=JSON.stringify({snapshot:{preparations:[],projects:[],actions:[],status:{}},pending:[]})
 const taskDraft=JSON.stringify([{id:'draft',title:'Unsynced browser task',date:'2026-10-06',notes:'keep',completed:false}])
 await page.addInitScript(({plannerDraft,taskDraft})=>{localStorage.setItem('daymark.planner.v1',plannerDraft);localStorage.setItem('productivity-app.tasks.v1',taskDraft)},{plannerDraft,taskDraft})
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({status:401,json:{error:'Sign in required'}}))
 await page.goto('http://127.0.0.1:5173/projects')
 await expect(page.getByLabel('Username',{exact:true})).toBeVisible()
 await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/)
 expect(await page.evaluate(()=>localStorage.getItem('daymark.planner.v1'))).toBe(plannerDraft)
 expect(await page.evaluate(()=>localStorage.getItem('productivity-app.tasks.v1'))).toBe(taskDraft)
})

test('a backend 503 shows retry and enters after session recovery',async({page})=>{
 let attempts=0
 await page.route('**/api/v1/auth/session',route=>{attempts++;return attempts===1?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{authenticated:true,configured:true}})})
 await page.goto('http://127.0.0.1:5173/projects')
 await expect(page.getByRole('heading',{name:'Connection unavailable'})).toBeVisible()
 await expect(page.getByText(/credentials/i)).toHaveCount(0)
 await page.getByRole('button',{name:'Retry',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible()
 await expect(page).toHaveURL('http://127.0.0.1:5173/projects')
})

test('successful login restores the preserved internal path',async({page})=>{
 await page.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated:false,configured:true}}))
 await page.route('**/api/v1/auth/login',route=>route.fulfill({json:{authenticated:true}}))
 await page.goto('http://127.0.0.1:5173/inbox')
 await page.getByLabel('Username',{exact:true}).fill('synthetic-user')
 await page.getByLabel('Password',{exact:true}).fill('synthetic-password')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await expect(page).toHaveURL('http://127.0.0.1:5173/inbox')
 await expect(page.getByRole('heading',{name:'Inbox',exact:true})).toBeVisible()
})
