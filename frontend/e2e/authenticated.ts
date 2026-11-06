import {test as base,expect,type BrowserContext,type Page,type Route} from '@playwright/test'
import {assertRecurrencePreserved,canonicalTaskJson,type SharedTask} from '../src/sharedTasks'
import {validManualTask} from '../../backend/src/manual-tasks'

type SyntheticState={manualTasks:SharedTask[];manualVersion:number;mailRules:string}

// Mirror saveTasks' collection CAS/idempotency, tombstone and additive-field
// rules. A stateful mock must not silently accept stale whole-collection writes.
export function saveSyntheticTasks(state:{manualTasks:SharedTask[];manualVersion:number},body:{version:number;tasks:SharedTask[]}){
 if(!body||!Number.isInteger(body.version)||body.version<0||!Array.isArray(body.tasks)||body.tasks.length>10000||!body.tasks.every(validManualTask)||new Set(body.tasks.map(task=>task.id)).size!==body.tasks.length)return {code:400,error:'Invalid synthetic task collection'}
 const incoming=new Map(body.tasks.map(task=>[task.id,task])),previous=new Map(state.manualTasks.map(task=>[task.id,task]))
 try{for(const old of state.manualTasks){const next=incoming.get(old.id);if(old.deleted&&!next)return {code:409,error:'Synthetic tombstone cannot be removed'};assertRecurrencePreserved(old,next)}}catch{return {code:409,error:'Synthetic recurrence cannot be stripped'}}
 const tasks=body.tasks.map(task=>({...Object.fromEntries(Object.entries(previous.get(task.id)??{}).filter(([key])=>!['id','title','date','notes','completed','important','deleted','sample'].includes(key))),...task}))
 const comparable=(items:SharedTask[])=>canonicalTaskJson(items.map(task=>({...task,important:!!task.important,deleted:!!task.deleted})))
 if(comparable(state.manualTasks)===comparable(tasks))return {code:200,version:state.manualVersion}
 if(body.version!==state.manualVersion)return {code:409,error:'Synthetic task collection changed',latest:{version:state.manualVersion,data:{tasks:state.manualTasks}}}
 state.manualTasks=tasks;state.manualVersion++
 return {code:200}
}

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
 if(path==='/api/v1/planner/manual-tasks'){const result=saveSyntheticTasks(state,request.postDataJSON());return route.fulfill({status:result.code,json:result})}
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
 await target.route('**/api/v1/auth/session',route=>route.fulfill({json:{authenticated:true,configured:true,workspaceOwner:'a'.repeat(64)}}))
}

const test=base.extend<{authenticatedSession:void}>({
 authenticatedSession:[async({page},use)=>{
  await mockAuthenticatedApi(page)
  await use()
 },{auto:true}],
})

export {test,expect}
export type {BrowserContext}
