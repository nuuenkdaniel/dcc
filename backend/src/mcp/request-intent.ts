// Pure request policy/reducer. NO auth, storage, runtime, transport or execution.
// Caller must commit each transition atomically BEFORE following its directive.
import {createHash} from 'node:crypto'
import {TOOLS,isTool,plainRecord,isCreation,type ToolName,type Command,type Result} from './contracts.js'
import {validateServiceArguments,validServiceResult} from './service-contracts.js'
import type {Context} from './dispatcher.js'

export const REQUEST_INTENT_KIND='dcc-request-intent-v1'
export const REQUEST_LIMITS=Object.freeze({maxRounds:4,maxCalls:12,maxWrites:4,timeoutMs:120000})
type Executor='legacy-parser-v1'|'mcp-action-v1'
export type IntentPolicy={executor:Executor;allowedTools:readonly ToolName[]}
export type IntentAdmission={actorId:string;purpose:Context['purpose'];key:string;prompt:string;tabId?:string}
type LegacyEvidence={promptHash:string;completed:boolean;mcpIntentId?:string}
type Call={id:string;fingerprint:string;command:Command;result?:Result}
export type IntentRecord={
  version:1;id:string;legacyReceiptId:string;actorHash:string;key:string;promptHash:string
  executor:Executor;allowedTools:ToolName[];phase:'admitted'|'active'|'uncertain'|'completed'
  rounds:number;calls:Call[];startedAt?:number
  ownerId?:string // Backend execution fence/correlation, never model authority.
  browserTabId?:string
  outcome?:'legacy_receipt'|'no_effects_recorded'|'effects_recorded'|'partial'|'rejected'
}
export type IntentPolicyCode='forbidden'|'invalid_arguments'|'intent_conflict'|'executor_conflict'|'inactive'|'budget_exhausted'|'call_mismatch'|'pending_operation'|'invalid_result'|'result_mismatch'|'unsupported_recurrence'|'unsupported_linkage'
type Denied={ok:false;code:IntentPolicyCode}
export type IntentDecision={ok:true;record:IntentRecord;directive:'new'|'existing'|'start_model'|'start_legacy'|'receipts_only'|'round'|'dispatch'|'replay'|'reconcile'|'recorded'|'finished';command?:Command;result?:Result}|Denied
type Decision=IntentDecision
const deny=(code:IntentPolicyCode):Denied=>({ok:false,code})
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
function uuid(value:string){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export function intentAddress(key:string){
  if(typeof key!=='string'||!/^\w[\w-]{15,79}$(?![\s\S])/.test(key))throw Error('Invalid intent key')
  return {id:uuid('dcc-request-intent-v1:'+key),legacyReceiptId:uuid('tell-receipt:'+key)}
}
const copy=(record:IntentRecord)=>structuredClone(record)
const decision=(record:IntentRecord,directive:Extract<Decision,{ok:true}>['directive']):Decision=>({ok:true,record,directive})
const timely=(r:IntentRecord,now:number)=>Number.isSafeInteger(now)&&r.startedAt!==undefined&&now>=r.startedAt&&now-r.startedAt<REQUEST_LIMITS.timeoutMs

// Admission is called only after the existing browser Origin/session hook. The
// actor, purpose, executor and tool policy come from the backend, NOT request JSON.
// DCC has one shared account; key namespace matches legacy global intent keys.
export function admitIntent(prior:IntentRecord|undefined,request:IntentAdmission,policy:IntentPolicy,legacy?:LegacyEvidence):Decision {
  if(request.tabId!==undefined&&!/^[a-f0-9-]{36}$/.test(request.tabId))return deny('invalid_arguments')
  if(request.purpose!=='action')return deny('forbidden')
  if(typeof request.actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$(?![\s\S])/.test(request.actorId)||typeof request.key!=='string'||!/^\w[\w-]{15,79}$(?![\s\S])/.test(request.key)||typeof request.prompt!=='string'||!request.prompt.trim()||request.prompt.length>4000)return deny('invalid_arguments')
  if(!['legacy-parser-v1','mcp-action-v1'].includes(policy.executor)||!Array.isArray(policy.allowedTools)||policy.allowedTools.length>Object.keys(TOOLS).length||!policy.allowedTools.every(isTool)||new Set(policy.allowedTools).size!==policy.allowedTools.length)return deny('invalid_arguments')
  const promptHash=hash(request.prompt),actorHash=hash(request.actorId)
  const {id,legacyReceiptId}=intentAddress(request.key)
  // Exact same ID formula as tell-hermes.ts, to let its existing receipt fence
  // migration/racing admission. The storage adapter must inspect BOTH records.
  if(legacy&&legacy.promptHash!==promptHash)return deny('intent_conflict')
  if(prior){
    if(prior.browserTabId!==request.tabId)return deny('intent_conflict')
    if(prior.version!==1||prior.id!==id||prior.legacyReceiptId!==legacyReceiptId||prior.key!==request.key||prior.actorHash!==actorHash||prior.promptHash!==promptHash||!['legacy-parser-v1','mcp-action-v1'].includes(prior.executor)||!['admitted','active','uncertain','completed'].includes(prior.phase))return deny('intent_conflict')
    if(legacy&&(legacy.mcpIntentId?legacy.mcpIntentId!==id||prior.executor!=='mcp-action-v1':prior.executor!=='legacy-parser-v1'))return deny('executor_conflict')
    if(prior.executor==='legacy-parser-v1'&&legacy?.completed)return decision({...copy(prior),phase:'completed',outcome:'legacy_receipt'},'existing')
    return decision(copy(prior),'existing') // Never upgrade policy or change owner on retry.
  }
  if(legacy?.mcpIntentId)return deny('executor_conflict') // Orphan fence: do not re-plan lost state.
  const executor=legacy?'legacy-parser-v1':policy.executor
  const record:IntentRecord={version:1,id,legacyReceiptId,actorHash,key:request.key,promptHash,executor,allowedTools:executor==='mcp-action-v1'?[...policy.allowedTools]:[],phase:legacy?.completed?'completed':'admitted',rounds:0,calls:[],...(request.tabId?{browserTabId:request.tabId}:{})}
  if(legacy?.completed)record.outcome='legacy_receipt'
  return decision(record,'new')
}
// Existing Tell Hermes checks fingerprint and returns result BEFORE parsing or
// executing. Atomically insert this sentinel with a new MCP intent, under the
// legacy receipt lock; never overwrite a real legacy receipt. This also fences
// an older API process that has not learned the new selector yet.
export function legacyFenceForIntent(record:IntentRecord){
  if(record.executor!=='mcp-action-v1')throw Error('Legacy intents cannot be MCP-fenced')
  return {id:record.legacyReceiptId,fingerprint:record.promptHash,command:{action:'rejected' as const},targetId:uuid('tell-target:'+record.key),result:{code:409,message:'This request is owned by the MCP executor. Retry the same authenticated submission for its receipt.'},_dccIntent:{version:1,executor:'mcp-action-v1',intentId:record.id}}
}
export function legacyReceiptEvidence(data:unknown):{ok:true;evidence:LegacyEvidence}|Denied {
  if(!plainRecord(data)||typeof data.fingerprint!=='string'||!/^[a-f0-9]{64}$(?![\s\S])/.test(data.fingerprint))return deny('intent_conflict')
  const evidence:LegacyEvidence={promptHash:data.fingerprint,completed:!!data.result}
  if(Object.hasOwn(data,'_dccIntent')){
    const marker=data._dccIntent
    if(!plainRecord(marker)||marker.version!==1||marker.executor!=='mcp-action-v1'||typeof marker.intentId!=='string'||!/^[a-f0-9-]{36}$(?![\s\S])/.test(marker.intentId))return deny('executor_conflict')
    evidence.mcpIntentId=marker.intentId
  }
  return {ok:true,evidence}
}
export function startIntent(record:IntentRecord,now:number):Decision {
  if(record.phase!=='admitted')return decision(copy(record),'receipts_only')
  if(!Number.isSafeInteger(now)||now<0)return deny('invalid_arguments')
  return decision({...copy(record),phase:'active',startedAt:now},record.executor==='mcp-action-v1'?'start_model':'start_legacy')
}
export function beginIntentRound(record:IntentRecord,now:number):Decision {
  if(record.executor!=='mcp-action-v1'||record.phase!=='active')return deny('inactive')
  if(!timely(record,now)||record.rounds>=REQUEST_LIMITS.maxRounds)return deny('budget_exhausted')
  return decision({...copy(record),rounds:record.rounds+1},'round')
}

// Model/runtime proposes tool + domain fields, not authority or keys. Native call
// IDs are correlation only; a durable transcript must preserve them on recovery.
// First validated use binds the payload; it is NOT a human preapproval step.
export function reserveIntentCall(record:IntentRecord,callId:string,tool:unknown,input:unknown,now:number):Decision {
  if(record.executor!=='mcp-action-v1'||!isTool(tool)||!record.allowedTools.includes(tool))return deny('forbidden')
  if(typeof callId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$(?![\s\S])/.test(callId)||!plainRecord(input))return deny('invalid_arguments')
  const args={...input},writing=TOOLS[tool].write
  const creating=isCreation(tool)
  if(writing){
    if(Object.hasOwn(args,'operationKey')||creating&&Object.hasOwn(args,'id'))return deny('invalid_arguments')
    args.operationKey='dcc_op_'+uuid('dcc-request-operation-v1:'+record.id+'\0'+callId)
    if(creating)args.id=uuid('dcc-request-target-v1:'+record.id+'\0'+callId)
    if(tool==='create_task'&&typeof args.templateId==='string'&&typeof args.sourceDate==='string')args.id=`occ.${args.templateId}.${args.sourceDate}`
  }
  const validation=validateServiceArguments(tool,args)
  if(!validation.valid)return deny(validation.code)
  const command:Command={tool,args:validation.args},fingerprint=hash(canonical(command))
  const old=record.calls.find(call=>call.id===callId)
  if(old){
    if(old.fingerprint!==fingerprint||hash(canonical(old.command))!==old.fingerprint)return deny('call_mismatch')
    const next=copy(record),frozen=structuredClone(old.command)
    if(old.result&&old.result.state!=='uncertain')return {ok:true,record:next,directive:'replay',command:frozen,result:structuredClone(old.result)}
    return {ok:true,record:next,directive:'reconcile',command:frozen}
  }
  if(record.phase!=='active')return deny('inactive')
  if(!timely(record,now)||record.rounds<1||record.calls.length>=REQUEST_LIMITS.maxCalls||writing&&record.calls.filter(call=>TOOLS[call.command.tool].write).length>=REQUEST_LIMITS.maxWrites)return deny('budget_exhausted')
  if(record.calls.some(call=>TOOLS[call.command.tool].write&&(!call.result||call.result.state==='uncertain')))return deny('pending_operation')
  // Once asking a question, do not guess and write later in the same invocation.
  const questions=record.calls.filter(call=>call.command.tool==='request_clarification')
  if(writing&&questions.length)return deny('pending_operation')
  if(tool==='request_clarification'&&(questions.length>=3||questions.some(call=>call.command.args.reason===command.args.reason)))return deny('invalid_arguments')
  if(tool==='get_operation_status'&&!record.calls.some(call=>TOOLS[call.command.tool].write&&call.command.args.operationKey===command.args.operationKey))return deny('forbidden')
  const next=copy(record);next.calls.push({id:callId,fingerprint,command})
  return {ok:true,record:next,directive:'dispatch',command:structuredClone(command)}
}
// Accept ONLY Dispatcher/service-ledger results, never bridge/model final JSON.
// Validation is structural, not a proof that a result came from the backend.
export function recordIntentResult(record:IntentRecord,callId:string,result:Result):Decision {
  const old=record.calls.find(call=>call.id===callId)
  if(record.executor!=='mcp-action-v1'||!old)return deny('invalid_arguments')
  if(hash(canonical(old.command))!==old.fingerprint)return deny('call_mismatch')
  if(!validServiceResult(old.command,result))return deny('invalid_result')
  if(old.result&&old.result.state!=='uncertain')return canonical(old.result)===canonical(result)?decision(copy(record),'recorded'):deny('result_mismatch')
  const next=copy(record),call=next.calls.find(item=>item.id===callId)!
  call.result=structuredClone(result)
  if(result.state==='uncertain')next.phase='uncertain'
  return decision(next,'recorded')
}
export function interruptIntent(record:IntentRecord):IntentRecord {
  return record.phase==='active'?{...copy(record),phase:'uncertain'}:copy(record)
}
export function finishIntent(record:IntentRecord):Decision {
  if(record.executor!=='mcp-action-v1'||record.phase==='admitted')return deny('inactive')
  const next=copy(record),writes=next.calls.filter(call=>TOOLS[call.command.tool].write)
  if(next.calls.some(call=>!call.result||call.result.state==='uncertain')){next.phase='uncertain';delete next.outcome;return decision(next,'finished')}
  const effected=writes.filter(call=>call.result?.state==='applied'||call.result?.state==='saved').length
  next.phase='completed'
  next.outcome=writes.length===0?'no_effects_recorded':effected===writes.length?'effects_recorded':effected>0?'partial':'rejected'
  // effects_recorded says nothing about fulfillment of unexecuted natural-language
  // goals; saved calendar receipts still require snapshot confirmation in the UI.
  return decision(next,'finished')
}
// Not standalone authority: use only AFTER the journal gate for a bound command
// (including receipt reconciliation), never as a profile-wide model context.
export function requestContext(record:IntentRecord):Context {
  return record.executor==='mcp-action-v1'&&(record.phase==='active'||record.phase==='uncertain')?{purpose:'action',capabilities:[...new Set(record.allowedTools.map(tool=>TOOLS[tool].capability))],...(record.browserTabId?{browserTabId:record.browserTabId,invocationKey:record.key}:{})}:{purpose:'read',capabilities:[]}
}
