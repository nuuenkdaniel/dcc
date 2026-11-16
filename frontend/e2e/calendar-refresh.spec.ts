import {test,expect} from './authenticated'

test('calendar startup, reload and focus are read-only',async({page})=>{
 let reads=0,writes=0
 await page.route('**/api/v1/calendar/refresh',route=>{writes++;return route.fulfill({json:{}})})
 await page.route('**/api/v1/calendar/snapshot',route=>{reads++;return route.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}})})
 await page.goto('/')
 await expect(page.getByRole('button',{name:'New event'})).toBeEnabled()
 await page.reload()
 await expect(page.getByRole('button',{name:'New event'})).toBeEnabled()
 const previous=reads
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await expect.poll(()=>reads).toBeGreaterThan(previous)
 expect(writes).toBe(0)
 await expect(page.getByRole('button',{name:'Sync calendar'})).toHaveCount(0)
})
