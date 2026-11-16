import {test,expect} from './authenticated'

const open=async(page:import('@playwright/test').Page,title:string)=>{
 await page.getByRole('button',{name:'New event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill(title)
 await page.getByRole('button',{name:'Save event',exact:true}).click()
}
const snapshot=(events:unknown[]=[])=>({calendars:[{id:'fixture',name:'Test calendar'}],events,lastSuccess:new Date().toISOString()})
test('an accepted event appears immediately and a lost acknowledgement recovers by receipt only',async({page})=>{
 let change:Record<string,unknown>,id='',posts=0,confirmed=false,checks=0
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:snapshot(confirmed?[{...change,id:'confirmed'}]:[])}))
 await page.route('**/api/v1/workspace/writes',route=>{
  posts++;const submission=route.request().postDataJSON();change=submission.payload;id=submission.id;return route.abort()
 })
 await page.route('**/api/v1/workspace/writes/*',route=>{
  checks++
  expect(route.request().url()).toContain(id)
  return route.fulfill({json:confirmed?{state:'saved',event:{...change,id:'confirmed'}}:{state:'saving'}})
 })
 await page.goto('/')
 await open(page,'Pending calendar fixture')
 await expect(page.locator('.schedule-event')).toContainText('Pending calendar fixture')
 await expect.poll(()=>posts).toBe(1)
 await page.reload()
 confirmed=true
 await expect(page.locator('.schedule-event').getByText('Pending calendar fixture',{exact:true})).toHaveCount(1)
 await expect.poll(()=>checks).toBeGreaterThan(0)
 expect(posts).toBe(1)
})

test('a calendar conflict rolls back the row and keeps its form recoverable',async({page})=>{
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:snapshot()}))
 await page.route('**/api/v1/workspace/writes',route=>route.fulfill({status:409,json:{state:'failed',code:409}}))
 await page.goto('/')
 await open(page,'Failed calendar fixture')
 await expect(page.getByText('Changed elsewhere. Review and try again.')).toBeVisible()
 await expect(page.locator('.schedule-event').getByText('Failed calendar fixture')).toHaveCount(0)
 await page.getByRole('button',{name:'Edit failed event'}).click()
 await expect(page.getByLabel('Event title')).toHaveValue('Failed calendar fixture')
})
