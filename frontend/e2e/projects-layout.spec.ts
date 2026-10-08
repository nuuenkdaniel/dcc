import {test,expect} from './authenticated'

test('long generated project plan stays compact, grouped, and read-only on mount',async({page})=>{
 const project={id:'long-project',title:'Capstone launch with a deliberately long title that must wrap safely',category:'school',description:'Project instructions stay behind details.',deadline:'2026-10-24',importance:3,remainingMinutes:155,progress:'',status:'active',resources:[{name:'brief.pdf',text:'private extracted context'}],planSummary:'Generated from the saved brief.'}
 const actions=Array.from({length:18},(_,index)=>({id:`task-${index}`,projectId:project.id,title:`Generated task ${index+1} with enough text to exercise compact wrapping`,notes:index%3===0?'A note that should not render as an always-visible paragraph.':'',minutes:25+index,date:index>=15?'':index<8?'2026-10-08':'2026-10-09',needsRescheduling:index>=15,completed:index===0,dismissed:false}))
 let writes=0
 await page.route('**/api/v1/planner/snapshot',route=>route.fulfill({json:{projects:[{data:project,version:1}],actions:actions.map(data=>({data,version:1})),status:{}}}))
 await page.route('**/api/v1/planner/entity',route=>{writes++;return route.fulfill({json:{}})})
 await page.goto('http://127.0.0.1:5173/projects')
 await expect(page.getByText('1/18',{exact:true})).toBeVisible()
 await expect(page.getByText('2h 35m',{exact:true})).toBeVisible()
 await expect(page.getByText('Generated task 2 with enough text to exercise compact wrapping',{exact:true})).not.toBeVisible()
 const card=page.locator('.project-card')
 const edit=page.getByRole('button',{name:`Edit ${project.title}`})
 const [cardBox,editBox]=await Promise.all([card.boundingBox(),edit.boundingBox()])
 expect(cardBox).not.toBeNull();expect(editBox).not.toBeNull()
 expect(editBox!.y-cardBox!.y).toBeLessThan(40)
 expect(writes).toBe(0)
 await page.getByText('Project tasks (18)',{exact:true}).click()
 await expect(page.getByRole('heading',{name:'Oct 8, 2026'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Oct 9, 2026'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Needs rescheduling'})).toBeVisible()
 await expect(page.getByText('Task details',{exact:true}).first()).toBeVisible()
 await expect(page.getByText('A note that should not render as an always-visible paragraph.',{exact:true}).first()).not.toBeVisible()
 for(const width of [1280,375]){
  await page.setViewportSize({width,height:950})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 expect(writes).toBe(0)
})
