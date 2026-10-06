import {test,expect} from './authenticated'

test('production hides development logout while keeping Settings sign out',async({page})=>{
  await page.goto('http://127.0.0.1:4173/settings')
  await expect(page.getByRole('toolbar',{name:'Development tools'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Sign out / test login',exact:true})).toHaveCount(0)
})
