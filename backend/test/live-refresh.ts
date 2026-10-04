import assert from 'node:assert/strict'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
process.loadEnvFile('.env')
const origin=process.env.APP_ORIGIN!,browser=await chromium.launch(),context=await browser.newContext()
try{
 assert.equal((await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}})).status(),200)
 const before=await (await context.request.get(origin+'/api/v1/calendar/snapshot')).json()
 const result=await context.request.post(origin+'/api/v1/calendar/refresh',{headers:{origin},timeout:100000});assert.equal(result.status(),200);const body=await result.json()
 const after=await (await context.request.get(origin+'/api/v1/calendar/snapshot')).json()
 assert.ok(after.lastSuccess);if(body.status==='synced')assert.ok(new Date(after.lastSuccess)>new Date(before.lastSuccess))
 console.log(JSON.stringify({status:body.status,snapshotVerified:!!after.lastSuccess,error:after.error??null}))
 assert.equal((await (await context.request.post(origin+'/api/v1/calendar/refresh',{headers:{origin}})).json()).status,'waiting');console.log('Cooldown verified')
}finally{await context.request.post(origin+'/api/v1/auth/logout',{headers:{origin}});await browser.close()}
