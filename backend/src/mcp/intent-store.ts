import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {TOOLS,isTool,plainRecord,isCreation,type Result} from './contracts.js'
import {canonicalJson} from './service-transport.js'
import {validateServiceArguments,validServiceResult} from './service-contracts.js'
import {REQUEST_INTENT_KIND,REQUEST_LIMITS,intentAddress,admitIntent,legacyReceiptEvidence,legacyFenceForIntent,startIntent,beginIntentRound,reserveIntentCall,recordIntentResult,interruptIntent,finishIntent,type IntentRecord,type IntentPolicy,type IntentDecision,type ConversationGuard} from './request-intent.js'
import {validGuard} from './conversation-validation.js'

type Row={id:string;kind:string;version:number;data:unknown}
export class IntentStoreError extends Error {
  constructor(readonly code:string){super(code)}
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const fail=(code:string):never=>{throw new IntentStoreError(code)}
export function requireIntent(decision:IntentDecision):Extract<IntentDecision,{ok:true}>{
  if(!decision.ok)return fail(decision.code)
  return decision
}
// Reject unknown journal versions and corrupt persisted commands before deriving
// any execution authority from them. No model text is stored in this journal.
function decode(row:Row,key:string,actorHash:string):IntentRecord {
  const d=row.data,{id,legacyReceiptId}=intentAddress(key)
  if(row.kind!==REQUEST_INTENT_KIND||row.id!==id||!Number.isSafeInteger(row.version)||row.version<1||!plainRecord(d))return fail('intent_conflict')
  const r=d as unknown as IntentRecord
  if(r.guard!==undefined&&!validGuard(r.guard))return fail('intent_conflict')
  if(r.browserTabId!==undefined&&(typeof r.browserTabId!=='string'||!/^[a-f0-9-]{36}$/.test(r.browserTabId)))return fail('intent_conflict')
  if(r.version!==1||r.id!==id||r.legacyReceiptId!==legacyReceiptId||r.key!==key||r.actorHash!==actorHash||typeof r.promptHash!=='string'||!/^[a-f0-9]{64}$/.test(r.promptHash)||!['legacy-parser-v1','mcp-action-v1'].includes(r.executor)||!['admitted','active','uncertain','completed'].includes(r.phase)||!Array.isArray(r.allowedTools)||r.allowedTools.length>Object.keys(TOOLS).length||!r.allowedTools.every(isTool)||new Set(r.allowedTools).size!==r.allowedTools.length||!Number.isInteger(r.rounds)||r.rounds<0||r.rounds>REQUEST_LIMITS.maxRounds||!Array.isArray(r.calls)||r.calls.length>REQUEST_LIMITS.maxCalls)return fail('intent_conflict')
  if(r.startedAt!==undefined&&(!Number.isSafeInteger(r.startedAt)||r.startedAt<0)||r.ownerId!==undefined&&(typeof r.ownerId!=='string'||!r.ownerId)||r.phase==='active'&&(r.startedAt===undefined||!r.ownerId))return fail('intent_conflict')
  if(r.outcome!==undefined&&!['legacy_receipt','no_effects_recorded','effects_recorded','partial','rejected'].includes(r.outcome)||r.phase==='admitted'&&(r.calls.length||r.rounds||r.startedAt!==undefined||r.ownerId!==undefined))return fail('intent_conflict')
  if(r.phase!=='completed'&&r.outcome!==undefined||r.calls.length&&r.rounds<1||r.executor==='mcp-action-v1'&&r.phase!=='admitted'&&(r.startedAt===undefined||!r.ownerId))return fail('intent_conflict')
  if(r.executor==='legacy-parser-v1'&&(r.calls.length||r.allowedTools.length))return fail('intent_conflict')
  const ids=new Set<string>();let writes=0
  for(const call of r.calls){
    if(!plainRecord(call)||typeof call.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(call.id)||ids.has(call.id)||!plainRecord(call.command)||!isTool(call.command.tool)||!r.allowedTools.includes(call.command.tool)||!plainRecord(call.command.args))return fail('intent_conflict')
    ids.add(call.id)
    const validation=validateServiceArguments(call.command.tool,call.command.args,true)
    if(!validation.valid||call.fingerprint!==hash(canonicalJson(call.command))||call.result!==undefined&&!validServiceResult(call.command,call.result,true))return fail('intent_conflict')
    // Re-run host key/target derivation, not only schema validation.
    const input={...call.command.args}
    if(TOOLS[call.command.tool].write){writes++;delete input.operationKey;if(isCreation(call.command.tool))delete input.id}
    const replay=reserveIntentCall(r,call.id,call.command.tool,input,r.startedAt??0)
    if(!replay.ok)return fail('intent_conflict')
  }
  if(writes>REQUEST_LIMITS.maxWrites)return fail('intent_conflict')
  if(r.phase==='completed'){
    if(r.executor==='legacy-parser-v1'){
      if(r.outcome!=='legacy_receipt')return fail('intent_conflict')
    }else{
      const finished=finishIntent(r)
      if(!finished.ok||canonicalJson(finished.record)!==canonicalJson(r))return fail('intent_conflict')
    }
  }
  return structuredClone(r)
}

// Each transaction: legacy advisory lock -> legacy row -> intent row. Never keep
// this connection across model/SDK/service work. All stores use this same order.
export class SqlIntentStore {
  readonly actorScope:string
  constructor(private readonly pool:Pool,private readonly actorId:string){
    if(typeof actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$(?![\s\S])/.test(actorId))fail('invalid_arguments')
    this.actorScope=hash(actorId)
  }
  private async transaction<T>(key:string,work:(c:PoolClient,row:Row|undefined,legacy:Row|undefined)=>Promise<T>):Promise<T>{
    const address=intentAddress(key)
    let c:PoolClient
    try{c=await this.pool.connect()}catch{return fail('storage_failure')}
    let destroy=false
    try{
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817343))',[address.legacyReceiptId])
      const legacy=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[address.legacyReceiptId])).rows[0]
      const row=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[address.id])).rows[0]
      const result=await work(c,row,legacy)
      await c.query('COMMIT')
      return result
    }catch(error){
      try{await c.query('ROLLBACK')}catch{destroy=true}
      if(error instanceof IntentStoreError)throw error
      throw new IntentStoreError('storage_failure') // Includes ambiguous commit ACK.
    }finally{c.release(destroy)}
  }
  private evidence(legacy:Row|undefined){
    if(!legacy)return undefined
    if(legacy.kind!=='hermes-command')return fail('executor_conflict')
    const evidence=legacyReceiptEvidence(legacy.data)
    if(!evidence.ok)return fail(evidence.code)
    return evidence.evidence
  }
  private load(row:Row|undefined,legacy:Row|undefined,key:string){
    if(!row)return fail('intent_conflict')
    const r=decode(row,key,this.actorScope),e=this.evidence(legacy)
    if(r.executor==='mcp-action-v1'&&(!e||e.mcpIntentId!==r.id||e.promptHash!==r.promptHash)||r.executor==='legacy-parser-v1'&&e?.mcpIntentId)return fail('executor_conflict')
    if(r.executor==='mcp-action-v1'&&canonicalJson(legacy!.data)!==canonicalJson(legacyFenceForIntent(r)))return fail('executor_conflict')
    if(e&&e.promptHash!==r.promptHash)return fail('intent_conflict')
    return r
  }
  private async insert(c:PoolClient,id:string,kind:string,data:unknown){
    const result=await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[id,kind,data])
    if(result.rowCount!==1)fail('storage_conflict')
  }
  private async save(c:PoolClient,row:Row,record:IntentRecord){
    if(canonicalJson(row.data)===canonicalJson(record))return
    const result=await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1 AND kind=$3 AND version=$4 RETURNING version',[row.id,record,REQUEST_INTENT_KIND,row.version])
    if(result.rowCount!==1)fail('storage_conflict')
  }
  async admit(input:{key:string;prompt:string;purpose:'action';tabId?:string;guard?:ConversationGuard},policy:IntentPolicy):Promise<IntentRecord>{
    // Validate admission BEFORE opening a connection.
    requireIntent(admitIntent(undefined,{...input,actorId:this.actorId},policy))
    return this.transaction(input.key,async(c,row,legacy)=>{
      const prior=row?this.load(row,legacy,input.key):undefined
      const decision=requireIntent(admitIntent(prior,{...input,actorId:this.actorId},policy,this.evidence(legacy)))
      if(!row){
        await this.insert(c,decision.record.id,REQUEST_INTENT_KIND,decision.record)
        if(decision.record.executor==='mcp-action-v1')await this.insert(c,decision.record.legacyReceiptId,'hermes-command',legacyFenceForIntent(decision.record))
      }else await this.save(c,row,decision.record)
      return decision.record
    })
  }
  async read(key:string){return this.transaction(key,async(_c,row,legacy)=>this.load(row,legacy,key))}
  // Guarded conversation supersession only: caller already owns the slot/root
  // transaction. Reuse that connection, retaining the legacy -> journal order.
  // No checkout or transaction lifecycle here; the caller commits or rolls back.
  async readInTransaction(c:PoolClient,key:string){
    const address=intentAddress(key)
    try{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817343))',[address.legacyReceiptId])
      const legacy=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[address.legacyReceiptId])).rows[0]
      const row=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[address.id])).rows[0]
      return this.load(row,legacy,key)
    }catch(error){if(error instanceof IntentStoreError)throw error;throw new IntentStoreError('storage_failure')}
  }
  private async change(key:string,transition:(r:IntentRecord)=>IntentDecision){
    return this.transaction(key,async(c,row,legacy)=>{
      const next=requireIntent(transition(this.load(row,legacy,key)))
      await this.save(c,row!,next.record)
      return next
    })
  }
  async start(key:string,now:number){
    const next=await this.change(key,r=>{
      const d=requireIntent(startIntent(r,now))
      if(d.directive==='start_model'||d.directive==='start_legacy')d.record.ownerId=randomUUID()
      return d
    })
    return {...next,owner:next.directive==='start_model'||next.directive==='start_legacy'?next.record.ownerId:undefined}
  }
  private owned(r:IntentRecord,owner:string){if(!owner||r.ownerId!==owner)fail('forbidden');return r}
  round(key:string,owner:string,now:number){return this.change(key,r=>beginIntentRound(this.owned(r,owner),now))}
  reserve(key:string,owner:string,id:string,tool:unknown,args:unknown,now:number){return this.change(key,r=>reserveIntentCall(this.owned(r,owner),id,tool,args,now))}
  result(key:string,owner:string,id:string,result:Result){return this.change(key,r=>recordIntentResult(this.owned(r,owner),id,result))}
  interrupt(key:string){return this.change(key,r=>({ok:true,record:interruptIntent(r),directive:'receipts_only'}))}
  fence(key:string,now:number){return this.change(key,r=>{
    if(r.phase==='admitted'){
      const next=requireIntent(startIntent(r,now));next.record.ownerId=randomUUID()
      return {ok:true,record:interruptIntent(next.record),directive:'receipts_only'}
    }
    return {ok:true,record:interruptIntent(r),directive:'receipts_only'}
  })}
  finish(key:string,owner:string){return this.change(key,r=>{
    this.owned(r,owner)
    if(r.phase!=='active')return fail('inactive')
    return finishIntent(r)
  })}
  // Recovery accepts only backend-reconciled frozen-call results, never new calls.
  recovered(key:string,id:string,result:Result){return this.change(key,r=>{
    if(r.phase!=='uncertain')return fail('inactive')
    const call=r.calls.find(c=>c.id===id)
    if(!call||!TOOLS[call.command.tool].write)return fail('forbidden')
    return recordIntentResult(r,id,result)
  })}
}
