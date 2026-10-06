import {test,expect} from './authenticated'
test('schedule shows events separately and calendar visibility can be toggled',async({page})=>{
 await page.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated:true,configured:true}}))
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[{id:'one',calendarId:'fixture',title:'Fixture event',start:'2020-01-01',end:'2099-01-01',allDay:true,location:'',description:''}],lastSuccess:new Date().toISOString()}}))
 await page.goto('http://127.0.0.1:5173/')
 await expect(page.getByRole('heading',{name:'Schedule',exact:true})).toBeVisible()
 await expect(page.getByText('Fixture event',{exact:true})).toBeVisible()
 await page.getByText('Calendars',{exact:true}).click()
 await page.getByLabel('Test calendar',{exact:true}).uncheck()
 await expect(page.getByText('Fixture event',{exact:true})).toHaveCount(0)
 await page.reload()
 await expect(page.getByText('Fixture event',{exact:true})).toHaveCount(0)
})
