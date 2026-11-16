import {test,expect} from './authenticated'

test('a project cannot be created offline and reconnect refreshes the view automatically',async({page,context})=>{
 let posts=0
 await page.route('**/api/v1/workspace/writes',route=>{posts++;return route.fallback()})
 await page.goto('/projects')
 const newProject=page.getByRole('button',{name:'New project'})
 await expect(newProject).toBeEnabled()
 await context.setOffline(true)
 await expect(newProject).toBeDisabled()
 expect(posts).toBe(0)
 await context.setOffline(false)
 await expect(newProject).toBeEnabled()
 expect(posts).toBe(0)
})

test('a project conflict keeps the server version and can reopen the failed draft',async({page})=>{
 const id='11111111-1111-4111-8111-111111111111'
 const project={id,title:'Original project',category:'school',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'}
 let current={kind:'project',version:1,data:project}
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:[current],actions:[],status:{}}}))
 let sentVersion=-1
 await page.route('**/api/v1/workspace/writes',r=>{sentVersion=r.request().postDataJSON().payload.version;return r.fulfill({status:409,json:{state:'failed',code:409}})})
 await page.goto('/projects')
 await page.getByRole('button',{name:'Edit Original project'}).click()
 await page.getByLabel('Project title').fill('My retained draft')
 current={...current,version:2,data:{...project,title:'Changed elsewhere'}}
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect(page.getByRole('heading',{name:'Changed elsewhere',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Save project',exact:true}).click()
 await expect(page.getByText('Changed elsewhere. Review and try again.')).toBeVisible()
 expect(sentVersion).toBe(1)
 await page.getByRole('button',{name:'Edit failed project'}).click()
 await expect(page.getByLabel('Project title')).toHaveValue('My retained draft')
})
