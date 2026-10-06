import {test,expect} from './authenticated'
test('today marker remains when another date is selected without tasks',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T12:00:00')})
 await page.goto('http://127.0.0.1:5173')
 const today=page.getByRole('button',{name:'Saturday, October 3',exact:true})
 await expect(today).toHaveAttribute('aria-current','date')
 await expect(today).toHaveCSS('position','relative')
 await page.getByRole('button',{name:'Wednesday, October 7',exact:true}).click()
 await expect(today).toHaveAttribute('aria-current','date')
 await expect(today).toHaveAttribute('aria-pressed','false')
 expect(await today.evaluate(e=>getComputedStyle(e,'::after').width)).toBe('6px')
})
