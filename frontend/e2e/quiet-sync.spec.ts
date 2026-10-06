import {test,expect} from './authenticated'
test('background polling stays quiet while manual sync gives feedback',async({page})=>{
 await page.clock.install()
 let requests=0
 await page.route('**/api/v1/planner/snapshot',async r=>{requests++;await new Promise(resolve=>setTimeout(resolve,150));await r.fulfill({json:{projects:[],actions:[],status:{}}})})
 await page.goto('http://127.0.0.1:5173/projects')
 await expect(page.getByText('Projects and curated actions are up to date.',{exact:true})).toBeVisible()
 await page.clock.fastForward(30000)
 await expect.poll(()=>requests).toBeGreaterThan(1)
 await expect(page.getByRole('button',{name:'Syncing…',exact:true})).toHaveCount(0)
 await expect(page.getByText('Syncing projects and tasks…',{exact:true})).toHaveCount(0)
 await expect(page.getByText('Projects and curated actions are up to date.',{exact:true})).toBeVisible()
 await page.waitForTimeout(300)
 await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await expect(page.getByRole('button',{name:'Syncing…',exact:true})).toBeVisible()
 await expect(page.getByText(/Last synced/)).toBeVisible()
})
