import {test,expect} from './authenticated'

test('a dated custom project task renders offline in its project and on matching Today, then syncs once',async({page})=>{
 await page.clock.install({time:new Date('2026-10-10T12:00:00-04:00')})
 const project={id:'11111111-1111-4111-8111-111111111111',title:'Portfolio',category:'personal',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'}
 let actions:any[]=[],online=false,saves=0
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{kind:'project',version:1,data:project}],actions,preparations:[],status:{}}}))
 await page.route('**/api/v1/planner/entity',route=>{if(!online)return route.abort();const change=route.request().postDataJSON();saves++;actions=[{kind:'action',version:1,data:change.data}];return route.fulfill({json:{code:200}})})
 await page.goto('/projects')
 await page.getByRole('button',{name:'Add task'}).click()
 await page.getByLabel('Task title').fill('Polish landing page')
 await page.getByLabel('Task date').fill('2026-10-10')
 await page.getByLabel('Minutes').fill('40')
 await page.getByRole('button',{name:'Save task'}).click()
 await page.getByText('Project tasks (1)',{exact:true}).click()
 await expect(page.getByText('Polish landing page',{exact:true})).toBeVisible()
 await expect(page.getByText('Custom',{exact:true})).toBeVisible()
 await page.goto('/')
 await expect(page.getByRole('button',{name:'Polish landing page',exact:true})).toBeVisible()
 await expect(page.getByText('Custom · Portfolio',{exact:true})).toBeVisible()
 online=true
 await page.getByText('Planning & sync',{exact:true}).click()
 await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await expect.poll(()=>saves).toBe(1)
})

test('Hermes preview makes no mutation before confirmation and preserves prompt on failure',async({page})=>{
 const project={id:'11111111-1111-4111-8111-111111111111',title:'Portfolio',category:'personal',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'}
 let mutations=0,fail=true
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{kind:'project',version:1,data:project}],actions:[],preparations:[],status:{}}}))
 await page.route('**/api/v1/planner/custom-project-preview',route=>fail?route.fulfill({status:502,json:{error:'Preview unavailable'}}):route.fulfill({json:{suggestions:[{title:'Draft section',date:'2026-10-12',minutes:30,notes:'Specific output'}]}}))
 await page.route('**/api/v1/planner/entity',route=>{mutations++;return route.fulfill({json:{code:200}})})
 await page.goto('/projects')
 await page.getByRole('button',{name:'Ask Hermes'}).click()
 const prompt=page.getByLabel('What should Hermes help plan?')
 await prompt.fill('Give me tasks for Oct 10 and Oct 12')
 await page.getByRole('button',{name:'Preview suggestions'}).click()
 await expect(page.getByRole('alert')).toContainText('Preview unavailable')
 await expect(prompt).toHaveValue('Give me tasks for Oct 10 and Oct 12')
 expect(mutations).toBe(0)
 fail=false
 await page.getByRole('button',{name:'Preview suggestions'}).click()
 await expect(page.getByLabel('Suggestion title')).toHaveValue('Draft section')
 expect(mutations).toBe(0)
 await page.getByRole('button',{name:'Save selected'}).click()
 await expect.poll(()=>mutations).toBe(1)
})
