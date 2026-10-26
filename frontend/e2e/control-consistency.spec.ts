import {test,expect} from './authenticated'
import type {Page} from '@playwright/test'

const project={id:'control-project',title:'Control audit project',category:'personal',description:'Synthetic instructions',deadline:'2030-10-20',importance:2,remainingMinutes:90,progress:'',status:'active'}

async function expectThemed(page:Page,selector:string,pseudo?:string){
 const style=await page.locator(selector).first().evaluate((element,pseudo)=>{const value=getComputedStyle(element,pseudo);return {background:value.backgroundColor,color:value.color,border:value.borderStyle,radius:value.borderRadius}},pseudo)
 expect(style.background).not.toBe('rgb(239, 239, 239)')
 expect(style.background).not.toBe('rgb(255, 255, 255)')
 expect(style.color).not.toBe('rgb(0, 0, 0)')
 expect(style.border).not.toBe('outset')
 expect(style.radius).not.toBe('0px')
}

test('shared controls stay themed and operable across primary routes',async({page})=>{
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'calendar',name:'Synthetic calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 await page.route('**/api/v1/prices/snapshot',route=>route.fulfill({json:{items:[{id:'laptop',title:'Synthetic laptop · 32 GB',target_cents:280000,paused:false}],sources:[],history:[]}}))

 await page.goto('/')
 await expectThemed(page,'.task-form input')
 await expectThemed(page,'.task-form button')
 await expectThemed(page,'.schedule-actions button')
 await page.getByPlaceholder('Add a daily action…').fill('Synthetic control task')
 await page.getByRole('button',{name:'Add task',exact:true}).click()
 await expect(page.getByText('Synthetic control task',{exact:true})).toBeVisible()

 await page.goto('/inbox')
 await expectThemed(page,'.mail-controls select')
 await expectThemed(page,'.mail-controls input')
 await expectThemed(page,'.inbox-view .secondary-action')

 await page.goto('/prices')
 await page.getByText('Tracking settings',{exact:true}).click()
 await expectThemed(page,'.price-card input')
 await expectThemed(page,'.price-card .primary-action')
 await page.getByLabel('Target price (USD)').fill('2750')
 await page.getByRole('button',{name:'Save target',exact:true}).click()

 await page.goto('/settings')
 await expectThemed(page,'.settings-section input')
 await expectThemed(page,'.settings-section button')
 await expectThemed(page,'.project-editor textarea')
 await expectThemed(page,'.project-editor .primary-action')
 await page.getByLabel('Additional importance rules').fill('Synthetic rule')
 await page.getByRole('button',{name:'Save email rules',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Saved.'})).toBeVisible()

 await page.goto('/pomodoro')
 await page.setViewportSize({width:375,height:900})
 await page.getByRole('button',{name:'Timer settings'}).click()
 await expectThemed(page,'.timer-dialog input')
 await expectThemed(page,'.timer-dialog .dialog-done')
 await page.getByLabel('Mini timer name').fill('Synthetic focus block')
 await page.getByRole('button',{name:'Add mini timer'}).click()
 await expect(page.locator('.timer-dialog').getByText('Synthetic focus block',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('expanded project and study forms theme text, select, file, and dialog controls at 375px',async({page})=>{
 const event={id:'exam',calendarId:'calendar',uid:'exam-uid',recurrenceId:null,title:'Synthetic exam',start:'2030-10-12',end:'2030-10-13',allDay:true,description:'',location:''}
 await page.clock.install({time:new Date('2030-10-12T12:00:00')})
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{kind:'project',version:1,data:project}],actions:[],preparations:[],status:{}}}))
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'calendar',name:'Synthetic calendar'}],events:[event],lastSuccess:new Date().toISOString()}}))
 await page.setViewportSize({width:375,height:1000})

 await page.goto('/projects')
 await page.getByRole('button',{name:'Edit Control audit project'}).click()
 await expectThemed(page,'.projects-view > .project-editor textarea')
 await expectThemed(page,'.projects-view > .project-editor select')
 await expectThemed(page,'.project-file-input','::file-selector-button')
 await page.getByLabel('Attach instructions').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic study material')})
 await expect(page.getByText('synthetic.txt',{exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)

 await page.goto('/')
 await page.getByText('Synthetic exam',{exact:true}).click()
 await page.getByRole('button',{name:'Prepare for this event'}).click()
 await expectThemed(page,'.preparation-panel select')
 await expectThemed(page,'.preparation-panel textarea')
 await expectThemed(page,'.preparation-panel input[type="file"]','::file-selector-button')
 await expect(page.getByRole('button',{name:'Save preparation'})).toBeDisabled()
 await page.getByLabel('Upload study material').setInputFiles({name:'study.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic study material')})
 await expect(page.getByText('Text extracted. Review it below before asking Hermes.',{exact:true})).toBeVisible()

 await page.getByRole('button',{name:'New event',exact:true}).click()
 await expectThemed(page,'.calendar-login input')
 await expectThemed(page,'.calendar-login select')
 await expectThemed(page,'.calendar-login textarea')
 await expectThemed(page,'.calendar-login .primary-action')
 await page.getByLabel('Event title').fill('Operable dialog')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('conflicts and pending outbox drafts use semantic actions without native defaults',async({page})=>{
 await page.addInitScript(project=>localStorage.setItem('daymark.planner.v1',JSON.stringify({snapshot:{projects:[{kind:'project',version:2,data:project}],actions:[],preparations:[],status:{}},pending:[{kind:'project',version:1,data:{...project,title:'Retained local project'}}]})),project)
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{kind:'project',version:2,data:project}],actions:[],preparations:[],status:{}}}))
 await page.route('**/api/v1/planner/entity',route=>route.fulfill({status:409,json:{error:'Synthetic conflict'}}))
 await page.goto('/projects')
 await expect(page.getByRole('heading',{name:'Review conflicting edits'})).toBeVisible()
 await expectThemed(page,'.planner-conflict .primary-action')
 await expectThemed(page,'.planner-conflict .danger-action')
 await page.getByRole('button',{name:'Discard my draft'}).click()
 await expect(page.getByRole('heading',{name:'Review conflicting edits'})).toHaveCount(0)

 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'calendar',name:'Synthetic calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 await page.route('**/api/v1/calendar/changes',route=>route.fulfill({status:409,json:{error:'Synthetic calendar conflict'}}))
 await page.goto('/')
 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title').fill('Pending synthetic draft')
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await expect(page.getByText('Pending calendar changes',{exact:true})).toBeVisible()
 await expectThemed(page,'.pending-calendar .danger-action')
 await page.getByText('Draft details',{exact:true}).click()
 await expect(page.locator('.pending-calendar').getByText('Pending synthetic draft',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Discard draft',exact:true}).click()
 await expect(page.getByText('Pending synthetic draft',{exact:true})).toHaveCount(0)
})

