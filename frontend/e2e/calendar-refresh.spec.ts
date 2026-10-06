import {test,expect} from './authenticated'
test('reload requests Nextcloud sync and Sync now requests it again',async({page})=>{
 let requests=0
 await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/refresh',r=>{requests++;return r.fulfill({json:{status:'synced'}})})
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[],events:[],lastSuccess:new Date().toISOString()}}))
 await page.goto('http://127.0.0.1:5173')
 await expect.poll(()=>requests).toBe(1)
 await page.reload()
 await expect.poll(()=>requests).toBe(2)
 await page.locator('.schedule-actions').getByRole('button',{name:'Sync calendar',exact:true}).click()
 await expect.poll(()=>requests).toBe(3)
})
