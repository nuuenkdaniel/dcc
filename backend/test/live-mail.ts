import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
process.loadEnvFile('.env')
if(process.env.DAYMARK_ALLOW_LIVE_TEST!=='true')throw Error('Explicit live-test permission required')
const pool=new Pool({connectionString:process.env.DATABASE_URL}),origin=process.env.APP_ORIGIN!
const browser=await chromium.launch(),ctx=await browser.newContext({viewport:{width:1440,height:1000}})
let restore:any
try{
 assert.equal((await ctx.request.get(origin+'/api/v1/mail/snapshot')).status(),401)
 assert.equal((await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}})).status(),200)
 const snap=await(await ctx.request.get(origin+'/api/v1/mail/snapshot')).json();assert.ok(snap.messages.length);assert.equal(snap.accounts.length,3);assert.ok(snap.accounts.every((a:any)=>a.last_success&&!a.error))
 const counts=Object.fromEntries(['personal','school','work'].map(a=>[a,snap.messages.filter((m:any)=>m.data.account===a).length]));assert.ok(Object.values(counts).every(n=>n>0))
 const page=await ctx.newPage();await page.goto(origin+'/inbox');await page.locator('.email-card').first().waitFor();assert.equal(await page.locator('.email-card').count(),50)
 await page.getByLabel('Account',{exact:true}).selectOption('school');assert.ok(await page.locator('.email-card .email-account').evaluateAll((els:any[])=>els.every(e=>e.textContent==='School')))
 await page.getByLabel('Account',{exact:true}).selectOption('all');await page.locator('.email-card summary').first().click();await page.locator('.email-card').first().getByText('Account:',{exact:false}).waitFor()
 const first=snap.messages[0];restore=(await pool.query('SELECT id,override,feedback_at FROM mail_messages WHERE id=$1',[first.data.id])).rows[0]
 const response=await ctx.request.post(origin+'/api/v1/mail/feedback',{headers:{origin},data:{id:first.data.id,important:true}});assert.equal(response.status(),200);assert.equal((await pool.query('SELECT override FROM mail_messages WHERE id=$1',[first.data.id])).rows[0].override,true)
 const attachment=snap.messages.find((m:any)=>m.data.mimeVersion===2&&m.data.attachments.some((a:any)=>a.size>0&&a.size<1024*1024));assert.ok(attachment,'Need a real attachment for download validation');const part=attachment.data.attachments.find((a:any)=>a.size>0&&a.size<1024*1024)
 const download=await ctx.request.get(origin+'/api/v1/mail/attachment/'+attachment.data.id+'/'+part.part);assert.equal(download.status(),200);assert.ok((await download.body()).length>0);assert.equal(download.headers()['content-type'],'application/octet-stream');assert.ok(download.headers()['content-disposition'].startsWith('attachment;'))
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Inbox overflow at ${width}`)}
 await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'../frontend/test-results/mail-live-mobile.png',fullPage:false})
 const current=await(await ctx.request.get(origin+'/api/v1/mail/snapshot')).json();const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});const important=current.messages.filter((m:any)=>eastern.format(new Date(m.data.receivedAt))===current.today&&(m.override??m.analysis?.important??false)).length
 await page.goto(origin);await page.waitForFunction((n:number)=>document.querySelectorAll('.email-brief').length===n,important);assert.ok(important>0,'Real current-day important message should appear');await page.goto(origin+'/inbox');await page.locator('.email-card').first().waitFor()
 await page.route('**/api/v1/mail/**',r=>r.abort());await page.reload();await page.locator('.email-card').first().waitFor();assert.ok(await page.locator('.email-card').count()>0)
 console.log(JSON.stringify({passed:true,accounts:counts,checks:['unauthenticated denied','all account cache','account filtering','message expansion','feedback persisted','real attachment bytes and safe download headers','375/768/1440 layout','real today-only homepage briefing','IndexedDB cached reload during outage']}))
}finally{if(restore){await pool.query('UPDATE mail_messages SET override=$2,feedback_at=$3 WHERE id=$1',[restore.id,restore.override,restore.feedback_at]);assert.equal((await pool.query('SELECT override FROM mail_messages WHERE id=$1',[restore.id])).rows[0].override,restore.override)}await ctx.request.post(origin+'/api/v1/auth/logout',{headers:{origin}}).catch(()=>{});await browser.close();await pool.end()}
