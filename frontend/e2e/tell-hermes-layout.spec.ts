import {test,expect} from './authenticated'

for(const width of [320,375,768,1024,1920]){
 test(`Home command stays at the top and submits with Enter at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  const requests:unknown[]=[]
  await page.route('**/api/v1/hermes/commands',async route=>{
   requests.push(route.request().postDataJSON())
   await pending
   await route.fulfill({json:{message:`Synthetic result: ${'x'.repeat(500)}`}})
  })
  await page.goto('/')
  const input=page.getByRole('textbox',{name:'Create a project, assignment, task, or event'})
  await expect(input).toBeVisible()
  await expect(input).toHaveAttribute('placeholder','Hermes')
  await expect(page.locator('.sidebar .tell-hermes,.tell-hermes details,.tell-hermes summary,.tell-hermes textarea')).toHaveCount(0)
  const checkLayout=async()=>{
   const metrics=await input.evaluate(el=>{
    const rect=el.getBoundingClientRect(),home=el.closest('#home')!,header=home.querySelector('.topbar')!.getBoundingClientRect(),grid=home.querySelector('.layout-grid')!.getBoundingClientRect()
    return {height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,headerBottom:header.bottom,gridTop:grid.top,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}
   })
   expect(metrics.height).toBeGreaterThanOrEqual(44)
   expect(metrics.left).toBeGreaterThanOrEqual(0)
   expect(metrics.right).toBeLessThanOrEqual(metrics.viewport)
   expect(metrics.top).toBeGreaterThanOrEqual(metrics.headerBottom)
   expect(metrics.bottom).toBeLessThanOrEqual(metrics.gridTop)
   expect(metrics.overflow).toBe(false)
   return metrics.top
  }
  const top=await checkLayout()
  await input.fill('Synthetic command only')
  await input.focus()
  expect(await input.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none')
  await input.press('Enter')
  await expect(input).toBeDisabled()
  await expect(page.locator('#tell-hermes-status')).toHaveText('Creating…')
  expect(await checkLayout()).toBe(top)
  release()
  await expect(input).toBeEnabled()
  await expect(page.locator('#tell-hermes-status')).toContainText('Synthetic result:')
  expect(requests).toHaveLength(1)
  expect(await checkLayout()).toBe(top)
  if(width>=1024){
   await page.getByRole('button',{name:'Collapse sidebar'}).click()
   await expect(input).toBeVisible()
   await checkLayout()
  }
  await page.screenshot({path:`test-results/hermes-top-${width}.png`,fullPage:true})
 })
}
