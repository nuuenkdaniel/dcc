import {test,expect} from './authenticated'
test('assignment exposes linked tasks and honest empty state',async({page})=>{
 const project={id:'p',title:'Assignment example',kind:'assignment',category:'school',status:'active',remainingMinutes:60,progress:'',deadline:'2026-10-18'}
 let actions:any[]=[]
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:[{data:project,version:1}],actions,status:{summary:'Deferred behind nearer deadlines.'}}}))
 await page.goto('http://127.0.0.1:5173/projects')
 await page.getByText('Project tasks (0)',{exact:true}).click()
 await expect(page.getByText(/No tasks have been created for this project yet/)).toBeVisible()
 actions=[{version:1,data:{id:'a',projectId:'p',title:'Draft the report',date:'2026-10-08',minutes:45,completed:false,dismissed:false,notes:'Outline the required sections.'}}]
 await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await expect(page.getByText('Project tasks (1)',{exact:true})).toBeVisible()
 await expect(page.getByText('Draft the report',{exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Oct 8, 2026',exact:true})).toBeVisible()
 await expect(page.getByText('45m · Open',{exact:true})).toBeVisible()
 await page.getByText('Task details',{exact:true}).click()
 await expect(page.getByText('Outline the required sections.',{exact:true})).toBeVisible()
})
