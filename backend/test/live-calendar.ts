import {randomUUID} from 'node:crypto'
import {Pool} from 'pg'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
import {readCalendarConfig} from '../src/caldav.js'
import {fetchSnapshot,runSync,sourceHash} from '../src/sync.js'
process.loadEnvFile('.env')
if(process.env.DAYMARK_ALLOW_LIVE_TEST!=='true')throw new Error('Live test requires explicit approval and DAYMARK_ALLOW_LIVE_TEST=true')
const config=readCalendarConfig()!
const origin=process.env.APP_ORIGIN!
const pool=new Pool({connectionString:process.env.DATABASE_URL})
const id=randomUUID(),title=`Daymark integration test ${id.slice(0,8)}`
let resource:string|undefined
const browser=await chromium.launch()
const context=await browser.newContext({viewport:{width:1440,height:1000}})
try {
 const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}})
 if(login.status()!==200)throw Error('Live login failed')
 const response=await context.request.get(origin+'/api/v1/calendar/snapshot')
 const snapshot=await response.json()
 const personal=snapshot.calendars.filter((c:{name:string})=>c.name===process.env.CALENDAR_TEST_CALENDAR)
 if(personal.length!==1)throw Error('Ambiguous Personal event calendar')
 resource=new URL(id+'.ics',personal[0].url.endsWith('/')?personal[0].url:personal[0].url+'/').href
 const start=new Date();start.setHours(12,0,0,0);const end=new Date(start);end.setHours(13)
 const change={id,calendarId:personal[0].id,title,start:start.toISOString(),end:end.toISOString(),allDay:false,description:'Temporary Daymark verification; safe to remove.',location:''}
 const created=await context.request.post(origin+'/api/v1/calendar/changes',{headers:{origin},data:change})
 if(created.status()!==200)throw Error('Live create failed: HTTP '+created.status())
 const replay=await context.request.post(origin+'/api/v1/calendar/changes',{headers:{origin},data:change})
 if(replay.status()!==200)throw Error('Idempotent replay failed')
 console.log('Authenticated create and idempotent replay passed')
 if(await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),true)!=='synced')throw Error('Post-create sync failed')
 const page=await context.newPage();await page.goto(origin)
 const entry=page.locator('.schedule-event').filter({hasText:title})
 await entry.waitFor()
 await entry.locator('summary').click()
 await entry.getByRole('button',{name:'Edit event',exact:true}).click()
 await page.getByLabel('Event title',{exact:true}).fill(title+' edited')
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/v1/calendar/changes')&&r.request().method()==='POST'&&r.status()===200)
 await page.getByRole('button',{name:'Save event',exact:true}).click()
 await saved
 if(await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),true)!=='synced')throw Error('Post-edit sync failed')
 await page.reload()
 await page.getByText(title+' edited',{exact:true}).waitFor()
 await page.screenshot({path:'../frontend/test-results/calendar-live.png',fullPage:true})
 await page.route('**/api/**',route=>route.abort())
 await page.reload()
 await page.getByText(title+' edited',{exact:true}).waitFor()
 console.log('Real event displayed, edited through frontend, and retained from IndexedDB with API unavailable')
}finally{
 if(resource){
  const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')}
  const existing=await fetch(resource,{headers,redirect:'error'})
  if(existing.ok){const text=await existing.text();if(!text.includes(id+'@daymark'))throw Error('Cleanup refused: unexpected resource UID')
   const removed=await fetch(resource,{method:'DELETE',headers:{...headers,'If-Match':existing.headers.get('etag')!},redirect:'error'})
   if(!removed.ok)throw Error('Test cleanup failed')
  }
  const verify=await fetch(resource,{headers,redirect:'error'})
  if(verify.status!==404)throw Error('Test event absence not verified')
  console.log('Test event deletion verified by exact-resource HTTP 404')
  await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),true)
 }
 await context.request.post(origin+'/api/v1/auth/logout',{headers:{origin}}).catch(()=>{})
 await browser.close();await pool.end()
}
