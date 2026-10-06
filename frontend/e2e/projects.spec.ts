import {test,expect} from './authenticated'
test('Projects retains an offline draft and sends it on reconnect',async({page})=>{
 await page.route('**/api/v1/planner/**',r=>r.abort())
 await page.goto('http://127.0.0.1:5173/projects')
 await page.getByRole('button',{name:'New project',exact:true}).click()
 await page.getByLabel('Project title').fill('Read chapter two')
 await page.getByText('More options',{exact:true}).click()
 await page.getByLabel('Planning allowance (minutes, editable)').fill('60')
 await page.getByRole('button',{name:'Save project',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Read chapter two',exact:true})).toBeVisible()
 await page.reload()
 await expect(page.getByRole('heading',{name:'Read chapter two',exact:true})).toBeVisible()
 let entries:unknown[]=[]
 await page.unroute('**/api/v1/planner/**')
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:entries,actions:[],status:{}}}))
 await page.route('**/api/v1/planner/entity',r=>{const b=r.request().postDataJSON();entries=[{kind:b.kind,version:1,data:b.data}];return r.fulfill({json:{code:200}})})
 await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await expect(page.getByText('Projects and curated actions are up to date.')).toBeVisible()
 await expect(page.getByRole('heading',{name:'Read chapter two',exact:true})).toBeVisible()
})

test('project conflict retains both versions until explicit resolution',async({page})=>{
 const id='11111111-1111-4111-8111-111111111111'
 const project={id,title:'Original project',category:'school',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'}
 let current={kind:'project',version:1,data:project}
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:[current],actions:[],status:{}}}))
 let sentVersion=-1
 await page.route('**/api/v1/planner/entity',r=>{sentVersion=r.request().postDataJSON().version;return r.fulfill({status:409,json:{error:'Changed elsewhere'}})})
 await page.goto('http://127.0.0.1:5173/projects')
 await page.getByRole('button',{name:'Edit Original project'}).click()
 await page.getByLabel('Project title').fill('My retained draft')
 current={...current,version:2,data:{...project,title:'Changed elsewhere'}}
 await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Changed elsewhere',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Save project',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Review conflicting edits'})).toBeVisible()
 expect(sentVersion).toBe(1)
 await expect(page.locator('pre').first()).toContainText('Changed elsewhere')
 await expect(page.locator('pre').last()).toContainText('My retained draft')
 await page.getByRole('button',{name:'Discard my draft',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Changed elsewhere',exact:true})).toBeVisible()
})
