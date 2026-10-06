import {test,expect} from '@playwright/test'
const msg=(id:string,receivedAt:string,important:boolean,override:boolean|null=null)=>({data:{id,account:'school',address:'test@example.invalid',subject:'Test message '+id,sender:'Test sender',to:'Test recipient',receivedAt,body:'Safe test body <script>alert(1)</script>',bodyNotice:'',unread:true,attachments:[]},analysis:{important,summary:'Test summary '+id,reason:'Test reason'},override})
test('daily briefing uses Eastern today and manual importance; inbox keeps older mail',async({page})=>{
 const today=new Date().toISOString(),old='2020-01-01T12:00:00Z';let messages=[msg('today',today,true),msg('old',old,true),msg('hidden',today,true,false),msg('manual',today,false,true)]
 await page.route('**/api/v1/mail/snapshot',r=>r.fulfill({json:{messages,accounts:[],today:today.slice(0,10)}}))
 await page.route('**/api/v1/mail/feedback',async r=>{const body=r.request().postDataJSON();messages=messages.map(m=>m.data.id===body.id?{...m,override:body.important}:m);await r.fulfill({json:{saved:true}})})
 await page.goto('http://127.0.0.1:5173/');await expect(page.locator('.email-brief')).toHaveCount(2);await expect(page.locator('.email-brief').getByText('Test message old')).toHaveCount(0)
 await expect(page.locator('.email-brief').first().getByText('Test reason',{exact:true})).not.toBeVisible();await page.locator('.email-brief').first().getByText('Why it matters',{exact:true}).click();await expect(page.locator('.email-brief').first().getByText('Test reason',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Open inbox →'})).toHaveCSS('text-decoration-line','none');
 await page.screenshot({path:'test-results/briefing-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:900});await expect(page.locator('.daily-email')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.daily-email').screenshot({path:'test-results/briefing-mobile.png'});
 await page.getByRole('link',{name:'Test message today',exact:true}).click();await expect(page.locator('.email-card[open]')).toHaveCount(1);await expect(page.locator('.email-card[open] .email-body')).toContainText('<script>');await expect(page.locator('.email-card script')).toHaveCount(0)
 await page.locator('.email-card[open]').getByRole('button',{name:'Not important',exact:true}).click();await expect(page.locator('.email-card[open]').getByRole('button',{name:'Not important',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByLabel('Search emails').fill('Test message old');await expect(page.locator('.email-card')).toHaveCount(1)
})
test('email rules save and read back without touching mailbox settings',async({page})=>{
 let rules=''
 await page.route('**/api/v1/mail/preferences',async r=>{if(r.request().method()==='POST'){rules=r.request().postDataJSON().rules;await r.fulfill({json:{saved:true}})}else await r.fulfill({json:{rules}})})
 await page.goto('http://127.0.0.1:5173/settings');await expect(page.getByLabel('Additional importance rules')).toBeEnabled();await page.getByLabel('Additional importance rules').fill('Prioritize direct requests from my project team.');await page.getByRole('button',{name:'Save email rules'}).click();await expect(page.getByText('Saved. Today’s automatic classifications',{exact:false})).toBeVisible();await page.reload();await expect(page.getByLabel('Additional importance rules')).toHaveValue(rules)
})
test('inbox linkifies only eligible plaintext web destinations without loading them',async({page})=>{
 const body=['First paragraph','','Deal https://www.newegg.com/p/N82E16834156587?Item=N82E16834156587&utm_source=email&amp;utm_campaign=synthetic','Balanced (https://example.com/docs_(new)).Next','Normal https://example.com/news','javascript:alert(1)','http://user@evil.example/path','http://127.0.0.1/private','https://раypal.example/login','<script>window.syntheticExecuted=true</script>'].join('\n')
 const message=msg('links',new Date().toISOString(),true);message.data.body=body
 const external:string[]=[]
 page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:5173'))external.push(request.url())})
 await page.route('**/api/v1/mail/snapshot',route=>route.fulfill({json:{messages:[message],accounts:[],today:new Date().toISOString().slice(0,10)}}))
 await page.goto('http://127.0.0.1:5173/inbox?message=links')
 const card=page.locator('.email-card[open]')
 await expect(card.getByRole('link',{name:/newegg\.com/})).toHaveAttribute('href',/utm_source=email&utm_campaign=synthetic/)
 await expect(card.getByRole('link',{name:'https://example.com/docs_(new)'})).toHaveAttribute('rel','noopener noreferrer')
 await expect(card.getByRole('link',{name:'https://example.com/news'})).toHaveAttribute('referrerpolicy','no-referrer')
 await expect(card.getByRole('link')).toHaveCount(3)
 await expect(card.locator('script')).toHaveCount(0)
 await expect(card.locator('.email-body')).toContainText('javascript:alert(1)')
 await expect(card.locator('.email-body')).toHaveCSS('white-space','pre-wrap')
 expect(await page.evaluate(()=>Reflect.get(window,'syntheticExecuted'))).toBeUndefined()
 expect(external).toEqual([])
})
