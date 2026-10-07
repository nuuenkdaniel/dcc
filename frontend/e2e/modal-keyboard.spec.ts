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

test('calendar dialog cannot be dismissed while its local draft is saving',async({page})=>{
 await page.route('**/api/v1/calendar/snapshot',r=>r.fulfill({json:{calendars:[{id:'fixture',name:'Test calendar'}],events:[],lastSuccess:new Date().toISOString()}}))
 await page.goto('/')
 const trigger=page.getByRole('button',{name:'New event',exact:true})
 await expect(trigger).toBeVisible()
 await page.evaluate(async()=>{
  const request=indexedDB.open('daymark-calendar-outbox',1)
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('changes',{keyPath:'change.id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  const tx=db.transaction('changes','readwrite'),store=tx.objectStore('changes');let hold=true
  const keepAlive=()=>{const next=store.get('__modal-test-hold__');next.onsuccess=()=>{if(hold)keepAlive()}}
  keepAlive();(window as typeof window&{releaseModalTest?:()=>void}).releaseModalTest=()=>{hold=false}
 })
 await trigger.click()
 const dialog=page.getByRole('dialog',{name:'New event'});await page.getByLabel('Event title',{exact:true}).fill('Protected draft')
 await page.getByRole('button',{name:'Save event'}).click();await expect(page.getByRole('button',{name:'Saving…'})).toBeDisabled()
 await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(trigger).not.toBeFocused()
 await page.evaluate(()=>(window as typeof window&{releaseModalTest?:()=>void}).releaseModalTest?.())
 await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
})
