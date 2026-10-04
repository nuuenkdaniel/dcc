import {test,expect} from '@playwright/test'
test('planning separates historical explanation from sync and keeps controls styled',async({page})=>{
 let requested=false
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:[],actions:[],status:{summary:'Earlier budget estimate',last_success:'2026-10-03T14:00:00Z',requested}}}))
 await page.route('**/api/v1/planner/refresh',r=>{requested=true;return r.fulfill({json:{queued:true}})})
 await page.goto('http://127.0.0.1:5173/');await page.getByText('Planning & sync',{exact:true}).click()
 await expect(page.getByText('Earlier budget estimate',{exact:true})).not.toBeVisible()
 await page.getByText('Last planner explanation',{exact:true}).click()
 await expect(page.getByText('Earlier budget estimate',{exact:true})).toBeVisible()
 await expect(page.locator('.planner-history time')).toHaveAttribute('dateTime','2026-10-03T14:00:00Z')
 await expect(page.getByText('Historical context, not a live capacity check.',{exact:false})).toBeVisible()
 await expect(page.getByRole('button',{name:'Replan today',exact:true})).toHaveCSS('border-radius','6px')
 await page.getByRole('button',{name:'Replan today',exact:true}).click();await expect(page.getByRole('button',{name:'Planning queued…'})).toBeDisabled()
 await page.setViewportSize({width:375,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.locator('.planner-details').screenshot({path:'test-results/planning-status-mobile.png'})
})
