import {test,expect} from './authenticated'
const origin=process.env.DCC_TEST_ORIGIN??'http://127.0.0.1:5173'
test('sidebar fills viewport and stays visible on short and long pages',async({page})=>{
 await page.setViewportSize({width:1280,height:900})
 for(const route of ['/prices','/inbox','/pomodoro','/projects','/']){
  await page.goto(origin+route)
  const sidebar=page.locator('.sidebar')
  await expect(sidebar).toBeVisible()
  await expect.poll(()=>sidebar.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(900)
  await page.locator('.content').evaluate(e=>(e as HTMLElement).style.minHeight='3000px')
  await page.evaluate(()=>window.scrollTo(0,1200))
  await expect.poll(()=>sidebar.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(900)
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeInViewport()
  await expect(page.getByRole('button',{name:'Collapse sidebar'})).toBeInViewport()
 }
 await page.getByRole('button',{name:'Collapse sidebar'}).click()
 await expect.poll(()=>page.locator('.sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().width))).toBe(72)
 await expect(page.getByRole('button',{name:'Expand sidebar'})).toBeInViewport()
 await page.screenshot({path:'test-results/sidebar-viewport.png'})
 await page.setViewportSize({width:375,height:812})
 await page.evaluate(()=>window.scrollTo(0,0))
 expect(await page.locator('.sidebar').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(120)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
