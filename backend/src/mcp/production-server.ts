import {createHash} from 'node:crypto'
import {TOOLS,isTool,plainRecord,type ToolName,type Result} from './contracts.js'
import {Dispatcher,type Context} from './dispatcher.js'
import {ServiceTransport,canonicalJson} from './service-transport.js'
import {serviceToolDefinitions,validateServiceArguments} from './service-contracts.js'
import {composeSdkServer} from './sdk-server.js'

// Optional low-level exact-payload mode, NOT the required in-app action UX.
// Authenticated-request planning is designed separately in request-intent.ts.
export type ApprovedServiceAction={tool:ToolName;arguments:unknown}
// A trusted invoking application supplies these AFTER authenticating/authorizing
// the actor and selecting the sole executor. This structure is NOT a credential,
// a signed grant format, or a client-facing API. Never build it from tool/_meta.
export type TrustedServiceInvocation={
  id:string
  expiresAt:number
  allowedTools:ToolName[]
  actions?:ApprovedServiceAction[]
  statusKeys?:string[]
}
export const MAX_INVOCATION_MS=5*60*1000
type Options={transport:ServiceTransport;context:Context;invocation:TrustedServiceInvocation;now?:()=>number}
const denied=():Result=>({state:'rejected',code:'forbidden'})
const fingerprint=(tool:ToolName,args:unknown)=>createHash('sha256').update(canonicalJson({tool,args})).digest('hex')
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$(?![\s\S])/.test(value)

export function createServiceMcpServer(options:Options){
  if(!(options.transport instanceof ServiceTransport))throw Error('Injected DCC ServiceTransport required')
  const clock=options.now??Date.now,issuedAt=clock(),invocation=options.invocation
  if(!Number.isSafeInteger(issuedAt)||!plainRecord(invocation)||!opaque(invocation.id)||!Number.isSafeInteger(invocation.expiresAt)||invocation.expiresAt<=issuedAt||invocation.expiresAt-issuedAt>MAX_INVOCATION_MS)throw Error('Invalid trusted invocation lifetime')
  if(!options.context)throw Error('Explicit trusted context required')
  const purpose=options.context.purpose,capabilities=options.context.capabilities
  const knownCapabilities=new Set(Object.values(TOOLS).map(tool=>tool.capability))
  if(!['action','parser','planner','extraction','read'].includes(purpose)||!Array.isArray(capabilities)||capabilities.length>knownCapabilities.size||!capabilities.every(capability=>typeof capability==='string'&&knownCapabilities.has(capability)))throw Error('Explicit trusted context required')
  const context:Context=Object.freeze({purpose,capabilities:Object.freeze([...capabilities])})
  if(!Array.isArray(invocation.allowedTools)||invocation.allowedTools.length>Object.keys(TOOLS).length||!invocation.allowedTools.every(isTool)||new Set(invocation.allowedTools).size!==invocation.allowedTools.length)throw Error('Invalid invocation tool allowlist')
  const allowed=new Set(invocation.allowedTools),expiresAt=invocation.expiresAt
  const actions=invocation.actions??[],statusKeys=invocation.statusKeys??[]
  if(!Array.isArray(actions)||actions.length>16||!Array.isArray(statusKeys)||statusKeys.length>64||!statusKeys.every(opaque))throw Error('Invalid invocation grants')
  const grants=new Map<string,string>(),receiptKeys=new Set(statusKeys),actionKeys=new Set<string>(),keysByTool=new Map<ToolName,string[]>()
  for(const action of actions){
    if(!plainRecord(action)||!isTool(action.tool)||!TOOLS[action.tool].write||!allowed.has(action.tool))throw Error('Invalid approved action tool')
    const validation=validateServiceArguments(action.tool,action.arguments)
    if(!validation.valid)throw Error('Approved action must match the service contract')
    const key=String(validation.args.operationKey),slot=`${action.tool}:${key}`
    if(actionKeys.has(key))throw Error('Operation key must bind one invocation action')
    actionKeys.add(key)
    grants.set(slot,fingerprint(action.tool,validation.args));receiptKeys.add(key)
    keysByTool.set(action.tool,[...(keysByTool.get(action.tool)??[]),key])
  }
  // Capture immutable policy, not mutable caller-owned arrays/approval payloads.
  const permitted=(tool:ToolName)=>allowed.has(tool)&&context.capabilities.includes(TOOLS[tool].capability)&&(!TOOLS[tool].write||context.purpose==='action'&&keysByTool.has(tool))&&(tool!=='get_operation_status'||receiptKeys.size>0)
  const active=()=>{try{const now=clock();return Number.isSafeInteger(now)&&now>=issuedAt&&now<expiresAt}catch{return false}}
  const dispatcher=new Dispatcher(options.transport),definitions=serviceToolDefinitions()
  for(const definition of definitions){
    if(!isTool(definition.name))throw Error('Unknown service tool definition')
    const keys=definition.name==='get_operation_status'?[...receiptKeys]:keysByTool.get(definition.name)
    if(keys)Object.assign(definition.inputSchema.properties?.operationKey??{},{enum:[...keys]})
  }
  return composeSdkServer({
    name:'dcc-service-invocation',source:'dcc-service',
    instructions:'DCC SINGLE-ACCOUNT SHARED DATA. Actor identity scopes durable operation receipts, NOT task/project/calendar rows or multi-tenant data. A trusted caller supplies this short-lived invocation context and exact approved actions; client identity, arguments and metadata confer no authority. Parser/planner/extraction cannot write. Only one executor may own an intent: do not also execute a parser result. Project mutations queue planning. Calendar saved means provider saved with snapshot_pending, not a refreshed event ID/ETag. This composition is not an authentication endpoint.',
    tools:()=>active()?definitions.filter(tool=>isTool(tool.name)&&permitted(tool.name)):[],
    dispatch:async(tool,input)=>{
      if(!active()||!permitted(tool))return denied()
      const validation=validateServiceArguments(tool,input)
      if(!validation.valid)return {state:'rejected',code:validation.code}
      if(TOOLS[tool].write){
        const slot=`${tool}:${String(validation.args.operationKey)}`
        if(grants.get(slot)!==fingerprint(tool,validation.args))return denied()
      }
      if(tool==='get_operation_status'&&!receiptKeys.has(String(validation.args.operationKey)))return denied()
      return dispatcher.dispatch(tool,validation.args,context)
    },
  })
}
