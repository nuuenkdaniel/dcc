import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {chromium} from '../../frontend/node_modules/playwright/index.mjs'
import {randomUUID} from 'node:crypto'
import {callCurator,runPlanner} from '../src/planner.js'
import {easternDay} from '../src/planner-policy.js'
process.loadEnvFile('.env')
if(process.env.DAYMARK_ALLOW_LIVE_TEST!=='true')throw Error('Explicit live-test permission required')
const pool=new Pool({connectionString:process.env.DATABASE_URL})
const id=randomUUID(),title='Daymark curator verification '+id.slice(0,8),origin=process.env.APP_ORIGIN!
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}})
try{
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM planner_entities WHERE kind='project'")).rows[0].n,0,'Do not run isolated live test over existing user projects')
 const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:process.env.DAYMARK_USERNAME,password:process.env.DAYMARK_PASSWORD}});assert.equal(login.status(),200)
 const project={id,title,category:'school',description:'Read an introductory statistics chapter covering mean, median and mode. Practice three short examples. This is a temporary verification project, not a real obligation.',deadline:easternDay(new Date()),importance:2,remainingMinutes:45,progress:'Not started',status:'active'}
 const created=await context.request.post(origin+'/api/v1/planner/entity',{headers:{origin},data:{kind:'project',version:0,data:project}});assert.equal(created.status(),200)
 const page=await context.newPage();await page.goto(origin+'/projects');await page.getByRole('heading',{name:title,exact:true}).waitFor()
 // Exercise a deterministic morning clock against the real synced calendar, rather than inventing spare time late at night.
 const morning=new Date(easternDay(new Date())+'T10:00:00Z')
 let called=false
 const result=await runPlanner(pool,async input=>{called=true;return callCurator(input)},true,morning)
 assert.equal(result,'generated');assert.equal(called,true,'Morning calendar must leave capacity for this verification')
 let snap=await (await context.request.get(origin+'/api/v1/planner/snapshot')).json()
 const action=snap.actions.find((a:{data:{projectId:string}})=>a.data.projectId===id)
 assert.ok(action,'Real provider produced a validated action')
 await page.goto(origin);await page.getByRole('checkbox',{name:'Complete '+action.data.title,exact:true}).check()
 await page.getByText('Planning & sync',{exact:true}).click();await page.getByRole('button',{name:'Sync now',exact:true}).click()
 await page.getByText('Projects and curated actions are up to date.',{exact:true}).waitFor()
 snap=await (await context.request.get(origin+'/api/v1/planner/snapshot')).json();assert.equal(snap.actions.find((a:{data:{id:string}})=>a.data.id===action.data.id).data.completed,true);assert.equal(snap.projects.find((p:{data:{id:string}})=>p.data.id===id).data.status,'active')
 await page.setViewportSize({width:375,height:1000});await page.goto(origin+'/projects');await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'../frontend/test-results/projects-live-mobile.png',fullPage:true})
 await page.route('**/api/v1/planner/**',r=>r.abort());await page.reload();await page.getByRole('heading',{name:title,exact:true}).waitFor()
 console.log('PASS: real authenticated project, real gpt-5.6-luna generation, validated daily action, browser completion without project completion, mobile layout, offline cached reload.')
}finally{
 await pool.query("DELETE FROM planner_entities WHERE id=$1 OR (kind='action' AND data->>'projectId'=$2)",[id,id])
 const remaining=(await pool.query('SELECT count(*)::int AS n FROM planner_entities')).rows[0].n
 if(remaining===0)await pool.query('UPDATE planner_runs SET day=NULL,last_success=NULL,error=NULL,summary=NULL,requested=false,next_attempt=now() WHERE id=1')
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM planner_entities WHERE id=$1 OR data->>'projectId'=$2",[id,id])).rows[0].n,0)
 await context.request.post(origin+'/api/v1/auth/logout',{headers:{origin}}).catch(()=>{})
 await browser.close();await pool.end();console.log('Verified removal of only test-created project/action records.')
}
