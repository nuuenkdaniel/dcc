import {test,expect} from './authenticated'
test('16 unplaced tasks stay compact, expand by keyboard, and update after completion',async({page})=>{
 let actions=Array.from({length:16},(_,index)=>({kind:'action',version:1,data:{id:`unplaced-${index}`,title:`Unfinished review ${index+1}`,date:'',needsRescheduling:true,assignmentStep:true,minutes:45,notes:'',completed:false,dismissed:false,projectId:'recovery-project'}}))
 const projects=[{kind:'project',version:1,data:{id:'recovery-project',title:'Recovery project',kind:'assignment'}}]
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects,preparations:[],actions,status:{}}}));
 await page.route('**/api/v1/planner/entity',r=>{const change=r.request().postDataJSON();actions=actions.map(entry=>entry.data.id===change.data.id?{...entry,version:entry.version+1,data:change.data}:entry);return r.fulfill({json:{saved:true}})});
 await page.goto('/');
 const details=page.locator('.rescheduling-details')
 const summary=details.locator('summary')
 await expect(summary).toContainText('16 tasks')
 await expect(details.getByText('Unfinished review 1',{exact:true})).not.toBeVisible()
 expect((await details.boundingBox())!.height).toBeLessThanOrEqual(64)
 await page.locator('.calendar-day:not(.selected)').first().click()
 await expect(summary).toContainText('16 tasks')
 await summary.focus();await page.keyboard.press('Enter')
 const projectGroup=details.getByRole('button',{name:'Work on Recovery project',exact:true})
 await expect(projectGroup).toBeVisible()
 await expect(details.getByText('Unfinished review 1',{exact:true})).not.toBeVisible()
 await projectGroup.click()
 const firstStep=details.getByRole('checkbox',{name:/^Unfinished review 1\b/})
 await expect(firstStep).toBeVisible()
 await firstStep.click()
 await expect(summary).toContainText('15 tasks')
 await page.setViewportSize({width:375,height:900})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
})
test('following Today advances after midnight but explicit date remains selected',async({page})=>{
 await page.clock.install({time:new Date('2026-10-04T12:00:00')});await page.goto('/');
 await page.clock.setSystemTime(new Date('2026-10-05T12:00:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.date-chip')).toContainText('October 5');
 await page.getByRole('button',{name:'Sunday, October 4',exact:true}).click();
 await page.clock.setSystemTime(new Date('2026-10-06T12:00:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.date-chip')).toContainText('October 4');
})