test('login controls use the same dark primary treatment at mobile width',async({page})=>{
 await page.route('**/api/v1/auth/session',route=>route.fulfill({json:{configured:true,authenticated:false}}))
 await page.setViewportSize({width:375,height:800})
 await page.goto('/login')
 await expectThemed(page,'.login-card input')
 await expectThemed(page,'.login-card button')
 await page.getByLabel('Username').fill('synthetic-user')
 await page.getByLabel('Password').fill('synthetic-password')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await expect(page.getByText('Sign-in failed.',{exact:false})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})


test('Schedule controls remain contained at constrained, phone, and desktop widths',async({page},testInfo)=>{
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'calendar',name:'Synthetic calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 const viewports=[
  {name:'constrained',width:1280,height:900},
  {name:'phone',width:375,height:900},
  {name:'desktop',width:1680,height:1000},
 ]
 for(const viewport of viewports){
  await page.setViewportSize({width:viewport.width,height:viewport.height})
  await page.goto('/')
  const card=page.locator('.calendar-card')
  const controls=page.locator('.schedule-actions')
  await expect(controls.getByRole('button',{name:'Sync calendar',exact:true})).toBeVisible()
  await expect(controls.getByRole('button',{name:'New event',exact:true})).toBeVisible()
  const geometry=await controls.evaluate((element)=>{
   const card=element.closest('.calendar-card')!.getBoundingClientRect()
   const controls=element.getBoundingClientRect()
   const buttons=[...element.querySelectorAll('button,a')].map(control=>{
    const rect=control.getBoundingClientRect()
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:rect.height}
   })
   return {card:{left:card.left,right:card.right},controls:{left:controls.left,right:controls.right},buttons,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth}
  })
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth)
  expect(geometry.controls.left).toBeGreaterThanOrEqual(geometry.card.left)
  expect(geometry.controls.right).toBeLessThanOrEqual(geometry.card.right)
  for(const button of geometry.buttons){
   expect(button.left).toBeGreaterThanOrEqual(geometry.card.left)
   expect(button.right).toBeLessThanOrEqual(geometry.card.right)
   if(viewport.name==='phone')expect(button.height).toBeGreaterThanOrEqual(44)
  }
  await card.screenshot({path:testInfo.outputPath(`schedule-controls-${viewport.name}.png`)})
 }
})
