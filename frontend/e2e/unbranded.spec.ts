import {test,expect} from '@playwright/test'
test('dcc keeps navigation without branding or promotional subtitles',async({page})=>{
 for(const route of ['/','/inbox','/projects','/focus','/login']){
  await page.goto('http://127.0.0.1:5173'+route)
  await expect(page).toHaveTitle('dcc')
  await expect(page.locator('.brand')).toHaveCount(0)
  await expect(page.getByText(/What to work on today|Personal, school and work —|One calm timer|Assignments, deadlines, and ongoing work/)).toHaveCount(0)
 }
 await page.goto('http://127.0.0.1:5173/')
 await page.setViewportSize({width:1280,height:900})
 await expect(page.getByRole('button',{name:'Collapse sidebar'})).toBeVisible()
 await page.screenshot({path:'test-results/dcc-desktop.png'})
 await page.setViewportSize({width:375,height:812})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:'test-results/dcc-mobile.png'})
})
