import {createHash,randomBytes} from 'node:crypto'
import type {Pool} from 'pg'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {JSONRPCMessageSchema,type JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js'
import {ACTIVE_TOOLS,plainRecord,type ToolName} from './contracts.js'
import {canonicalJson,ServiceTransport,type ServiceOptions} from './service-transport.js'
import {SqlIntentStore} from './intent-store.js'
import {RequestController,type NativeMcpRun} from './request-controller.js'
import {BrowserTimerBridge} from './browser-timer.js'
import {Conversations,expireConversationText,type ConversationInput} from './conversation.js'
import {validRuntimeCompletion} from './assistant-reply.js'

export const TASK_ACTION_PATH='/api/v1/hermes/task-actions'
export const ACTION_PATH='/api/v1/hermes/actions'
export const TASK_CALLBACK_PATH='/api/v1/hermes/mcp-task-callback'
export const TASK_CALLBACK_URL='https://dcc.home.captnuu.online'+TASK_CALLBACK_PATH
const policy={executor:'mcp-action-v1' as const,allowedTools:['list_tasks','create_task','set_task_completed'] as const}
export const PRODUCT_TOOLS=ACTIVE_TOOLS
const productPolicy={executor:'mcp-action-v1' as const,allowedTools:PRODUCT_TOOLS}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
export class TaskCallbackError extends Error {constructor(readonly status:number){super('Task callback unavailable')}}
export type TaskBridgeInput={mode:'task-action'|'product-action';prompt:string;callbackCapability:string;expiresAt:number;replyVersion?:1;chatVersion?:1}
export type TaskBridge=(input:TaskBridgeInput,signal:AbortSignal)=>Promise<unknown>
export const TASK_ACCOUNT_ACTOR='dcc-account'
// Called once at API construction, never from request JSON or per request.
export function configuredTaskActions(options:{enabled:boolean;pool:Pool|null;authConfigured:boolean;bridgeConfigured:boolean;bridge:TaskBridge;calendarSnapshot?:ServiceOptions['calendarSnapshot'];guardedCalendarWriter?:ServiceOptions['guardedCalendarWriter']}){
  if(!options.enabled)return undefined
  if(!options.pool||!options.authConfigured||!options.bridgeConfigured)throw new Error('Task actions require database, authentication and curator bridge configuration')
  return new TaskActions({pool:options.pool,actorId:TASK_ACCOUNT_ACTOR,bridge:options.bridge,calendarSnapshot:options.calendarSnapshot,guardedCalendarWriter:options.guardedCalendarWriter})
}

// A narrow stdio-over-POST relay, not a general HTTP API or resumable MCP HTTP
// session. The official SDK owns MCP parsing/dispatch. One capability = one
// initialization, one owner, one subprocess, no reinitialization on resume.
class CallbackSession {
  private wire:InMemoryTransport
  private pending=new Map<string,{resolve:(message:JSONRPCMessage)=>void;reject:(error:Error)=>void}>()
  private seen=new Map<string,{fingerprint:string;response:Promise<JSONRPCMessage|undefined>}>()
  private init=false
  private ready=false
  private count=0
  private closed=false
  private queue:Promise<unknown>=Promise.resolve()
  constructor(private readonly run:NativeMcpRun){
    const [wire,serverWire]=InMemoryTransport.createLinkedPair();this.wire=wire
    wire.onmessage=message=>{
      if('id' in message&&!('method' in message)){
        const key=canonicalJson([typeof message.id,message.id]),waiting=this.pending.get(key)
        if(waiting){this.pending.delete(key);waiting.resolve(message)}
      }
    }
    this.connected=run.server.connect(serverWire).then(()=>wire.start())
  }
  private connected:Promise<void>
  async message(body:unknown):Promise<JSONRPCMessage|undefined>{
    if(this.closed||++this.count>64||!(await this.run.active()))throw new TaskCallbackError(403)
    const parsed=JSONRPCMessageSchema.safeParse(body)
    if(!parsed.success||!plainRecord(body)||!('method' in parsed.data))throw new TaskCallbackError(400)
    const message=parsed.data
    if(!['initialize','notifications/initialized','tools/list','tools/call','ping'].includes(message.method))throw new TaskCallbackError(403)
    if(!('id' in message)){
      if(message.method!=='notifications/initialized'||!this.init||this.ready)throw new TaskCallbackError(409)
      this.ready=true;await this.connected;await this.wire.send(message);return undefined
    }
    if(typeof message.id!=='string'&&typeof message.id!=='number')throw new TaskCallbackError(400)
    const key=canonicalJson([typeof message.id,message.id]),fingerprint=canonicalJson(body),old=this.seen.get(key)
    if(old){if(old.fingerprint!==fingerprint)throw new TaskCallbackError(409);return old.response}
    if(message.method==='initialize'){
      if(this.init)throw new TaskCallbackError(409)
      this.init=true
    }else if(!this.ready)throw new TaskCallbackError(409)
    if(message.method==='tools/call'){
      if(!plainRecord(message.params)||!this.run.allowedTools.includes(message.params.name as ToolName))throw new TaskCallbackError(403)
      // Never accept authority or correlation from model _meta. Stable owner +
      // typed JSON-RPC ID is bound durably by store.reserve before any service call.
      message.params={...message.params,_meta:{hostCallId:this.run.correlate(message.id)}}
    }
    const response=this.queue.then(async()=>{
      if(this.closed||!(await this.run.active()))throw new TaskCallbackError(403)
      await this.connected
      return new Promise<JSONRPCMessage>((resolve,reject)=>{
        this.pending.set(key,{resolve,reject})
        void this.wire.send(message).catch(()=>{this.pending.delete(key);reject(new TaskCallbackError(502))})
      })
    })
    this.queue=response.catch(()=>undefined)
    this.seen.set(key,{fingerprint,response})
    return response
  }
  async close(){
    if(this.closed)return
    this.closed=true
    for(const waiting of this.pending.values())waiting.reject(new TaskCallbackError(403))
    this.pending.clear();this.seen.clear();await this.wire.close()
  }
}

export class TaskActions {
  private readonly timerBridge=new BrowserTimerBridge()
  private readonly entries=new Map<string,{expiresAt:number;session:CallbackSession;active:()=>Promise<boolean>}>()
  private readonly controller:RequestController
  private readonly conversations:Conversations
  private readonly pool:Pool
  private readonly now:()=>number
  constructor(options:{pool:Pool;actorId:string;bridge:TaskBridge;now?:()=>number;issueCapability?:()=>string;calendarSnapshot?:ServiceOptions['calendarSnapshot'];guardedCalendarWriter?:ServiceOptions['guardedCalendarWriter']}){
    this.now=options.now??Date.now
    this.pool=options.pool
    const store=new SqlIntentStore(options.pool,options.actorId),transport=new ServiceTransport({pool:options.pool,actorId:options.actorId,browserTimer:this.timerBridge,...(options.calendarSnapshot?{calendarSnapshot:options.calendarSnapshot}:{}),...(options.guardedCalendarWriter?{guardedCalendarWriter:options.guardedCalendarWriter}:{})})
    this.controller=new RequestController({store,transport,now:this.now,
      nativeRunner:async run=>{
        if(this.entries.size>=8)throw new TaskCallbackError(429)
        // Generated only at invocation time, after authenticated admission/start.
        const token=(options.issueCapability??(()=>randomBytes(32).toString('hex')))()
        if(!/^[a-f0-9]{64}$(?![\s\S])/.test(token))throw new TaskCallbackError(503)
        const key=digest(token)
        if(this.entries.has(key))throw new TaskCallbackError(503)
        const session=new CallbackSession(run)
        this.entries.set(key,{expiresAt:run.expiresAt,session,active:run.active})
        const revoke=()=>{this.entries.delete(key);void session.close().catch(()=>undefined)}
        run.signal.addEventListener('abort',revoke,{once:true})
        try{
          if(run.signal.aborted)throw new TaskCallbackError(403)
          const result=await options.bridge({mode:run.allowedTools.length===policy.allowedTools.length?'task-action':'product-action',prompt:run.prompt,callbackCapability:token,expiresAt:run.expiresAt,...(run.replyVersion===1?{replyVersion:1 as const}:{}),...(run.chatVersion===1?{chatVersion:1 as const}:{})},run.signal)
          if(run.replyVersion===1){
            if(!validRuntimeCompletion(result)||result.assistantText?.includes(token))throw new TaskCallbackError(502)
            return result
          }
          if(!plainRecord(result)||Object.keys(result).join(',')!=='status'||result.status!=='finished')throw new TaskCallbackError(502)
        }finally{
          run.signal.removeEventListener('abort',revoke);revoke();await session.close()
        }
      }})
    const chatPolicy={...productPolicy,allowedTools:PRODUCT_TOOLS.filter(tool=>tool!=='request_clarification')}
    this.conversations=new Conversations({pool:options.pool,store,transport,now:this.now,run:(input,signal)=>this.controller.run(input,input.chatVersion===1?chatPolicy:productPolicy,signal),fence:(input,client)=>store.fenceInTransaction(client,input,input.guard.chatVersion===1?chatPolicy:productPolicy,this.now())})
  }
  run(input:{key:string;prompt:string},signal?:AbortSignal){return this.controller.run(input,policy,signal)}
  runProduct(input:{key:string;prompt:string;tabId?:string},signal?:AbortSignal){return this.controller.run(input,productPolicy,signal)}
  converse(input:ConversationInput,owner:string,signal?:AbortSignal,displaySync=false){return this.conversations.handle(input,owner,signal,displaySync)}
  expireConversationText(){return expireConversationText(this.pool,this.now())}
  pollTimer(key:string,tabId:string){return this.timerBridge.poll(key,tabId)}
  ackTimer(key:string,tabId:string,ack:unknown){return this.timerBridge.ack(key,tabId,ack)}
  private async entry(authorization:unknown){
    if(typeof authorization!=='string'||!/^Bearer [a-f0-9]{64}$(?![\s\S])/.test(authorization))return undefined
    const key=digest(authorization.slice(7)),entry=this.entries.get(key)
    if(!entry)return undefined
    if(this.now()>=entry.expiresAt){this.entries.delete(key);await entry.session.close();return undefined}
    try{if(!(await entry.active()))return undefined}catch{return undefined}
    return entry
  }
  async verifyCallback(authorization:unknown){try{return !!(await this.entry(authorization))}catch{return false}}
  async callback(authorization:unknown,body:unknown){
    const entry=await this.entry(authorization)
    if(!entry)throw new TaskCallbackError(403)
    return entry.session.message(body)
  }
}
