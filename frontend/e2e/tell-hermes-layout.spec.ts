import {test,expect} from './authenticated'

for(const width of [320,375,768,1024,1920]){
 test(`Home command stays at the top and submits with Enter at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  const requests:unknown[]=[]
   await page.route('**/api/v1/hermes/action-capabilities',route=>route.fulfill({json:{productActions:true}}))
   await page.route('**/api/v1/hermes/actions',async route=>{
   requests.push(route.request().postDataJSON())
   await pending
    await route.fulfill({json:{message:`Untrusted synthetic prose: ${'x'.repeat(500)}`,summary:{phase:'completed',outcome:'effects_recorded',effects:[{tool:'create_task',state:'applied',id:'synthetic-layout-task',version:1}],pending:0,reads:[]}}})
  })
  await page.goto('/')
   const input=page.getByRole('textbox',{name:'Ask Hermes about tasks, projects, or calendar'})
   await expect(input).toBeVisible()
   await expect(input).toBeEnabled()
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
    await expect(page.locator('#tell-hermes-status')).toHaveText('Checking DCC…')
    await expect.poll(()=>requests.length).toBe(1)
   await page.keyboard.press('Enter') // Pending Enter must not create a second intent.
   expect(requests).toHaveLength(1)
  expect(await checkLayout()).toBe(top)
  release()
  await expect(input).toBeEnabled()
   await expect(page.locator('#tell-hermes-status')).toHaveText('DCC actions saved.')
   await expect(page.locator('.tell-hermes')).not.toContainText('Untrusted synthetic prose:')
   expect(requests).toHaveLength(1)
   expect(requests[0]).toEqual(expect.objectContaining({prompt:'Synthetic command only',key:expect.stringMatching(/^[a-f0-9-]{36}$/)}))
   await input.press('Enter') // Unchanged settled retry checks the original key.
   await expect.poll(()=>requests.length).toBe(2)
   expect(requests[1]).toEqual(requests[0])
   await expect(input).toBeEnabled()
  expect(await checkLayout()).toBe(top)
  if(width>=1024){
   await page.getByRole('button',{name:'Collapse sidebar'}).click()
   await expect(input).toBeVisible()
   await checkLayout()
  }
  await page.screenshot({path:`test-results/hermes-top-${width}.png`,fullPage:true})
 })
}
