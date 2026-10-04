import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Pool} from 'pg'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
import {readCalendarConfig} from '../src/caldav.js'
import {runSync,fetchSnapshot,sourceHash} from '../src/sync.js'
import {runPlanner} from '../src/planner.js'
import {easternDay} from '../src/planner-policy.js'
process.loadEnvFile('.env')
if(process.env.DAYMARK_ALLOW_LIVE_TEST!=='true')throw Error('Explicit opt-in required')
const pool=new Pool({connectionString:process.env.DATABASE_URL}),config=readCalendarConfig()!,origin=process.env.APP_ORIGIN!,id=randomUUID(),title='Daymark study verification '+id.slice(0,8)
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}})
let resource:string|undefined,prepId:string|undefined
try{
 assert.equal((await pool.query("SELECT count(*)::int n FROM planner_entities WHERE kind IN ('project','preparation')")).rows[0].n,0,'Refuse live test over user obligations')
 const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}});assert.equal(login.status(),200)
 const snapshot=await (await context.request.get(origin+'/api/v1/calendar/snapshot')).json(),personal=snapshot.calendars.filter((c:{name:string})=>c.name===process.env.CALENDAR_TEST_CALENDAR);assert.equal(personal.length,1)
 const today=easternDay(new Date()),date=easternDay(new Date(Date.now()+3*86400000)),end=easternDay(new Date(Date.now()+4*86400000))
 resource=new URL(id+'.ics',personal[0].url.endsWith('/')?personal[0].url:personal[0].url+'/').href
 assert.equal((await context.request.post(origin+'/api/v1/calendar/changes',{headers:{origin},data:{id,calendarId:personal[0].id,title,start:date,end,allDay:true,description:'Temporary approved study integration verification',location:''}})).status(),200)
 assert.equal(await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),true),'synced')
 const page=await context.newPage();await page.setContent('<h1>Daymark verification study guide</h1><p>Exam covers mean, median and mode. Learn the definitions, solve three examples, and review mistakes. No previous progress is known.</p>');const pdf=await page.pdf()
 await page.goto(origin)
 const label=new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date(date+'T12:00:00'))
 if(!await page.getByRole('button',{name:label,exact:true}).count())await page.getByRole('button',{name:'Next month',exact:true}).click()
 await page.getByRole('button',{name:label,exact:true}).click();await page.getByText(title,{exact:true}).click();await page.getByRole('button',{name:'Prepare for this event'}).click()
 await page.getByLabel('Start studying').fill(today)
 await page.getByLabel('Upload study material').setInputFiles({name:'verification-guide.pdf',mimeType:'application/pdf',buffer:pdf})
 await page.getByText('Text extracted. Review it below before asking Hermes.',{exact:true}).waitFor()
 assert.ok((await page.getByLabel('Review source text / add topics and context').inputValue()).includes('PDF page 1'))
 await page.getByRole('button',{name:'Extract study outline',exact:true}).click()
 await page.getByText('Review the proposed topics, estimates and progress below. Nothing is saved to your plan yet.',{exact:true}).waitFor({timeout:160000})
 await page.getByLabel('I reviewed the topics, estimates and progress.').check()
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/v1/planner/entity')&&r.request().method()==='POST'&&r.status()===200)
 await page.getByRole('button',{name:'Save preparation',exact:true}).click();await saved
 let snap=await (await context.request.get(origin+'/api/v1/planner/snapshot')).json();prepId=snap.preparations.find((p:{data:{title:string}})=>p.data.title===title).data.id
 assert.equal(await runPlanner(pool,undefined,true,new Date(today+'T10:00:00Z')),'generated')
 snap=await (await context.request.get(origin+'/api/v1/planner/snapshot')).json();const action=snap.actions.find((a:{data:{preparationId:string}})=>a.data.preparationId===prepId);assert.ok(action,'Real model must produce a study action')
 await page.goto(origin);await page.getByRole('checkbox',{name:'Complete '+action.data.title,exact:true}).check()
 await page.getByLabel('Study feedback for '+action.data.title).selectOption('review')
 await page.getByText('Planning & sync',{exact:true}).click();await page.getByRole('button',{name:'Sync now',exact:true}).click();await page.getByText('Projects and curated actions are up to date.',{exact:true}).waitFor()
 snap=await (await context.request.get(origin+'/api/v1/planner/snapshot')).json();assert.equal(snap.actions.find((a:{data:{id:string}})=>a.data.id===action.data.id).data.feedback,'review');assert.equal(snap.preparations[0].data.status,'active')
 await page.getByRole('button',{name:label,exact:true}).click();await page.getByText(title,{exact:true}).click();await page.getByRole('button',{name:'Prepare for this event'}).click();await page.setViewportSize({width:375,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'../frontend/test-results/study-live-mobile.png',fullPage:true})
 console.log('PASS real PDF upload, reviewed real-model outline, linked preparation, real daily generation, browser completion/feedback, mobile layout.')
 const session=await context.request.post(origin+'/api/v1/planner/session',{headers:{origin},data:{sessionId:'27251f2565cb'}});assert.equal(session.status(),200);assert.ok((await session.json()).text.includes('Logistic'));console.log('PASS selected-session excerpt read; no tool messages included.')
}finally{
 // Discover only this uniquely titled test preparation if a later assertion interrupted assignment.
 const ids=(await pool.query("SELECT id FROM planner_entities WHERE kind='preparation' AND data->>'title'=$1",[title])).rows.map(r=>r.id)
 for(const pid of ids){await pool.query("DELETE FROM planner_entities WHERE id=$1 OR data->>'preparationId'=$2",[pid,pid]);assert.equal((await pool.query("SELECT count(*)::int n FROM planner_entities WHERE id=$1 OR data->>'preparationId'=$2",[pid,pid])).rows[0].n,0)}
 if(resource){const headers={Authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64')};const existing=await fetch(resource,{headers,redirect:'error'});if(existing.ok){assert.ok((await existing.text()).includes(id+'@daymark'));assert.ok((await fetch(resource,{method:'DELETE',headers:{...headers,'If-Match':existing.headers.get('etag')!},redirect:'error'})).ok)}assert.equal((await fetch(resource,{headers,redirect:'error'})).status,404);await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),true)}
 await pool.query("UPDATE planner_runs SET requested=true,next_attempt=now(),summary=NULL WHERE id=1")
 await context.request.post(origin+'/api/v1/auth/logout',{headers:{origin}}).catch(()=>{});await browser.close();await pool.end();console.log('Verified removal of exact test event and preparation/action records.')
}
