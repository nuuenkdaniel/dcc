import {test,expect} from './authenticated'

async function expectCustomTaskButtonStyle(button:import('@playwright/test').Locator,kind:'primary'|'secondary'|'danger'){
 const style=await button.evaluate(element=>{const value=getComputedStyle(element);return {background:value.backgroundColor,color:value.color,border:value.borderStyle,minHeight:value.minHeight,radius:value.borderRadius}})
 expect(style).toMatchObject({
  background:kind==='primary'?'rgb(156, 141, 232)':kind==='secondary'?'rgb(32, 33, 56)':'rgba(0, 0, 0, 0)',
  ...(kind==='danger'?{color:'rgb(217, 183, 192)'}:{}),
  border:'solid',
  minHeight:'42px',
  radius:'7px',
 })
 expect(style.background).not.toBe('rgb(239, 239, 239)')
}

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

test('custom task manual, prompt, review, and edit actions use scoped project button styles',async({page})=>{
 const project={id:'11111111-1111-4111-8111-111111111111',title:'Portfolio',category:'personal',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'}
 const action={id:'22222222-2222-4222-8222-222222222222',source:'manual-project',projectId:project.id,title:'Existing custom task',date:'2026-10-12',minutes:30,notes:'',completed:false,dismissed:false}
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{kind:'project',version:1,data:project}],actions:[{kind:'action',version:1,data:action}],preparations:[],status:{}}}))
 await page.route('**/api/v1/planner/custom-project-preview',route=>route.fulfill({json:{suggestions:[{title:'Review launch copy',date:'2026-10-13',minutes:25,notes:''}]}}))
 await page.setViewportSize({width:375,height:900})
 await page.goto('/projects')

 const add=page.getByRole('button',{name:'Add task',exact:true})
 const ask=page.getByRole('button',{name:'Ask Hermes',exact:true})
 await expectCustomTaskButtonStyle(add,'primary')
 await expectCustomTaskButtonStyle(ask,'secondary')

 await add.click()
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Save task',exact:true}),'primary')
 const cancel=page.getByRole('button',{name:'Cancel',exact:true})
 await expectCustomTaskButtonStyle(cancel,'secondary')
 await page.getByRole('button',{name:'Save task',exact:true}).focus()
 await page.keyboard.press('Tab')
 await expect(cancel).toBeFocused()
 expect(await cancel.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid')
 await cancel.click()

 await page.getByText('Project tasks (1)',{exact:true}).click()
 const edit=page.getByRole('button',{name:'Edit',exact:true})
 await expectCustomTaskButtonStyle(edit,'secondary')
 await edit.click()
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Save changes',exact:true}),'primary')
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Cancel',exact:true}),'secondary')
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Dismiss task',exact:true}),'danger')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()

 await ask.click()
 const preview=page.getByRole('button',{name:'Preview suggestions',exact:true})
 await expect(preview).toBeDisabled()
 await expectCustomTaskButtonStyle(preview,'primary')
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Close',exact:true}),'secondary')
 await page.getByLabel('What should Hermes help plan?').fill('Suggest a review task')
 await preview.click()
 await expect(page.getByLabel('Suggestion title')).toHaveValue('Review launch copy')
 await expectCustomTaskButtonStyle(page.getByRole('button',{name:'Save selected',exact:true}),'primary')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
