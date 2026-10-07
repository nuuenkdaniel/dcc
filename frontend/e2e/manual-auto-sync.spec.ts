import {test,expect} from './authenticated'
test('adding a task syncs automatically and offline changes retry on reconnect',async({page})=>{
 let tasks:unknown[]=[];let version=0;let offline=false
 await page.route('**/api/v1/planner/manual-tasks',async r=>{if(offline)return r.abort();if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.version!==version)return r.fulfill({status:409,json:{}});tasks=b.tasks;version++;return r.fulfill({json:{code:200}})}return r.fulfill({json:{version,data:{tasks}}})})
 await page.goto('http://127.0.0.1:5173/');await page.getByPlaceholder('Add a daily action…').fill('Email test recipient');await page.getByRole('button',{name:'Add task',exact:true}).click();await expect.poll(()=>JSON.stringify(tasks)).toContain('Email test recipient')
 offline=true;await page.getByPlaceholder('Add a daily action…').fill('Offline task');await page.getByRole('button',{name:'Add task',exact:true}).click();await expect(page.getByRole('button',{name:'Expand Offline task',exact:true})).toBeVisible();await page.waitForTimeout(300);expect(JSON.stringify(tasks)).not.toContain('Offline task');offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>JSON.stringify(tasks)).toContain('Offline task')
})
