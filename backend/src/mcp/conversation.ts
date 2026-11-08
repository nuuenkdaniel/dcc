import {createHash} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {plainRecord,TOOLS} from './contracts.js'
import {type Clarification,validClarification,validConversationClarification} from './clarification.js'
import {validReference,referenceAt,executionContext,type ConversationReference} from './conversation-context.js'
import {CONVERSATION_LIMITS,conversationTextFits,interpretTasks,nyDate,type Checklist} from './conversation-contract.js'
import {validActionReceipt,type ActionReceipt} from './action-receipt.js'
import {validGuard} from './conversation-validation.js'
import {SqlIntentStore,IntentStoreError} from './intent-store.js'
import {type IntentRecord,type ConversationGuard} from './request-intent.js'
import {type ServiceTransport,canonicalJson} from './service-transport.js'
import {validAssistantReply,type AssistantReply} from './assistant-reply.js'

export const CONVERSATION_PATH='/api/v1/hermes/conversation'
const KIND='dcc-hermes-conversation-v1',SLOT='dcc-hermes-client-v1'
// Fixed API-owned text maintenance, never an MCP tool or model-selected query.
// Logical expiry is exact; active API maintenance reclaims text within a minute.
// When the API is down, reclamation resumes before readiness on its next start.
const TEXT_EXPIRY_SQL="UPDATE planner_entities SET data=(data-'original'-'prompt'-'guard'-'question'-'context'-'assistantReply'-'replyUnavailable') || jsonb_build_object('answers','[]'::jsonb,'status','closed','receipt',CASE WHEN data#>>'{receipt,outcome}'='question' THEN jsonb_set(jsonb_set(data->'receipt','{outcome}','\"failed\"'::jsonb),'{line}','\"Clarification expired after 24 hours. Start a new request; nothing was resent.\"'::jsonb) ELSE data->'receipt' END),version=version+1 WHERE kind=$1 AND ($2='' OR data->>'owner'=$2) AND (data->>'expiresAt')::bigint<=$3 AND (data ? 'original' OR data ? 'assistantReply' OR data ? 'replyUnavailable')"
export async function expireConversationText(db:Pick<PoolClient,'query'>,now:number,owner=''){
  if(!Number.isSafeInteger(now)||now<0)throw new IntentStoreError('invalid_arguments')
  await db.query(TEXT_EXPIRY_SQL,[KIND,owner,now])
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
function address(s:string){const h=hash(s);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
const key=(s:unknown):s is string=>typeof s==='string'&&/^\w[\w-]{15,79}$(?![\s\S])/.test(s)
export type ConversationInput={op:'start';clientId:string;key:string;prompt:string;tabId?:string;context?:ConversationReference;replyVersion?:1}|{op:'answer';clientId:string;rootKey:string;key:string;parentKey:string;questionId:string;answer:string}|{op:'read'|'cancel';clientId:string;rootKey:string}
export type ConversationReply={version:1;rootKey:string;turnKey:string;expiresAt:number;questions:number;original?:string;question?:Clarification&{id:string};receipt:ActionReceipt;continuable?:boolean;assistantReply?:AssistantReply;replyUnavailable?:true}
type Turn={key:string;fingerprint:string}
type Pending={version:1;owner:string;clientId:string;rootKey:string;tabId?:string;createdAt:number;expiresAt:number;status:'running'|'question'|'closed';original?:string;answers:string[];questions:number;turns:Turn[];turnKey:string;prompt?:string;guard?:ConversationGuard;question?:Clarification&{id:string};receipt:ActionReceipt;context?:ConversationReference;contextual?:true;continuable?:boolean;replyVersion?:1;assistantReply?:AssistantReply;replyUnavailable?:true}
type Row={id:string;kind:string;version:number;data:unknown}
const fail=(code:string):never=>{throw new IntentStoreError(code)}
export function validConversationInput(v:unknown):v is ConversationInput{
  if(!plainRecord(v)||typeof v.clientId!=='string'||!/^[a-f0-9-]{36}$(?![\s\S])/.test(v.clientId))return false
  const exact=(keys:string[])=>Object.keys(v).sort().join(',')===keys.sort().join(',')
  if(v.op==='start')return exact(['op','clientId','key','prompt',...(v.tabId!==undefined?['tabId']:[]),...(v.context!==undefined?['context']:[]),...(v.replyVersion!==undefined?['replyVersion']:[])])&&(v.replyVersion===undefined||v.replyVersion===1)&&(v.context===undefined||validReference(v.context))&&key(v.key)&&typeof v.prompt==='string'&&!!v.prompt.trim()&&conversationTextFits([v.prompt])&&(v.tabId===undefined||typeof v.tabId==='string'&&/^[a-f0-9-]{36}$(?![\s\S])/.test(v.tabId))
  if(v.op==='answer')return exact(['op','clientId','rootKey','key','parentKey','questionId','answer'])&&key(v.rootKey)&&key(v.key)&&key(v.parentKey)&&typeof v.questionId==='string'&&/^[a-f0-9]{64}$/.test(v.questionId)&&typeof v.answer==='string'&&!!v.answer.trim()&&conversationTextFits([v.answer])
  return (v.op==='read'||v.op==='cancel')&&exact(['op','clientId','rootKey'])&&key(v.rootKey)
}
function blank(key:string,line:string,outcome:ActionReceipt['outcome']='uncertain'):ActionReceipt{return {version:1,key,outcome,line,verified:0,expected:null,targets:[]}}
export function replyOf(p:Pending):ConversationReply{return {version:1,rootKey:p.rootKey,turnKey:p.turnKey,expiresAt:p.expiresAt,questions:p.questions,...(p.original?{original:p.original}:{}),...(p.question?{question:p.question}:{}),receipt:p.receipt,...(p.contextual?{continuable:p.continuable===true}:{}),...(p.replyVersion===1&&p.assistantReply?{assistantReply:p.assistantReply}:{}),...(p.replyVersion===1&&p.replyUnavailable?{replyUnavailable:true as const}:{})}}
function discardText(p:Pending,keepReply=false){delete p.original;delete p.prompt;delete p.guard;delete p.question;delete p.context;if(!keepReply){delete p.assistantReply;delete p.replyUnavailable}p.answers=[];p.status='closed'}
const startFingerprint=(input:Extract<ConversationInput,{op:'start'}>)=>hash(input.replyVersion===1?canonicalJson([input.prompt,input.context??null,1]):input.context===undefined?input.prompt:canonicalJson([input.prompt,input.context]))
function writesKnown(record:IntentRecord,receipt:ActionReceipt){
  const writes=record.calls.filter(c=>TOOLS[c.command.tool].write)
  return writes.length>0&&(record.guard?.checklist?receipt.outcome==='complete':receipt.verified>0&&receipt.targets.length===writes.length&&receipt.targets.every(t=>t.state==='applied'&&t.verification==='verified'||t.state==='conflict'||t.state==='rejected'))
}
function candidateQuestion(record:IntentRecord):Clarification {
  const reads=record.calls.filter(c=>c.command.tool==='list_tasks'&&c.result?.state==='ok')
  const names:string[]=[]
  for(const call of reads){
    const result=call.result!
    if(result.state!=='ok'||!plainRecord(result.data)||!Array.isArray(result.data.items))continue
    for(const item of result.data.items){
      if(names.length>=4)break
      if(!plainRecord(item)||item.deleted||item.completed||typeof item.title!=='string')continue
      const name=JSON.stringify(Array.from(item.title).slice(0,40).join(''))+(typeof item.date==='string'?` (${item.date})`:'')
      if(!names.includes(name))names.push(name)
    }
  }
  const question=names.length?`Which tasks do you mean? I found ${names.join(', ')}. You can describe a group or a date.`:reads.length?"I couldn't find matching current tasks. Which existing tasks should I look for, and on what date?":'Which tasks do you mean? Describe a group or date so I can check the current records.'
  const clipped=question.slice(0,500)
  return {reason:'task_names',question:/[\ud800-\udbff]$/.test(clipped)?clipped.slice(0,-1):clipped}
}
export async function projectConversationReceipt(record:IntentRecord,transport:ServiceTransport,replyEnabled=false):Promise<ActionReceipt>{
  const writes=record.calls.filter(c=>TOOLS[c.command.tool].write)
  const targets=await Promise.all(writes.map((c,i)=>transport.inspect(c.command,c.result??{state:'uncertain',operationKey:String(c.command.args.operationKey)},!writes.slice(i+1).some(next=>(next.command.args.id??next.command.args.eventId)===(c.command.args.id??c.command.args.eventId)))))
  const checklist=record.guard?.checklist,expected=checklist?.tasks.length??null
  const verified=new Set(targets.filter(t=>t.verification==='verified'&&t.state==='applied').map(t=>t.kind+'\0'+t.id)).size
  const matched=checklist?.tasks.filter(g=>targets.some(t=>t.kind==='task'&&t.action==='added'&&t.title===g.title&&t.date===g.date&&t.state==='applied'&&t.verification==='verified')).length??0
  const complete=record.phase==='completed'&&expected!==null&&matched===expected&&writes.length===expected&&targets.every(t=>t.verification==='verified'&&t.state==='applied')
  const uncertain=record.phase!=='completed'||targets.some(t=>t.state==='uncertain'||t.verification!=='verified'&&t.state==='applied'||t.verification==='snapshot_pending')
  const noAction=replyEnabled&&record.phase==='completed'&&record.calls.length===0
  const readOnly=noAction||(record.guard?.readOnly||record.guard?.contextual)&&record.phase==='completed'&&!writes.length&&record.calls.some(c=>c.command.tool!=='request_clarification'&&c.result?.state==='ok')
  if(readOnly){
    for(const call of record.calls){
      if(call.result?.state!=='ok'||!plainRecord(call.result.data)||!Array.isArray(call.result.data.items))continue
      for(const item of call.result.data.items){
        if(targets.length>=4)break
        if(!plainRecord(item)||typeof item.id!=='string'||typeof item.title!=='string'||item.title.length>240)continue
        if(targets.some(t=>t.id===item.id))continue
        targets.push({kind:call.command.tool.replace(/^list_/,''),id:item.id,action:'read',title:item.title,state:'ok',verification:'verified',...(typeof item.date==='string'?{date:item.date}:{})})
      }
    }
  }
  const outcome:ActionReceipt['outcome']=complete?'complete':uncertain?'uncertain':readOnly?'read-only':verified?'partial':writes.length||expected!==null?'failed':'uncertain'
  const pending=targets.some(t=>t.verification==='snapshot_pending')?' Calendar saved; snapshot confirmation pending.':''
  const readLine=noAction?'No actions performed.':record.guard?.contextual
    ?targets.length?`Showing ${targets.length} returned record${targets.length===1?'':'s'} (limit 4). No changes made.`:'Read finished. No changes made.'
    :'Read-only effects checked; no writes. Full requested scope is not certified. View shows at most four record titles.'
  const line=complete?`Added ${verified}/${expected} tasks · ${checklist!.tasks[0]!.date}`:expected!==null?`${outcome==='uncertain'?'Uncertain':'Incomplete'}: ${matched}/${expected} tasks verified. Edit or clear; do not repeat saved work.`:readOnly?readLine:verified?record.guard?.contextual&&record.phase==='completed'&&targets.every(t=>t.kind==='task'&&t.action==='updated'&&t.state==='applied'&&t.verification==='verified')?`Updated ${verified} task${verified===1?'':'s'}.`:`${verified} record${verified===1?'':'s'} verified; full requested scope is unresolved.`:writes.length?'No confirmed completion. Review details before repeating.':'No mutation effects verified; requested scope remains unresolved.'
  return {version:1,key:record.key,outcome,line:line+pending,verified,expected,targets}
}
// Existing versioned planner storage only. Slot lock -> root row; no connection
// survives model execution. A turn is uniquely claimed before controller admission.
export class Conversations {
  constructor(private readonly options:{pool:Pool;store:SqlIntentStore;transport:ServiceTransport;run:(input:{key:string;prompt:string;tabId?:string;guard:ConversationGuard;replyVersion?:1},signal?:AbortSignal)=>Promise<unknown>;fence:(input:{key:string;prompt:string;tabId?:string;guard:ConversationGuard})=>Promise<void>;now?:()=>number}){}
  private async put(c:PoolClient,id:string,kind:string,data:unknown){
    await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$3,version=planner_entities.version+1 WHERE planner_entities.kind=$2 AND planner_entities.data IS DISTINCT FROM $3::jsonb',[id,kind,data])
  }
  private decode(row:Row|undefined,owner:string,clientId:string,rootKey:string):Pending{
    if(!row||row.kind!==KIND||!plainRecord(row.data))return fail('conversation_conflict')
    const p=row.data as unknown as Pending
    if(p.replyVersion!==undefined&&p.replyVersion!==1||p.assistantReply!==undefined&&(!validAssistantReply(p.assistantReply)||p.replyVersion!==1||p.status!=='closed'||p.replyUnavailable!==undefined)||p.replyUnavailable!==undefined&&(p.replyUnavailable!==true||p.replyVersion!==1))return fail('conversation_conflict')
    if(p.context!==undefined&&!validReference(p.context)||p.contextual!==undefined&&p.contextual!==true||p.continuable!==undefined&&typeof p.continuable!=='boolean')return fail('conversation_conflict')
    if(p.version!==1||p.owner!==owner||p.clientId!==clientId||p.rootKey!==rootKey||!Array.isArray(p.turns)||p.turns.length>4||p.turns.some(t=>!plainRecord(t)||!key(t.key)||typeof t.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(t.fingerprint))||!Array.isArray(p.answers)||p.answers.length>3||p.answers.some(a=>typeof a!=='string')||p.original!==undefined&&typeof p.original!=='string'||!conversationTextFits([p.original??'',...p.answers])||!Number.isSafeInteger(p.expiresAt)||!Number.isInteger(p.questions)||p.questions<0||p.questions>3||!['running','question','closed'].includes(p.status)||p.guard!==undefined&&!validGuard(p.guard)||!validActionReceipt(p.receipt)||p.question&&!(p.contextual?validConversationClarification:validClarification)({reason:p.question.reason,question:p.question.question}))return fail('conversation_conflict')
    return structuredClone(p)
  }
  private prepare(p:Pending){
    const time=(this.options.now??Date.now)()
    const interpreted=interpretTasks(p.original!,p.answers,nyDate(p.contextual?p.createdAt:time))
    let checklist:Checklist|undefined,question:string|undefined
    if(interpreted.kind==='question')question=interpreted.reason
    if(interpreted.kind==='checklist')checklist=interpreted.checklist
    if(question&&p.questions>=CONVERSATION_LIMITS.questions){p.receipt=blank(p.turnKey,'Clarification limit reached (3 questions). Nothing new was executed. Start a new request.','failed');discardText(p);return false}
    const binding=hash(canonicalJson([p.owner,p.clientId,p.rootKey]))
    p.guard={version:1,binding,...(p.contextual?{contextual:true as const}:{}),...(checklist?{checklist}:{}),...(question?{questionOnly:true as const,questionReason:question}:{}),...(/^(?:list|show|find|search|what|which)\b/i.test(p.original!)?{readOnly:true as const}:{})}
    if(p.replyVersion===1&&/^(?:explain|describe|why|how)\b/i.test(p.original!))p.guard.readOnly=true
    // Fixed executable checklist is kept separate from disposable conversation.
    // No original/answers are re-executed following any applied/uncertain write.
    p.prompt=question?`Ask request_clarification with reason ${question}, then stop without writes. No other missing fields are relevant to this standalone study-task request.`:checklist?`Create exactly these standalone tasks, and nothing else: ${JSON.stringify(checklist.tasks)}. Read current task collection versions first. Create each once, with only title/date/expectedVersion, sequential collection versions. Read back. No duration, exam date, calendar, project or planning is required. Backend owns IDs and operation keys.`:JSON.stringify({original:p.original,confirmedAnswers:p.answers,...(p.contextual&&p.question?{lastQuestion:p.question.question}:{})})
    if(p.contextual)p.prompt=executionContext(p.createdAt,time,p.context??{version:1,entries:[]})+p.prompt
    if(!conversationTextFits([p.prompt])){p.receipt=blank(p.turnKey,'Request context exceeds the execution prompt limit. Shorten the request; no new work was executed.','failed');discardText(p);return false}
    p.status='running';delete p.question;p.receipt=blank(p.turnKey,'Request not yet confirmed. No automatic resend.')
    return true
  }
  async handle(input:ConversationInput,owner:string,signal?:AbortSignal):Promise<ConversationReply>{
    if(!validConversationInput(input)||!owner)return fail('invalid_arguments')
    const {pool,store,transport}=this.options,now=(this.options.now??Date.now)(),rootKey=input.op==='start'?input.key:input.rootKey
    const id=address(KIND+owner+rootKey),slotId=address(SLOT+owner+input.clientId)
    const c=await pool.connect();let pending:Pending,execute=false
    try{
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817350))',[slotId])
      // Lazy bounded-text GC: expire payloads, never delete journals, receipts,
      // keys, claims or tombstones. No background service or runtime is started.
      await expireConversationText(c,now,owner)
      const row=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[id])).rows[0]
      const slot=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[slotId])).rows[0]
      if(input.op==='cancel'&&!row){
        // A never-arrived start is fenced by a closed tombstone too. A delayed
        // HTTP start cannot execute after this explicit cancellation succeeds.
        pending={version:1,owner,clientId:input.clientId,rootKey,createdAt:now,expiresAt:now,status:'closed',answers:[],questions:0,turns:[],turnKey:rootKey,receipt:blank(rootKey,'Closed without replay. No rollback is implied.','failed')}
      }else if(input.op==='start'&&!row){
        if(slot){
          if(slot.kind!==SLOT||!plainRecord(slot.data)||typeof slot.data.rootKey!=='string')return fail('conversation_conflict')
          const oldId=address(KIND+owner+slot.data.rootKey),oldRow=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[oldId])).rows[0]
          const old=this.decode(oldRow,owner,input.clientId,slot.data.rootKey)
          if(old.status!=='closed'&&old.expiresAt>now){
            if(old.status!=='question'||old.receipt.outcome!=='question'||!old.question||old.receipt.key!==old.turnKey||old.turns.at(-1)?.key!==old.turnKey)return fail('active_conversation')
            // Slot/root locks precede the existing strict journal read. A
            // completed no-write clarification has no execution left to fence;
            // missing, corrupt or inconclusive journals never authorize reuse.
            let record:IntentRecord
            try{record=await store.readInTransaction(c,old.turnKey)}catch{return fail('active_conversation')}
            if(record.phase!=='completed'||record.guard?.binding!==hash(canonicalJson([owner,input.clientId,old.rootKey]))||record.calls.some(call=>TOOLS[call.command.tool].write))return fail('active_conversation')
            old.receipt=blank(old.turnKey,'Clarification superseded by a new request. No writes were admitted; nothing was replayed.','failed')
            discardText(old)
            await this.put(c,oldId,KIND,old)
          }
        }
        const context=input.context?referenceAt(input.context,now):undefined
        pending={version:1,owner,clientId:input.clientId,rootKey,createdAt:now,expiresAt:Math.min(now+CONVERSATION_LIMITS.ttlMs,...(context?.entries.map(e=>e.at+CONVERSATION_LIMITS.ttlMs)??[])),status:'running',original:input.prompt,answers:[],questions:0,turns:[{key:input.key,fingerprint:startFingerprint(input)}],turnKey:input.key,receipt:blank(input.key,'Request not confirmed.'),...(input.tabId?{tabId:input.tabId}:{}),...(context?{context,contextual:true as const}:{})}
        if(input.replyVersion===1)pending.replyVersion=1
        execute=this.prepare(pending)
        await this.put(c,slotId,SLOT,{version:1,rootKey})
      }else{
        pending=this.decode(row,owner,input.clientId,rootKey)
        if(pending.expiresAt<=now&&pending.receipt.outcome==='question'){
          pending.receipt=blank(pending.turnKey,'Clarification expired after 24 hours. Start a new request; nothing was resent.','failed');discardText(pending)
        }
        if(input.op==='start'&&pending.turns[0]?.fingerprint!==startFingerprint(input))return fail('conversation_conflict')
        if(input.op==='answer'){
          const fingerprint=hash(canonicalJson([input.parentKey,input.questionId,input.answer]))
          const claimed=pending.turns.find(t=>t.key===input.key)
          if(claimed){if(claimed.fingerprint!==fingerprint)return fail('conversation_conflict')}
          else{
            if(!slot||!plainRecord(slot.data)||slot.data.rootKey!==rootKey||pending.status!=='question'||pending.turnKey!==input.parentKey||pending.question?.id!==input.questionId||pending.expiresAt<=now||!pending.original||pending.turns.length>=4)return fail('closed_question')
            if(!conversationTextFits([pending.original,...pending.answers,input.answer]))return fail('text_limit')
            pending.answers.push(input.answer);pending.turns.push({key:input.key,fingerprint});pending.turnKey=input.key
            execute=this.prepare(pending)
          }
        }
        if(input.op==='cancel'){
          if(pending.status==='running'){
            // Fence further tool reservations, not a rollback of committed work.
            await this.options.fence({key:pending.turnKey,prompt:pending.prompt!,guard:pending.guard!,...(pending.tabId?{tabId:pending.tabId}:{})})
            const record=await store.read(pending.turnKey)
            pending.receipt=await projectConversationReceipt(record,transport)
          }
          pending.receipt={...pending.receipt,outcome:pending.receipt.outcome==='question'?'failed':pending.receipt.outcome,line:pending.receipt.outcome==='question'?'Cancelled before writes. Earlier receipts are unchanged.':pending.receipt.line};discardText(pending)
        }
      }
      await this.put(c,id,KIND,pending);await c.query('COMMIT')
    }catch(error){try{await c.query('ROLLBACK')}catch{/* Preserve committed claims on ambiguous ACK. */}throw error}finally{c.release()}
    let runResult:unknown
    if(execute){
      try{runResult=await this.options.run({key:pending.turnKey,prompt:pending.prompt!,guard:pending.guard!,...(pending.tabId?{tabId:pending.tabId}:{}),...(pending.replyVersion===1?{replyVersion:1 as const}:{})},signal)}catch{/* Receipt read only below; NEVER restart a claimed turn. */}
    }
    if(pending.status==='running'||input.op==='read'&&pending.status==='closed'&&['partial','uncertain'].includes(pending.receipt.outcome)){
      let record:IntentRecord|undefined
      try{record=await store.read(pending.turnKey)}catch{/* A lost admission ACK is not permission to retry. */}
      if(record?.guard?.binding!==hash(canonicalJson([owner,input.clientId,rootKey])))record=undefined
      const receipt=record?await projectConversationReceipt(record,transport,pending.replyVersion===1):blank(pending.turnKey,'Execution not confirmed. Edit or clear; no automatic resend.')
      const questions=record?.calls.filter(call=>call.command.tool==='request_clarification'&&call.result?.state==='ok').map(call=>(call.result as {state:'ok';data:unknown}).data).filter(validClarification)??[]
      const noWrites=record?.phase==='completed'&&record.calls.every(call=>!TOOLS[call.command.tool].write)
      // Save only if this root/turn still owns the slot; cancel/new client turns
      // can never be overwritten by a late completion.
      const finish=await pool.connect()
      try{
        await finish.query('BEGIN');await finish.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817350))',[slotId])
        const row=(await finish.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[id])).rows[0]
        const current=this.decode(row,owner,input.clientId,rootKey)
        if((current.status==='running'||input.op==='read'&&current.status==='closed')&&current.turnKey===pending.turnKey){
          current.receipt=receipt
          if(current.contextual)current.continuable=record?.phase==='completed'&&writesKnown(record,receipt)
          if(current.status==='running'&&noWrites&&questions.length===1&&current.questions<3&&current.expiresAt>now&&current.original){
            const q=current.contextual&&questions[0]!.reason==='task_names'?candidateQuestion(record!):questions[0]!
            current.questions++;current.question={...q,id:hash(canonicalJson([rootKey,current.turnKey,current.questions,q]))};current.status='question';delete current.prompt;delete current.guard
            current.receipt=blank(current.turnKey,current.question.question,'question')
          }else if(execute||record?.phase==='completed'||record?.phase==='uncertain'){discardText(current,true)}
          if(execute&&current.replyVersion===1&&current.status==='closed'&&current.expiresAt>(this.options.now??Date.now)()&&plainRecord(runResult)&&runResult.phase==='completed'&&record?.phase==='completed'){
            const currentSlot=(await finish.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[slotId])).rows[0]
            if(currentSlot?.kind===SLOT&&plainRecord(currentSlot.data)&&currentSlot.data.rootKey===rootKey){
              if(validAssistantReply(runResult.assistantReply))current.assistantReply=runResult.assistantReply
              else if(runResult.replyUnavailable===true)current.replyUnavailable=true
            }
          }
          await this.put(finish,id,KIND,current)
        }
        pending=current;await finish.query('COMMIT')
      }catch(error){try{await finish.query('ROLLBACK')}catch{/* No replay. */}throw error}finally{finish.release()}
    }
    return replyOf(pending)
  }
}
