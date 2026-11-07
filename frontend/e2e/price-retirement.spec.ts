// Source-retirement regression only: synthetic cached rows, no provider/DB.
import {test,expect} from './authenticated'
test('retired bookmark never renders cached offers, polls, mutates settings or deletes history',async({page})=>{
 const cached=JSON.stringify({items:[{id:'old-price',title:'Synthetic archived price item',target_cents:280000,paused:false}],sources:[],history:[{id:1,data:{offers:[]}}]})
 await page.clock.install({time:new Date('2026-11-07T12:00:00Z')})
 await page.addInitScript(value=>{if(localStorage.getItem('daymark.prices.v1')===null)localStorage.setItem('daymark.prices.v1',value)},cached)
 let requests=0
 await page.route('**/api/v1/prices/**',route=>{requests++;return route.fulfill({status:410,json:{retired:true,error:'Retired; stored data preserved'}})})
 await page.goto('/prices')
 await expect(page.getByRole('heading',{name:'Feature retired',exact:true})).toBeVisible()
 await expect(page.getByText('Synthetic archived price item')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Price tracker',exact:true})).toHaveCount(0)
 await expect(page.getByText('Tracking settings',{exact:true})).toHaveCount(0)
 await page.clock.fastForward(120000);expect(requests).toBe(0)
 await page.reload();await expect(page.getByRole('heading',{name:'Feature retired',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('daymark.prices.v1'))).toBe(cached);expect(requests).toBe(0)
 for(const width of [360,768,1280]){await page.setViewportSize({width,height:640});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
})
test('main navigation and Settings expose no active price feature',async({page})=>{
 let priceRequests=0
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/v1/prices/'))priceRequests++})
 for(const path of ['/','/inbox','/projects','/settings','/pomodoro']){
  await page.goto(path)
  await expect(page.getByRole('button',{name:'Price tracker',exact:true})).toHaveCount(0)
  await expect(page.getByText('Check prices',{exact:true})).toHaveCount(0)
 }
 expect(priceRequests).toBe(0)
})
