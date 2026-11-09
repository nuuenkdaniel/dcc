import {manualTaskRoutes} from './manual-tasks.js'
import {tellHermes} from './tell-hermes.js'
import {priceRoutes} from './prices.js'
import {mailRoutes} from './mail.js'
import {extractMaterial} from './study-material.js'
import {validateOutline} from './study.js'
import type {Pool} from 'pg'
import {plannerSnapshot,saveEntity,requestPlan,callCurator,previewCustomProjectTasks,type Entity} from './planner.js'
import Fastify from 'fastify'
import type { EventChange } from './calendar-write.js'
import { registerAuth, type AuthConfig } from './auth.js'
import {ACTION_PATH,TASK_ACTION_PATH,TASK_CALLBACK_PATH,TaskActions,TaskCallbackError} from './mcp/task-actions.js'
import {CONVERSATION_PATH,validConversationInput} from './mcp/conversation.js'
import {plainRecord} from './mcp/contracts.js'

// Construction is separate from listening so tests require no network port.
export function buildApp(options: { taskActions?:TaskActions; calendarRefresh?:()=>Promise<string>; plannerPool?:Pool; curator?:(input:unknown)=>Promise<unknown>; logger?: boolean | { level: string }; auth?: AuthConfig; calendarSnapshot?:()=>Promise<unknown>; calendarChange?:(change:EventChange)=>Promise<{code:number;error?:string;saved?:boolean}> } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1048576 })
  if(options.taskActions){
    let timer:ReturnType<typeof setInterval>|undefined,working=false
    const expire=async()=>{
      if(working)return;working=true
      try{await options.taskActions!.expireConversationText()}
      catch{app.log.warn('Hermes conversation text expiry is unavailable; execution receipts are unchanged.')}
      finally{working=false}
    }
    app.addHook('onReady',async()=>{await expire();timer=setInterval(()=>void expire(),60000);timer.unref()})
    app.addHook('onClose',async()=>{if(timer)clearInterval(timer)})
  }
  const authenticatedOwner=registerAuth(app, options.auth, options.taskActions?{verify:authorization=>options.taskActions!.verifyCallback(authorization)}:undefined)
  app.get('/health', async () => ({ status: 'ok', service: 'daymark-backend' }))
  app.get('/api/v1/status', async () => ({
    apiVersion: 'v1',
    capabilities: { dailyPlan: !!options.plannerPool, sync: !!options.calendarSnapshot, authentication: !!options.auth, email: !!options.plannerPool, calendar: !!options.calendarSnapshot },
  }))
  app.register(async scope => {
    // Authenticated discovery only: no capability, actor, bridge URL or secret.
    scope.get('/api/v1/hermes/capabilities',async()=>({taskActions:!!options.taskActions&&!!options.auth}))
    scope.get('/api/v1/hermes/action-capabilities',async request=>({productActions:!!options.taskActions&&!!options.auth,conversation:!!options.taskActions&&!!options.auth,conversationContextVersion:1,conversationReplyVersion:1,conversationChatVersion:1,conversationDisplaySyncVersion:1,...(authenticatedOwner(request)?{workspaceOwner:authenticatedOwner(request)}:{})}))
    if(options.taskActions){
      scope.post(CONVERSATION_PATH,{bodyLimit:20000,logLevel:'silent',config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async(request,reply)=>{
        const owner=authenticatedOwner(request)
        if(!owner)return reply.code(401).send({message:'Sign in required'})
        if(!plainRecord(request.body)||typeof request.body.workspaceOwner!=='string')return reply.code(400).send({message:'Use the authenticated workspace owner fence.'})
        if(request.body.workspaceOwner!==owner)return reply.code(409).send({message:'Workspace changed. This turn was not admitted.'})
        const {workspaceOwner:_,...input}=request.body
        if(!validConversationInput(input))return reply.code(400).send({message:'Invalid bounded conversation request.'})
        const abort=new AbortController(),stop=()=>abort.abort()
        request.raw.once('aborted',stop)
        const onClose=()=>{if(!reply.raw.writableEnded)stop()}
        reply.raw.once('close',onClose)
        try{return await options.taskActions!.converse(input,owner,abort.signal,request.headers['x-dcc-display-sync']==='1')}
        catch(error){
          const conflict=error instanceof Error&&['conversation_conflict','active_conversation','closed_question','intent_conflict','executor_conflict'].includes(error.message)
          return reply.code(conflict?409:502).send({message:conflict?'This conversation is closed, already answered, or another request is active. No automatic resend.':'Request not confirmed. Effects may have saved. No automatic resend.'})
        }finally{request.raw.off('aborted',stop);reply.raw.off('close',onClose)}
      })
      scope.post(TASK_CALLBACK_PATH,{bodyLimit:65536,logLevel:'silent',config:{rateLimit:{max:128,timeWindow:'1 minute'}}},async(request,reply)=>{
        if(request.url!==TASK_CALLBACK_PATH||request.headers.cookie!==undefined||request.headers.origin!==undefined)return reply.code(403).send({error:'Task callback denied'})
        try{
          const response=await options.taskActions!.callback(request.headers.authorization,request.body)
          return response===undefined?reply.code(202).send():reply.send(response)
        }catch(error){return reply.code(error instanceof TaskCallbackError?error.status:502).send({error:'Task callback unavailable'})}
      })
      scope.post<{Body:{key:string;tabId:string;ack?:unknown}}>('/api/v1/hermes/timer-bridge',{bodyLimit:20000,logLevel:'silent',config:{rateLimit:{max:240,timeWindow:'1 minute'}}},async(request,reply)=>{
        const b=request.body
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['key','tabId','ack'].includes(k))||typeof b.key!=='string'||!/^\w[\w-]{15,79}$/.test(b.key)||typeof b.tabId!=='string'||!/^[a-f0-9-]{36}$/.test(b.tabId))return reply.code(400).send({error:'Invalid timer channel'})
        if(b.ack!==undefined&&!options.taskActions!.ackTimer(b.key,b.tabId,b.ack))return reply.code(409).send({error:'Timer acknowledgment unavailable'})
        return {commands:options.taskActions!.pollTimer(b.key,b.tabId)}
      })
      for(const actionPath of [TASK_ACTION_PATH,ACTION_PATH])scope.post<{Body:{key:string;prompt:string;tabId?:string}}>(actionPath,{bodyLimit:20000,logLevel:'silent',config:{rateLimit:{max:6,timeWindow:'1 minute'}},preValidation:async(request,reply)=>{
        const b=request.body
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).filter(k=>k!=='tabId').sort().join(',')!=='key,prompt'||b.tabId!==undefined&&(actionPath!==ACTION_PATH||typeof b.tabId!=='string'||!/^[a-f0-9-]{36}$/.test(b.tabId))||typeof b.key!=='string'||typeof b.prompt!=='string'||!/^\w[\w-]{15,79}$(?![\s\S])/.test(b.key)||!b.prompt.trim()||b.prompt.length>4000)return reply.code(400).send({message:'Use only a submission key and task request.'})
      }},async(request,reply)=>{
        const abort=new AbortController(),stop=()=>abort.abort()
        request.raw.once('aborted',stop)
        const onClose=()=>{if(!reply.raw.writableEnded)stop()}
        reply.raw.once('close',onClose)
        try{
          const summary=await (actionPath===ACTION_PATH?options.taskActions!.runProduct(request.body,abort.signal):options.taskActions!.run(request.body,abort.signal))
          // HTTP success means the UI should refresh authoritative snapshots,
          // NOT that every natural-language goal or pending effect is complete.
          return {message:summary.phase==='completed'?'Task action receipts checked.':'Task action may be pending. Retry this same submission for receipts.',summary}
        }catch(error){
          const conflict=error instanceof Error&&['intent_conflict','executor_conflict'].includes(error.message)
          return reply.code(conflict?409:502).send({message:'Task action was not confirmed. Keep this submission unchanged and retry safely.'})
        }finally{request.raw.off('aborted',stop);reply.raw.off('close',onClose)}
      })
    }
    scope.post<{Body:{key:string;prompt:string}}>('/api/v1/hermes/commands',{bodyLimit:20000,config:{rateLimit:{max:12,timeWindow:'1 minute'}},preValidation:async(request,reply)=>{
      // Reject before Fastify's default coercion/removal of additional fields.
      const b=request.body
      if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='key,prompt'||typeof b.key!=='string'||typeof b.prompt!=='string')return reply.code(400).send({message:'Use only a string submission key and command prompt.'})
    },schema:{body:{type:'object',required:['key','prompt'],additionalProperties:false,properties:{key:{type:'string',minLength:16,maxLength:80,pattern:'^\\w[\\w-]+$'},prompt:{type:'string',minLength:1,maxLength:4000}}}}},async(request,reply)=>{
      if(!options.plannerPool)return reply.code(503).send({message:'Planner unavailable. Nothing was created.'})
      try{const result=await tellHermes(request.body,{pool:options.plannerPool,curator:options.curator,calendarChange:options.calendarChange});return reply.code(result.code).send(result)}catch{return reply.code(502).send({message:'Creation was not confirmed. Retry this same submission safely.'})}
    })
    priceRoutes(scope) // Retired compatibility endpoints never touch storage.
    if(options.plannerPool){manualTaskRoutes(scope,options.plannerPool);mailRoutes(scope,options.plannerPool)}
    scope.get('/api/v1/planner/snapshot',async(_request,reply)=>options.plannerPool?plannerSnapshot(options.plannerPool):reply.code(503).send({error:'Planner unavailable'}))
    scope.post<{Body:{kind:string;version:number;data:Entity}}>('/api/v1/planner/entity',{schema:{body:{type:'object',required:['kind','version','data'],additionalProperties:false,properties:{kind:{enum:['project','action','preparation']},version:{type:'integer',minimum:0},data:{type:'object',required:['id','title'],properties:{id:{type:'string',format:'uuid'},title:{type:'string',minLength:1,maxLength:240}}}}}}},async(request,reply)=>{
      if(!options.plannerPool)return reply.code(503).send({error:'Planner unavailable'})
      const result=await saveEntity(options.plannerPool,request.body.kind,request.body.version,request.body.data);return reply.code(result.code).send(result)
    })
    scope.post<{Body:{name:string;content:string}}>('/api/v1/planner/material',{bodyLimit:7500000},async(request,reply)=>{try{return await extractMaterial(request.body?.name,request.body?.content)}catch(e){return reply.code(400).send({error:e instanceof Error?e.message:'Material extraction failed'})}})
    scope.post<{Body:{sessionId:string}}>('/api/v1/planner/session',async(request,reply)=>{if(!/^[a-f0-9]{12,64}$/.test(request.body?.sessionId??''))return reply.code(400).send({error:'Use an exact session ID'});try{return await callCurator({mode:'session',sessionId:request.body.sessionId})}catch{return reply.code(502).send({error:'Session unavailable; paste the relevant study notes instead'})}})
    scope.post<{Body:{text:string;title:string}}>('/api/v1/planner/extract',async(request,reply)=>{const b=request.body;if(typeof b?.text!=='string'||!b.text.trim()||b.text.length>100000||typeof b.title!=='string'||b.title.length>240)return reply.code(400).send({error:'Provide up to 100,000 characters of study context'});try{return validateOutline(await callCurator({mode:'extract',text:b.text,title:b.title}))}catch{return reply.code(502).send({error:'Could not extract a valid outline; your materials are retained in the panel'})}})
    scope.post<{Body:{projectId:string;prompt:string;dateWindow?:{start:string;end:string}}}>('/api/v1/planner/custom-project-preview',{schema:{body:{type:'object',required:['projectId','prompt'],additionalProperties:false,properties:{projectId:{type:'string',format:'uuid'},prompt:{type:'string',minLength:1,maxLength:4000},dateWindow:{type:'object',required:['start','end'],additionalProperties:false,properties:{start:{type:'string',maxLength:10},end:{type:'string',maxLength:10}}}}}}},async(request,reply)=>{
     if(!options.plannerPool)return reply.code(503).send({error:'Planner unavailable'})
     try{return await previewCustomProjectTasks(options.plannerPool,request.body,options.curator??callCurator)}catch(error){const message=error instanceof Error?error.message:'';if(message==='Invalid preview request')return reply.code(400).send({error:'Use a prompt and valid inclusive date window'});if(message==='Project not found')return reply.code(404).send({error:'Project not found'});return reply.code(502).send({error:'Hermes could not return valid task suggestions. Your prompt is retained.'})}
    })
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
