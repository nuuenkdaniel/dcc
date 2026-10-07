import {manualTaskRoutes} from './manual-tasks.js'
import {priceRoutes} from './prices.js'
import {mailRoutes} from './mail.js'
import {extractMaterial} from './study-material.js'
import {validateOutline} from './study.js'
import type {Pool} from 'pg'
import {plannerSnapshot,saveEntity,requestPlan,callCurator,type Entity} from './planner.js'
import Fastify from 'fastify'
import type { EventChange } from './calendar-write.js'
import { registerAuth, type AuthConfig } from './auth.js'

// Construction is separate from listening so tests require no network port.
export function buildApp(options: { calendarRefresh?:()=>Promise<string>; plannerPool?:Pool; logger?: boolean | { level: string }; auth?: AuthConfig; calendarSnapshot?:()=>Promise<unknown>; calendarChange?:(change:EventChange)=>Promise<{code:number;error?:string;saved?:boolean}> } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1048576 })
  registerAuth(app, options.auth)
  app.get('/health', async () => ({ status: 'ok', service: 'daymark-backend' }))
  app.get('/api/v1/status', async () => ({
    apiVersion: 'v1',
    capabilities: { dailyPlan: !!options.plannerPool, sync: !!options.calendarSnapshot, authentication: !!options.auth, email: !!options.plannerPool, calendar: !!options.calendarSnapshot },
  }))
  app.register(async scope => {
    if(options.plannerPool){manualTaskRoutes(scope,options.plannerPool);mailRoutes(scope,options.plannerPool);priceRoutes(scope,options.plannerPool)}
    scope.get('/api/v1/planner/snapshot',async(_request,reply)=>options.plannerPool?plannerSnapshot(options.plannerPool):reply.code(503).send({error:'Planner unavailable'}))
    scope.post<{Body:{kind:string;version:number;data:Entity}}>('/api/v1/planner/entity',{schema:{body:{type:'object',required:['kind','version','data'],additionalProperties:false,properties:{kind:{enum:['project','action','preparation']},version:{type:'integer',minimum:0},data:{type:'object',required:['id','title'],properties:{id:{type:'string',format:'uuid'},title:{type:'string',minLength:1,maxLength:240}}}}}}},async(request,reply)=>{
      if(!options.plannerPool)return reply.code(503).send({error:'Planner unavailable'})
      const result=await saveEntity(options.plannerPool,request.body.kind,request.body.version,request.body.data);return reply.code(result.code).send(result)
    })
    scope.post<{Body:{name:string;content:string}}>('/api/v1/planner/material',{bodyLimit:7500000},async(request,reply)=>{try{return await extractMaterial(request.body?.name,request.body?.content)}catch(e){return reply.code(400).send({error:e instanceof Error?e.message:'Material extraction failed'})}})
    scope.post<{Body:{sessionId:string}}>('/api/v1/planner/session',async(request,reply)=>{if(!/^[a-f0-9]{12,64}$/.test(request.body?.sessionId??''))return reply.code(400).send({error:'Use an exact session ID'});try{return await callCurator({mode:'session',sessionId:request.body.sessionId})}catch{return reply.code(502).send({error:'Session unavailable; paste the relevant study notes instead'})}})
    scope.post<{Body:{text:string;title:string}}>('/api/v1/planner/extract',async(request,reply)=>{const b=request.body;if(typeof b?.text!=='string'||!b.text.trim()||b.text.length>100000||typeof b.title!=='string'||b.title.length>240)return reply.code(400).send({error:'Provide up to 100,000 characters of study context'});try{return validateOutline(await callCurator({mode:'extract',text:b.text,title:b.title}))}catch{return reply.code(502).send({error:'Could not extract a valid outline; your materials are retained in the panel'})}})
    scope.post('/api/v1/planner/refresh',async(_request,reply)=>{if(!options.plannerPool)return reply.code(503).send({error:'Planner unavailable'});await requestPlan(options.plannerPool);return reply.code(202).send({queued:true})})

    scope.post<{Body:EventChange}>('/api/v1/calendar/changes',{schema:{body:{type:'object',required:['id','calendarId','title','start','end','allDay','description','location'],additionalProperties:false,properties:{operation:{enum:['delete']},id:{type:'string',format:'uuid'},calendarId:{type:'string',maxLength:64},eventId:{type:'string',maxLength:64},etag:{type:'string',maxLength:512},title:{type:'string',minLength:1,maxLength:500},description:{type:'string',maxLength:20000},location:{type:'string',maxLength:1000},start:{type:'string',maxLength:40},end:{type:'string',maxLength:40},allDay:{type:'boolean'}}}}},async(request,reply)=>{
     if(!options.calendarChange)return reply.code(503).send({error:'Calendar writes are not configured'})
     const c=request.body;if(c.operation==='delete'&&!c.eventId)return reply.code(400).send({error:'Deletion requires an existing event'});const pattern=c.allDay?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
     if(!pattern.test(c.start)||!pattern.test(c.end)||!Number.isFinite(Date.parse(c.start))||!Number.isFinite(Date.parse(c.end))||Date.parse(c.end)<=Date.parse(c.start))return reply.code(400).send({error:'Invalid event dates'})
     try{const result=await options.calendarChange(c);return reply.code(result.code).send(result)}catch{return reply.code(502).send({error:'Calendar save failed; retry safely'})}
    })
    scope.post('/api/v1/calendar/refresh',async(_request,reply)=>{if(!options.calendarRefresh)return reply.code(503).send({error:'Calendar sync unavailable'});const status=await options.calendarRefresh();return reply.code(status==='failed'?502:200).send({status})})
    scope.get('/api/v1/calendar/snapshot' ,async(_request,reply)=>options.calendarSnapshot ? options.calendarSnapshot():reply.code(503).send({error:'Calendar sync is not configured'}))
  })
  return app
}
