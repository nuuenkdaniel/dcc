import {test as base,expect,type BrowserContext,type Page,type Route} from '@playwright/test'

type SyntheticState={manualTasks:unknown[];manualVersion:number;mailRules:string}

async function syntheticApi(route:Route,state:SyntheticState){
 const request=route.request(),method=request.method(),path=new URL(request.url()).pathname
 if(method==='GET'){
  if(path==='/api/v1/calendar/snapshot')return route.fulfill({json:{calendars:[],events:[],lastSuccess:null}})
  if(path==='/api/v1/planner/snapshot')return route.fulfill({json:{preparations:[],projects:[],actions:[],status:{}}})
  if(path==='/api/v1/planner/manual-tasks')return route.fulfill({json:{version:state.manualVersion,data:{tasks:state.manualTasks}}})
  if(path==='/api/v1/mail/preferences')return route.fulfill({json:{rules:state.mailRules}})
  if(path.startsWith('/api/v1/mail/html/'))return route.fulfill({json:{html:null,hasHtml:false}})
  if(path==='/api/v1/mail/page')return route.fulfill({json:{messages:[],briefing:[],accounts:[],today:'2026-10-06',total:0,nextCursor:null}})
  if(path.startsWith('/api/v1/mail/message/'))return route.fulfill({status:404,json:{error:'Synthetic message not found'}})
  if(path==='/api/v1/prices/snapshot')return route.fulfill({json:{items:[],sources:[],history:[]}})
  return route.fulfill({json:{}})
 }
 if(path==='/api/v1/auth/login')return route.fulfill({status:401,json:{error:'Synthetic login not configured for this test'}})
  if(path==='/api/v1/auth/logout')return route.fulfill({json:{authenticated:false}})
 if(path==='/api/v1/calendar/refresh')return route.fulfill({json:{status:'synced'}})
 if(path==='/api/v1/calendar/changes')return route.fulfill({json:{saved:true}})
 if(path==='/api/v1/planner/manual-tasks'){const body=request.postDataJSON() as {tasks?:unknown[]};state.manualTasks=Array.isArray(body.tasks)?body.tasks:state.manualTasks;state.manualVersion++;return route.fulfill({json:{code:200}})}
 if(path==='/api/v1/planner/entity')return route.fulfill({json:{code:200}})
 if(path==='/api/v1/planner/refresh')return route.fulfill({json:{queued:true}})
 if(path==='/api/v1/planner/material')return route.fulfill({json:{name:'synthetic.txt',text:''}})
 if(path==='/api/v1/planner/extract')return route.fulfill({json:{topics:[],progress:''}})
 if(path==='/api/v1/mail/refresh')return route.fulfill({json:{queued:true}})
 if(path==='/api/v1/mail/preferences'){const body=request.postDataJSON() as {rules?:unknown};if(typeof body.rules==='string')state.mailRules=body.rules;return route.fulfill({json:{saved:true}})}
 if(path==='/api/v1/mail/feedback'||path==='/api/v1/prices/settings')return route.fulfill({json:{saved:true}})
 if(path==='/api/v1/prices/refresh')return route.fulfill({status:202,json:{queued:0,note:'Synthetic price check.'}})
 return route.fulfill({json:{ok:true}})
}

export async function mockAuthenticatedApi(target:Page|BrowserContext){
 const state:SyntheticState={manualTasks:[],manualVersion:0,mailRules:''}
 await target.route('**/api/v1/**',route=>syntheticApi(route,state))
 await target.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated:true,configured:true}}))
}

const test=base.extend<{authenticatedSession:void}>({
 authenticatedSession:[async({page},use)=>{
  await mockAuthenticatedApi(page)
  await use()
 },{auto:true}],
})

export {test,expect}
export type {BrowserContext}
