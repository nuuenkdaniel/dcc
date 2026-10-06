import {test,expect} from './authenticated'
test('unplaced tasks remain visible independently of selected date',async({page})=>{
 await page.route('**/api/v1/planner/snapshot',r=>r.fulfill({json:{projects:[],preparations:[],actions:[{kind:'action',version:1,data:{id:'unplaced',title:'Unfinished review',date:'',needsRescheduling:true,minutes:45,notes:'',completed:false,dismissed:false,projectId:''}}],status:{}}}));
 await page.goto('http://127.0.0.1:5173/');await expect(page.getByRole('region',{name:'Needs rescheduling'})).toContainText('Unfinished review');
})
test('following Today advances after midnight but explicit date remains selected',async({page})=>{
 await page.clock.install({time:new Date('2026-10-04T12:00:00')});await page.goto('http://127.0.0.1:5173/');
 await page.clock.setSystemTime(new Date('2026-10-05T12:00:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.date-chip')).toContainText('October 5');
 await page.getByRole('button',{name:'Sunday, October 4',exact:true}).click();
 await page.clock.setSystemTime(new Date('2026-10-06T12:00:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.date-chip')).toContainText('October 4');
})
