import assert from 'node:assert/strict'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
process.loadEnvFile('.env')
const origin=process.env.APP_ORIGIN!
const browser=await chromium.launch(),ctx=await browser.newContext({viewport:{width:1440,height:1000}})
try{
 assert.equal((await ctx.request.get(origin+'/api/v1/prices/snapshot')).status(),401)
 assert.equal((await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}})).status(),200)
 const snap=await(await ctx.request.get(origin+'/api/v1/prices/snapshot')).json();assert.equal(snap.items.length,1);assert.equal(snap.sources.length,3);assert.ok(snap.history.length>0);assert.equal(snap.items[0].target_cents,280000)
 const bb=snap.sources.find((s:any)=>s.store==='bestbuy');assert.equal(bb.status,'verified');assert.ok(bb.last_good.offers.some((o:any)=>o.condition==='new'&&o.cents>0))
 const page=await ctx.newPage();await page.goto(origin+'/prices');await page.locator('.price-value').first().waitFor();assert.equal(await page.locator('.price-offer').count(),3)
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 await page.setViewportSize({width:375,height:1100});await page.screenshot({path:'../frontend/test-results/prices-live-mobile.png',fullPage:true})
 await page.getByRole('button',{name:'Open-box / Refurbished'}).click();assert.ok((await page.locator('.price-value').innerText()).includes('$'));assert.equal(await page.locator('.price-target').count(),0)
 console.log(JSON.stringify({passed:true,checks:['authenticated snapshot','real saved price and history','three retailer states','condition tabs','375/768/1440 layout']}))
}finally{await ctx.close();await browser.close()}
