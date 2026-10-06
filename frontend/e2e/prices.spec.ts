import {test,expect} from './authenticated'
test('price tracker condition tabs, exact threshold, settings and cached reload',async({page})=>{
 const now=new Date().toISOString();let target=280000,paused=false
 const item={id:'xps',title:'XPS 14 · X7 · OLED · 32 GB · 1 TB'}
 const source={item_id:'xps',store:'bestbuy',status:'verified',detail:'Verified test offer',last_attempt:now,next_run:now,last_good:{observedAt:now,url:'https://www.bestbuy.com/',offers:[{condition:'new',cents:280000,eligible:true,availability:'Shipping listed'},{condition:'open-box',cents:250000,eligible:false,availability:'Local eligibility unverified'}]}}
 await page.route('**/api/v1/prices/snapshot',r=>r.fulfill({json:{items:[{...item,target_cents:target,paused}],sources:[source],history:[]}}))
 await page.route('**/api/v1/prices/settings',r=>{const b=r.request().postDataJSON();target=b.targetCents;paused=b.paused;return r.fulfill({json:{saved:true}})})
 await page.goto('http://127.0.0.1:5173/prices');await expect(page.getByRole('heading',{name:'Price tracker',exact:true})).toBeVisible()
 await expect(page.locator('.price-target')).toHaveCount(0)
 await page.getByRole('button',{name:'Open-box',exact:true}).click();await expect(page.locator('.price-value')).toHaveText('$2,500.00');await expect(page.locator('.price-target')).toHaveCount(0)
 await page.getByText('Tracking settings',{exact:true}).click();await page.getByLabel('Target price (USD)').fill('2900');await page.getByRole('button',{name:'Save target'}).click();await expect(page.getByText('Tracker settings saved.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'New',exact:true}).click();await expect(page.locator('.price-target')).toBeVisible()
 await page.getByRole('button',{name:'Pause tracking'}).click();await expect(page.getByRole('button',{name:'Resume tracking'})).toBeVisible();await expect(page.locator('.price-target')).toHaveCount(0)
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.setViewportSize({width:375,height:1100});await page.screenshot({path:'test-results/prices-mobile.png',fullPage:true})
 await page.unroute('**/api/v1/prices/snapshot');await page.route('**/api/v1/prices/snapshot',r=>r.abort());await page.reload();await expect(page.locator('.price-value')).toHaveText('$2,800.00');await expect(page.getByText('Showing any cached prices.',{exact:false})).toBeVisible()
})

test('snapshot refresh adds newly arrived history to the chart',async({page})=>{
 const observed=['2026-09-01T14:00:00Z','2026-09-05T14:00:00Z'];let refreshed=false
 const item={id:'xps',title:'XPS 14 · X7 · OLED · 32 GB · 1 TB',target_cents:280000,paused:false}
 const history=()=>observed.slice(0,refreshed?2:1).map((observed_at,index)=>({id:index+1,item_id:'xps',store:'bestbuy',observed_at,data:{status:'verified',offers:[{condition:'new',cents:290000-index*15000,currency:'USD',eligible:true,availability:'Shipping listed'}]}}))
 await page.route('**/api/v1/prices/snapshot',route=>route.fulfill({json:{items:[item],sources:[],history:history()}}))
 await page.route('**/api/v1/prices/refresh',route=>{refreshed=true;return route.fulfill({status:202,json:{queued:1,note:'Price checks queued.'}})})
 await page.goto('http://127.0.0.1:5173/prices')
 await page.getByText('Price history',{exact:true}).click()
 await expect(page.locator('.price-chart circle')).toHaveCount(1)
 await expect(page.getByText('One verified point only; a trend needs another observation.')).toBeVisible()
 await page.getByRole('button',{name:'Check prices'}).click()
 await expect(page.locator('.price-chart circle')).toHaveCount(2)
 await expect(page.locator('[data-series="bestbuy-new"] path')).toBeVisible()
 await page.getByText('History values',{exact:true}).click()
 await expect(page.getByRole('cell',{name:'$2,750.00'})).toBeVisible()
})
