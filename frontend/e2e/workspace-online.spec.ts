import {mockAuthenticatedApi,test,expect} from './authenticated'

test('writes appear immediately on one tab and refresh automatically in another',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5173'})
 try{
  await mockAuthenticatedApi(context)
  const first=await context.newPage(),second=await context.newPage()
  await Promise.all([first.goto('/'),second.goto('/')])
  await first.getByLabel('Task title').fill('From the first tab')
  await first.getByRole('button',{name:'Add task'}).click()
  await expect(first.getByText('From the first tab',{exact:true})).toBeVisible()
  await expect(first.getByText('Saved',{exact:true})).toBeVisible()
  await second.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(second.getByText('From the first tab',{exact:true})).toBeVisible()
  await second.getByRole('checkbox',{name:'Complete From the first tab'}).check()
  await expect(second.locator('.task-state')).toHaveText('Completed')
  await first.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect(first.locator('.task-state')).toHaveText('Completed')
  await expect(first.getByRole('button',{name:'Sync tasks'})).toHaveCount(0)
 }finally{await context.close()}
})
