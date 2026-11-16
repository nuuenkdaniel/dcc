import {test,expect} from './authenticated'

test('timer dialog contains keyboard focus, closes with Escape, and restores its trigger',async({page})=>{
 await page.goto('/pomodoro')
 const trigger=page.getByRole('button',{name:'Timer settings'})
 await trigger.focus();await trigger.press('Enter')
 const dialog=page.getByRole('dialog',{name:'Timer setup'})
 await expect(dialog).toBeVisible()
 expect(await dialog.evaluate((node)=>node.contains(document.activeElement))).toBe(true)
 await dialog.focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close timer settings'})).toBeFocused()
 await dialog.focus();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Done'})).toBeFocused()
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
})

test('calendar dialog restores keyboard focus after handing off a pending save',async({page})=>{
 await page.route('**/api/v1/calendar/snapshot',route=>route.fulfill({json:{calendars:[{id:'fixture',name:'Calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 await page.route('**/api/v1/workspace/writes',route=>route.fulfill({status:202,json:{state:'saving'}}))
 await page.route('**/api/v1/workspace/writes/*',route=>route.fulfill({json:{state:'saving'}}))
 await page.goto('/')
 const trigger=page.getByRole('button',{name:'New event',exact:true})
 await trigger.click()
 const dialog=page.getByRole('dialog',{name:'New event'})
 await dialog.getByLabel('Event title').fill('Pending draft')
 await dialog.getByRole('button',{name:'Save event'}).click()
 await expect(dialog).toHaveCount(0)
 await expect(trigger).toBeFocused()
 await expect(page.locator('.schedule-event')).toContainText('Pending draft')
})
