import {createHash} from 'node:crypto'
import {clarification,isClarificationReason} from './clarification.js'
import type {Pool,PoolClient} from 'pg'
import {validManualTask,type ManualTask} from '../manual-tasks.js'
import type {EventChange} from '../calendar-write.js'
import {reconcileCalendarMutation,validCalendarCompletion,type NonRecurringCalendarWriter,type CalendarWriteResult} from '../calendar-write.js'
import type {Snapshot} from '../sync.js'
import {TOOLS,isTool,plainRecord,validDate,validInstant,type Arguments,type Command,type Result} from './contracts.js'
import {validateServiceArguments,validServiceResult} from './service-contracts.js'
import type {Transport,Context} from './dispatcher.js'
import {readProductCache} from './cache-reads.js'
import {mutatePlannerEntity} from './planner-operations.js'
import {boundedPage} from './wire-budget.js'
import {BrowserTimerBridge,isTimerTool} from './browser-timer.js'
import {projectReceiptFields,type ReceiptTarget,type ReceiptFields} from './action-receipt.js'

export const COLLECTION='ccbf2a93-9be3-45bd-b039-1019cdb8276f'
export const RECEIPT_KIND='dcc-mcp-operation-v1'
export type DisplaySync={version:1;tasks:{id:string;version:number;after:ReceiptFields}[];calendar:{mutationId:string;calendarId:string;resourceKey:string|null;uid:string|null;start:string;end:string;allDay:boolean;deleted:boolean;recurrenceId:string|null}[]}
type Row={id:string;kind:string;version:number;data:Record<string,unknown>}
type Receipt={v:1;actorHash:string;key:string;fingerprint:string;tool:Command['tool'];state:Result['state'];result:Result;detail?:{before:ReceiptFields;after:ReceiptFields};change?:EventChange;writerPayloadJson?:string;writerPayloadHash?:string;guardedWriterVersion?:1;calendarCommand?:Command;browserTimerVersion?:1}
export type ServiceOptions={
  pool:Pool
  // Trusted authenticated caller binding, never accepted from tool arguments.
  // Actor scopes receipts only; the existing data store itself is shared.
  actorId:string
  calendarSnapshot?:()=>Promise<Snapshot>
  calendarWriter?:(change:EventChange)=>Promise<{code:number;saved?:boolean}>
  guardedCalendarWriter?:NonRecurringCalendarWriter
  browserTimer?:BrowserTimerBridge
}
export const canonicalJson=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
function uuid(value:string){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
const rejected=(code:Extract<Result,{state:'rejected'}>['code']):Result=>({state:'rejected',code})
const conflict=(code:Extract<Result,{state:'conflict'}>['code']):Result=>({state:'conflict',code})
function checkedVersion(value:unknown):number {
  if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)throw Error('Invalid storage version')
  return value
}
function collection(row:Row|undefined){
  if(!row)return {version:0,data:{tasks:[]} as Record<string,unknown>,tasks:[] as ManualTask[]}
  if(row.kind!=='manual-tasks'||!plainRecord(row.data))throw Error('Wrong collection shape')
  const tasks=row.data.tasks??[]
  if(!Array.isArray(tasks)||tasks.length>10000||!tasks.every(validManualTask)||new Set(tasks.map(t=>t.id)).size!==tasks.length)throw Error('Invalid existing collection')
  return {version:checkedVersion(row.version),data:row.data,tasks:tasks as ManualTask[]}
}
function projectData(data:Record<string,unknown>){
  const text=(key:string,max:number)=>typeof data[key]==='string'&&String(data[key]).length<=max
  const date=data.deadline
  if(!text('title',240)||!String(data.title).trim()||!text('description',12000)||!text('progress',4000)||!['school','work','personal','club'].includes(String(data.category))||!['active','complete','archived'].includes(String(data.status))||!Number.isInteger(data.importance)||Number(data.importance)<1||Number(data.importance)>3||!Number.isInteger(data.remainingMinutes)||Number(data.remainingMinutes)<0||Number(data.remainingMinutes)>100000||typeof date!=='string'||date!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('Invalid existing project')
  if(data.resources!==undefined&&(!Array.isArray(data.resources)||data.resources.length>20||data.resources.some(r=>!plainRecord(r)||typeof r.name!=='string'||r.name.length>200||typeof r.text!=='string')||data.resources.reduce((n,r)=>n+String(r.text).length,0)>100000))throw Error('Invalid existing resources')
  return data
}
function page(items:unknown[],args:Arguments){
  return boundedPage(items,Number(args.limit),Number(args.offset??0))
}
function instant(value:string){return value.replace(/\.000Z$/,'Z')}
const recurrenceFields=['rrule','recurrenceId','timezone','timezoneSourceEventId','clearRecurrence','exceptionPolicy','rdates','exdates'] as const
const recurrenceArguments=(args:Arguments)=>Object.fromEntries(recurrenceFields.filter(k=>Object.hasOwn(args,k)).map(k=>[k,args[k]]))

export class ServiceTransport implements Transport {
  readonly contract='dcc-service-v1' as const
  private readonly actorHash:string
  private readonly options:ServiceOptions
  constructor(options:ServiceOptions){
    if(typeof options.actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$(?![\s\S])/.test(options.actorId))throw Error('Trusted actor identity required')
    this.options={...options};this.actorHash=hash(options.actorId)
  }
  get actorScope(){return this.actorHash}
  private async localFields(c:Pick<PoolClient,'query'>,command:Command):Promise<ReceiptFields|undefined>{
    if(command.tool.includes('calendar_event')||isTimerTool(command.tool))return undefined
    if(command.tool.includes('task')){
      const task=collection(await this.row(c,COLLECTION)).tasks.find(t=>t.id===command.args.id)
      return task?projectReceiptFields(task as unknown as Record<string,unknown>):{}
    }
    const row=await this.row(c,String(command.args.id))
    if(!row)return {}
    if(!['project','action','preparation'].includes(row.kind)||row.data.id!==command.args.id)return undefined
    return projectReceiptFields(row.data)
  }
  // No mutation/recovery dispatch here. Check the actor-bound durable operation
  // plus a fresh SQL domain read, never a model's list result or final text.
  async inspect(command:Command,result:Result,lastForTarget:boolean):Promise<ReceiptTarget>{
    const tool=command.tool,kind=tool.includes('calendar_event')?'calendar':tool.includes('task')?'task':tool.includes('project')||tool==='create_assignment'?'project':tool.includes('preparation')?'preparation':isTimerTool(tool)?'timer':'action'
    const action=tool.startsWith('create_')?'added':tool.startsWith('remove_')||tool.startsWith('cancel_')?'deleted':tool.startsWith('set_')||tool.includes('archive')||tool.includes('restore')?'status':'updated'
    const id=String(command.args.eventId??command.args.id??''),base:ReceiptTarget={kind,id,action,title:'Record details unavailable',state:result.state,verification:'unavailable'}
    if(!TOOLS[tool].write)return base
    try{
      const row=await this.row(this.options.pool,this.receiptId(String(command.args.operationKey)))
      if(!row)return base
      const receipt=this.receipt(row,String(command.args.operationKey))
      if(receipt.tool!==tool||receipt.fingerprint!==hash(canonicalJson(command))||canonicalJson(receipt.result)!==canonicalJson(result))return base
      if(result.state==='saved')return {...base,kind:'calendar-mutation',id:result.mutationId,verification:'snapshot_pending',title:'Calendar saved; snapshot confirmation pending (mutation reference, not an event ID)'}
      const detail=receipt.detail
      if(!detail)return base // Older receipts remain valid, never fabricate history.
      const before=projectReceiptFields(detail.before),after=projectReceiptFields(detail.after)
      const current=lastForTarget?await this.localFields(this.options.pool,command):after
      const verified=result.state==='applied'&&current!==undefined&&canonicalJson(current)===canonicalJson(after)
      const title=String(after.title??before.title??'Record details unavailable')
      const date=after.date??before.date
      return {...base,title,...(typeof date==='string'?{date}:{}),before,after,verification:verified?'verified':'unavailable'}
    }catch{return base}
  }
  /** Display-only facts from every bound write, never a dispatch/reconcile call.
   * Calendar snapshot injection is cache-only. Missing identities stay pending. */
  async displaySync(calls:{command:Command;result?:Result}[]):Promise<DisplaySync|undefined>{
    if(calls.length>48||calls.filter(c=>TOOLS[c.command.tool].write).length>16)return undefined
    const tasks=new Map<string,DisplaySync['tasks'][number]>(),calendar=new Map<string,DisplaySync['calendar'][number]>()
    let snapshot:Snapshot|undefined
    if(calls.some(c=>c.result?.state==='saved')&&this.options.calendarSnapshot)try{snapshot=await this.options.calendarSnapshot()}catch{/* pending, not provider access */}
    for(const call of calls){
      const {command,result}=call
      if(!result||!TOOLS[command.tool].write)continue
      const relevant=command.tool.includes('task')&&result.state==='applied'||command.tool.includes('calendar_event')&&result.state==='saved'
      if(!relevant)continue
      if(!validServiceResult(command,result))return undefined
      try{
        const key=String(command.args.operationKey),row=await this.row(this.options.pool,this.receiptId(key))
        if(!row)return undefined
        const receipt=this.receipt(row,key)
        if(receipt.tool!==command.tool||receipt.fingerprint!==hash(canonicalJson(command))||canonicalJson(receipt.result)!==canonicalJson(result))return undefined
        if(command.tool.includes('task')&&(!receipt.detail||!('version' in result)))return undefined
        if(command.tool.includes('task')&&result.state==='applied'&&'version' in result&&receipt.detail){
          const id=String(command.args.id)
          if(result.id!==id)return undefined
          // Native task display facts have a narrower contract than historical
          // multi-domain receipt fields. Never strip additive task storage data.
          const fields=receipt.detail.after
          if(!plainRecord(fields)||typeof fields.title!=='string'||!fields.title.trim()||fields.title.length>240||!validDate(fields.date)||typeof fields.completed!=='boolean')return undefined
          const after:ReceiptFields={title:fields.title,date:fields.date,completed:fields.completed}
          for(const key of ['deleted','important'] as const)if(Object.hasOwn(fields,key)){
            if(typeof fields[key]!=='boolean')return undefined
            after[key]=fields[key]
          }
          tasks.set(id,{id,version:checkedVersion(result.version),after})
        }
        if(command.tool.includes('calendar_event')&&result.state==='saved'){
          const {change}=this.guardedPayload(receipt)
          if(change.id!==result.mutationId)return undefined
          const creating=command.tool==='create_calendar_event'
          const selected=snapshot?.events.find(e=>e.calendarId===change.calendarId&&e.id===change.eventId)
          const saved=snapshot?.events.filter(e=>e.calendarId===change.calendarId&&e.mutationId===change.id)
          const cal=snapshot?.calendars.find(c=>c.id===change.calendarId)
          const uid=creating?change.id+'@daymark':change.uid??selected?.uid??(saved?.length===1?saved[0]!.uid:undefined)
          const resource=creating&&cal?new URL(change.id+'.ics',cal.url.endsWith('/')?cal.url:cal.url+'/').href:selected?.resource??(saved?.length===1?saved[0]!.resource:undefined)
          // No raw provider URL, description, notes, capability or tool body.
          calendar.set(String(change.calendarId)+'\0'+(resource??change.id),{mutationId:change.id,calendarId:String(change.calendarId),resourceKey:resource&&change.scope!=='series'?hash(resource):null,uid:uid&&uid.length<=500?uid:null,start:change.start,end:change.end,allDay:change.allDay,deleted:change.operation==='delete',recurrenceId:typeof command.args.recurrenceId==='string'?command.args.recurrenceId:null})
        }
      }catch{return undefined /* Invalid/legacy receipts cannot authorize a truncated success. */}
    }
    const value:DisplaySync={version:1,tasks:[...tasks.values()],calendar:[...calendar.values()]}
    return (value.tasks.length||value.calendar.length)&&Buffer.byteLength(JSON.stringify(value),'utf8')<=16384?value:undefined
  }
  // Source-only receipt reconciliation for an already bound command. Unlike
  // execute(), this never starts/retries a domain write or reads a provider/cache.
  async reconcile(command:Command,context?:Context):Promise<Result|undefined> {
    if(!isTool(command.tool)||!TOOLS[command.tool].write||context?.purpose!=='action'||!context.capabilities.includes(TOOLS[command.tool].capability))return rejected('forbidden')
    const validation=validateServiceArguments(command.tool,command.args)
    if(!validation.valid)return rejected(validation.code)
    const frozen:Command={tool:command.tool,args:validation.args},key=String(frozen.args.operationKey)
    if(isTimerTool(command.tool)){try{return await this.timerCommand(frozen,context,false)}catch{return {state:'uncertain',operationKey:key}}}
    try{
      const row=await this.row(this.options.pool,this.receiptId(key))
      if(!row)return undefined
      const receipt=this.receipt(row,key)
      if(receipt.tool!==frozen.tool||receipt.fingerprint!==hash(canonicalJson(frozen)))throw Error('Mismatched recovery receipt')
      if(receipt.state==='saved'){
        const {change}=this.guardedPayload(receipt)
        if(receipt.result.state!=='saved'||receipt.result.mutationId!==change.id)throw Error('Invalid saved receipt binding')
      }
      const result=receipt.state==='uncertain'&&receipt.guardedWriterVersion===1?await this.recoverCalendar(receipt,false):receipt.result
      if(!validServiceResult(frozen,result))throw Error('Invalid reconciled receipt')
      return structuredClone(result)
    }catch{return {state:'uncertain',operationKey:key}}
  }
  private receiptId(key:string){return uuid(canonicalJson(['dcc-mcp-operation-v1',this.actorHash,key]))}
  private async row(c:Pick<PoolClient,'query'>,id:string,lock=false):Promise<Row|undefined>{
    const result=await c.query<Row>(`SELECT id,kind,version,data FROM planner_entities WHERE id=$1${lock?' FOR UPDATE':''}`,[id])
    return result.rows[0]
  }
  private receipt(row:Row,key:string):Receipt {
    const data=row.data
    if(row.kind!==RECEIPT_KIND||!plainRecord(data)||data.v!==1||data.actorHash!==this.actorHash||data.key!==key||typeof data.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(data.fingerprint)||!isTool(data.tool)||!['applied','rejected','conflict','uncertain','saved'].includes(String(data.state))||!plainRecord(data.result)||data.result.state!==data.state)throw Error('Invalid durable receipt')
    return data as unknown as Receipt
  }
  async execute(input:Command,context?:Context):Promise<Result> {
    if(!isTool(input.tool))return rejected('unknown_tool')
    const definition=TOOLS[input.tool]
    // Defense in depth for direct source-level use as well as Dispatcher calls.
    // Context is a separate trusted parameter, never read from command arguments.
    if(!context||!['action','parser','planner','extraction','read'].includes(context.purpose)||!Array.isArray(context.capabilities)||!context.capabilities.includes(definition.capability)||definition.write&&context.purpose!=='action')return rejected('forbidden')
    const validation=validateServiceArguments(input.tool,input.args)
    if(!validation.valid)return rejected(validation.code)
    const command:Command={tool:input.tool,args:validation.args}
    if(command.tool==='request_clarification'){
      if(context.purpose!=='action'||!isClarificationReason(command.args.reason))return rejected('forbidden')
      return {state:'ok',data:clarification(command.args.reason)}
    }
    try {
      const result=isTimerTool(command.tool)?await this.timerCommand(command,context,true):TOOLS[command.tool].write?await this.write(command):await this.read(command)
      if(!validServiceResult(command,result))throw Error('Invalid projected result')
      return result
    }catch{return TOOLS[command.tool].write?{state:'uncertain',operationKey:String(command.args.operationKey)}:rejected('transport_failure')}
  }
  private async timerCommand(command:Command,context:Context,dispatch:boolean):Promise<Result>{
    if(!this.options.browserTimer)return rejected('transport_unconfigured')
    if(command.tool==='get_focus_timer')return this.options.browserTimer.execute(command,context)
    const key=String(command.args.operationKey),id=this.receiptId(key),fingerprint=hash(canonicalJson(command)),uncertain:Result={state:'uncertain',operationKey:key}
    const c=await this.options.pool.connect();let fresh=false
    try{
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817344))',[id])
      const row=await this.row(c,id,true)
      if(row){
        const receipt=this.receipt(row,key)
        if(receipt.fingerprint!==fingerprint||receipt.tool!==command.tool){await c.query('COMMIT');return conflict('operation_key_mismatch')}
        if(receipt.browserTimerVersion!==1)throw Error('Wrong timer receipt version')
        if(receipt.state!=='uncertain'){if(!validServiceResult(command,receipt.result))throw Error('Invalid timer receipt');await c.query('COMMIT');return receipt.result}
      }else if(dispatch){
        await this.insert(c,id,RECEIPT_KIND,{v:1,actorHash:this.actorHash,key,fingerprint,tool:command.tool,state:'uncertain',result:uncertain,browserTimerVersion:1});fresh=true
      }
      await c.query('COMMIT')
    }catch(error){try{await c.query('ROLLBACK')}catch{/* Preserve uncertainty. */}throw error}finally{c.release()}
    // A reserved/restarted command is reconciliation-only, never another dispatch.
    const result=fresh?await this.options.browserTimer.execute(command,context):await this.options.browserTimer.recover(command,context)
    if(result.state==='uncertain')return result
    if(!validServiceResult(command,result))throw Error('Invalid browser acknowledgment')
    const completion=await this.options.pool.connect()
    try{
      await completion.query('BEGIN');await completion.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817344))',[id])
      const row=await this.row(completion,id,true)
      if(!row)throw Error('Missing timer receipt')
      const current=this.receipt(row,key)
      if(current.fingerprint!==fingerprint||current.browserTimerVersion!==1)throw Error('Timer receipt changed')
      const terminal=current.state==='uncertain'?result:current.result
      if(!validServiceResult(command,terminal))throw Error('Invalid terminal timer receipt')
      if(current.state==='uncertain')await this.update(completion,row,{...current,state:terminal.state,result:terminal})
      await completion.query('COMMIT');return terminal
    }catch(error){try{await completion.query('ROLLBACK')}catch{/* Never re-execute. */}throw error}finally{completion.release()}
  }
  private async read(command:Command):Promise<Result>{
    const cached=await readProductCache(this.options.pool,command)
    if(cached)return cached
    if(command.tool==='get_calendar_series')return this.options.guardedCalendarWriter?.readSeries?this.options.guardedCalendarWriter.readSeries(String(command.args.calendarId),String(command.args.eventId)):{state:'rejected',code:'transport_unconfigured'}
    const {tool,args}=command
    if(tool==='get_operation_status'){
      const key=String(args.operationKey),row=await this.row(this.options.pool,this.receiptId(key))
      if(!row)return {state:'ok',data:{operationKey:key,status:'unknown'}}
      const receipt=this.receipt(row,key)
      if(receipt.state==='saved'){
        const {change}=this.guardedPayload(receipt)
        if(receipt.result.state!=='saved'||receipt.result.mutationId!==change.id)throw Error('Invalid saved receipt binding')
      }
      let result=receipt.result
      if(receipt.state==='uncertain'&&receipt.guardedWriterVersion===1)result=await this.recoverCalendar(receipt,false)
      if(result.state==='saved')return {state:'ok',data:{operationKey:key,status:'saved',result}}
      return {state:'ok',data:{operationKey:key,status:result.state}}
    }
    const offset=Number(args.offset??0),limit=Number(args.limit)
    if(tool==='list_tasks'){
      const saved=collection(await this.row(this.options.pool,COLLECTION))
      const items=saved.tasks.filter(t=>t.date>=String(args.from)&&t.date<String(args.to)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(offset,offset+limit+1).map(t=>({id:t.id,title:t.title,date:t.date,notes:t.notes,important:!!t.important,completed:t.completed,deleted:!!t.deleted,recurring:Object.hasOwn(t,'recurrence'),...(t.recurrence?{recurrence:structuredClone(t.recurrence)}:{}),version:saved.version}))
      return boundedPage(items,limit,offset,{collectionVersion:saved.version})
    }
    if(tool==='list_projects'){
      const selected=args.id!==undefined?await this.row(this.options.pool,String(args.id)):undefined
      const rows=args.id!==undefined?(selected?.kind==='project'?[selected]:[]):(await this.options.pool.query<Row>("SELECT id,kind,version,data FROM planner_entities WHERE kind='project' ORDER BY id LIMIT $1 OFFSET $2",[limit+1,offset])).rows
      return page(rows.map(row=>{
        const d=projectData(row.data)
        if(d.id!==row.id)throw Error('Project ID mismatch')
        return {id:row.id,title:d.title,description:d.description,deadline:d.deadline,kind:d.kind==='assignment'?'assignment':'project',status:d.status,category:d.category,importance:d.importance,remainingMinutes:d.remainingMinutes,progress:d.progress,version:checkedVersion(row.version)}
      }),args)
    }
    if(!this.options.calendarSnapshot)return rejected('transport_unconfigured')
    const snapshot=await this.options.calendarSnapshot()
    if(!Array.isArray(snapshot.calendars)||snapshot.calendars.length>10000||!Array.isArray(snapshot.events)||snapshot.events.length>100000)return rejected('cache_unavailable')
    if(tool==='list_calendars')return page([...snapshot.calendars].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(offset,offset+limit+1).map(c=>({id:c.id,name:c.name,writable:!!this.options.guardedCalendarWriter})),args)
    if(snapshot.events.some(e=>!e||typeof e.start!=='string'||typeof e.end!=='string'||(e.allDay?!validDate(e.start)||!validDate(e.end):!validInstant(instant(e.start))||!validInstant(instant(e.end)))||Date.parse(e.end)<=Date.parse(e.start)))return rejected('cache_unavailable')
    if(!this.covered(snapshot,String(args.from),String(args.to)))return rejected('cache_unavailable')
    if(!snapshot.calendars.some(c=>c.id===args.calendarId))return rejected('not_found')
    return page(snapshot.events.filter(e=>e.calendarId===args.calendarId&&Date.parse(e.start)<Date.parse(String(args.to))&&Date.parse(e.end)>Date.parse(String(args.from))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(offset,offset+limit+1).map(e=>({id:e.id,calendarId:e.calendarId,title:e.title,start:instant(e.start),end:instant(e.end),allDay:e.allDay,description:e.description,location:e.location,etag:e.etag,cancelled:false,recurring:e.recurrenceId?true:null,recurrenceId:e.recurrenceId})),args)
  }
  private covered(snapshot:Snapshot,from:string,to:string){return !!snapshot.coverageStart&&!!snapshot.coverageEnd&&Date.parse(snapshot.coverageStart)<=Date.parse(from)&&Date.parse(snapshot.coverageEnd)>=Date.parse(to)}
  private async insert(c:PoolClient,id:string,kind:string,data:unknown){
    const result=await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[id,kind,data])
    if(result.rowCount!==1||result.rows[0]?.version!==1)throw Error('Insert did not affect one row')
  }
  private async update(c:PoolClient,row:Row,data:unknown){
    if(checkedVersion(row.version)>=2147483647)throw Error('Storage version exhausted')
    const result=await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1 AND kind=$3 AND version=$4 RETURNING version',[row.id,data,row.kind,row.version])
    if(result.rowCount!==1||result.rows[0]?.version!==row.version+1)throw Error('Update did not affect one row')
    return row.version+1
  }
  private async write(command:Command):Promise<Result>{
    if(command.tool.includes('calendar_event')&&this.options.guardedCalendarWriter)return this.writeGuardedCalendar(command)
    const {args,tool}=command,key=String(args.operationKey),id=this.receiptId(key)
    const fingerprint=hash(canonicalJson({tool,args})),uncertain:Result={state:'uncertain',operationKey:key}
    // Snapshot dependencies may themselves use the injected pool: do not hold a
    // connection while calling them. Existing durable receipts win over cache loss.
    let snapshot:Snapshot|undefined
    if(tool.includes('calendar_event')&&this.options.calendarSnapshot){try{snapshot=await this.options.calendarSnapshot()}catch{/* fail closed below */}}
    const c=await this.options.pool.connect()
    let dispatchChange:EventChange|undefined,destroyConnection=false
    try {
      await c.query('BEGIN')
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817344))',[id])
      const old=await this.row(c,id,true)
      if(old){
        const receipt=this.receipt(old,key)
        const result=receipt.fingerprint!==fingerprint||receipt.tool!==tool?conflict('operation_key_mismatch'):receipt.result
        if(!validServiceResult(command,result))throw Error('Invalid durable result')
        await c.query('COMMIT');return result
      }
      const receipt:Receipt={v:1,actorHash:this.actorHash,key,fingerprint,tool,state:'uncertain',result:uncertain}
      await this.insert(c,id,RECEIPT_KIND,receipt)
      // The domain lock also protects the before/after projection. The mutation
      // functions reenter the same transaction-level advisory lock safely.
      if(!tool.includes('calendar_event'))await c.query(tool.includes('task')?'SELECT pg_advisory_xact_lock(817342)':'SELECT pg_advisory_xact_lock(817340)')
      const before=await this.localFields(c,command)
      let result:Result
      if(tool.includes('calendar_event')){
        const preflight=this.calendarPreflight(command,snapshot)
        if('state' in preflight)result=preflight
        else {
          dispatchChange=preflight;receipt.change=preflight
          // Existing applyChange fingerprints JSON.stringify(change), not our
          // canonical argument hash. JSONB reorders object keys: keep the exact
          // initial serialization as evidence for a future same-payload reconciler.
          receipt.writerPayloadJson=JSON.stringify(preflight)
          receipt.writerPayloadHash=hash(receipt.writerPayloadJson)
          result=uncertain
        }
      }else result=['create_daily_action','update_daily_action'].includes(tool)||tool.includes('preparation')?await mutatePlannerEntity(c,command):tool.includes('task')?await this.taskMutation(c,command):await this.projectMutation(c,command)
      if(!validServiceResult(command,result))throw Error('Invalid mutation result')
      receipt.result=result;receipt.state=result.state
      if(before!==undefined){const after=await this.localFields(c,command);if(after!==undefined)receipt.detail={before,after}}
      await this.update(c,{id,kind:RECEIPT_KIND,version:1,data:{}},receipt)
      // Local data, planning request and completed receipt share this commit.
      // External effects have only an immutable uncertain reservation here.
      await c.query('COMMIT')
      if(!dispatchChange)return result
    }catch(error){try{await c.query('ROLLBACK')}catch{destroyConnection=true}throw error}
    finally{if(destroyConnection)c.release(true);else c.release()}
    // Reserve/commit/release BEFORE writer invocation. No uncertain receipt ever
    // reaches this branch on replay, including a crash before the first call.
    try{await this.options.calendarWriter!(structuredClone(dispatchChange!))}catch{/* never echo provider errors */}
    // applyChange returns saved:true, not an authoritative event ID/new ETag.
    // Keep uncertainty instead of inventing a stable event identity or revision.
    return uncertain
  }
  private guardedPayload(receipt:Receipt):{command:Command;change:EventChange} {
    if(receipt.guardedWriterVersion!==1||!plainRecord(receipt.calendarCommand)||!isTool(receipt.calendarCommand.tool)||!receipt.calendarCommand.tool.includes('calendar_event')||receipt.calendarCommand.tool!==receipt.tool)throw Error('Invalid calendar command binding')
    const command=receipt.calendarCommand,validated=validateServiceArguments(command.tool,command.args)
    if(!validated.valid||command.args.operationKey!==receipt.key||hash(canonicalJson(command))!==receipt.fingerprint||typeof receipt.writerPayloadJson!=='string'||hash(receipt.writerPayloadJson)!==receipt.writerPayloadHash)throw Error('Invalid immutable calendar payload')
    const change:unknown=JSON.parse(receipt.writerPayloadJson)
    if(!plainRecord(change)||Object.keys(change).some(key=>!['id','calendarId','eventId','etag','operation','title','start','end','allDay','description','location','scope','uid','sourceOccurrenceStart',...recurrenceFields].includes(key)))throw Error('Invalid calendar payload fields')
    const creating=command.tool==='create_calendar_event',cancel=command.tool==='cancel_calendar_event'
    const mutationId=creating?command.args.id:uuid(canonicalJson(['dcc-mcp-calendar',this.actorHash,receipt.key]))
    if(change.id!==mutationId||change.calendarId!==command.args.calendarId)throw Error('Calendar target mismatch')
    if(creating&&(Object.hasOwn(change,'eventId')||Object.hasOwn(change,'etag'))||!creating&&(change.eventId!==command.args.eventId||change.etag!==command.args.expectedEtag))throw Error('Calendar selector mismatch')
    if(cancel?change.operation!=='delete':Object.hasOwn(change,'operation'))throw Error('Calendar operation mismatch')
    for(const key of ['title','start','end','allDay','description','location',...recurrenceFields])if(Object.hasOwn(command.args,key)&&canonicalJson(change[key])!==canonicalJson(command.args[key]))throw Error('Calendar intent mismatch')
    if(change.scope!==undefined&&change.scope!==command.args.scope)throw Error('Calendar scope mismatch')
    const base={operationKey:receipt.key,calendarId:change.calendarId,scope:change.scope??'single',title:change.title,start:change.start,end:change.end,allDay:change.allDay,description:change.description,location:change.location,...Object.fromEntries(recurrenceFields.filter(k=>Object.hasOwn(change,k)).map(k=>[k,change[k]]))}
    const projected=creating?{...base,id:change.id}:{...base,eventId:change.eventId,expectedEtag:change.etag}
    if(!validateServiceArguments(creating?'create_calendar_event':'update_calendar_event',projected).valid)throw Error('Invalid frozen event fields')
    return {command,change:change as unknown as EventChange}
  }
  private calendarResult(receipt:Receipt,response:CalendarWriteResult):Result {
    const {change}=this.guardedPayload(receipt),completion=response.completion
    if(response.saved===true&&validCalendarCompletion(completion)&&completion.mutationId===change.id&&completion.payloadHash===receipt.writerPayloadHash)return {state:'saved',operationKey:receipt.key,mutationId:change.id,confirmation:'snapshot_pending',readback:completion.readback,providerEtag:completion.providerEtag}
    if(response.safeFailure&&['unsupported_recurrence','revision_mismatch','already_exists','not_found','operation_key_mismatch','cache_unavailable'].includes(response.safeFailure)){
      const code=response.safeFailure
      return ['revision_mismatch','already_exists','operation_key_mismatch'].includes(code)?conflict(code):rejected(code)
    }
    return {state:'uncertain',operationKey:receipt.key}
  }
  private async completeCalendar(receipt:Receipt,result:Result):Promise<Result> {
    const id=this.receiptId(receipt.key),c=await this.options.pool.connect();let destroy=false
    try {
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817344))',[id])
      const row=await this.row(c,id,true)
      if(!row)throw Error('Missing calendar receipt')
      const current=this.receipt(row,receipt.key),frozen=this.guardedPayload(current)
      if(current.fingerprint!==receipt.fingerprint||current.writerPayloadHash!==receipt.writerPayloadHash||!validServiceResult(frozen.command,result))throw Error('Calendar receipt scope changed')
      const terminal=current.state==='uncertain'?result:current.result
      if(!validServiceResult(frozen.command,terminal))throw Error('Invalid terminal calendar receipt')
      if(current.state==='uncertain')await this.update(c,row,{...current,result:terminal,state:terminal.state})
      await c.query('COMMIT');return terminal
    }catch(error){try{await c.query('ROLLBACK')}catch{destroy=true}throw error}
    finally{if(destroy)c.release(true);else c.release()}
  }
  private async recoverCalendar(receipt:Receipt,allowDispatch:boolean):Promise<Result> {
    const {change}=this.guardedPayload(receipt)
    let response=await reconcileCalendarMutation(this.options.pool,change)
    if(!response.saved&&!response.safeFailure&&allowDispatch&&this.options.guardedCalendarWriter){
      // This is a guarded same-mutation recovery, NOT a new parsed command. The
      // writer serializes, checks the exact hash, GETs the bound source and uses
      // mutation markers/conditional requests before considering another PUT.
      try{response=await this.options.guardedCalendarWriter.write(change)}catch{return {state:'uncertain',operationKey:receipt.key}}
    }
    const result=this.calendarResult(receipt,response)
    return result.state==='uncertain'?result:this.completeCalendar(receipt,result)
  }
  private async writeGuardedCalendar(command:Command):Promise<Result> {
    const key=String(command.args.operationKey),id=this.receiptId(key),fingerprint=hash(canonicalJson(command))
    let snapshot:Snapshot|undefined
    if(this.options.calendarSnapshot){try{snapshot=await this.options.calendarSnapshot()}catch{/* existing receipts still recover */}}
    const c=await this.options.pool.connect();let receipt:Receipt|undefined,destroy=false
    try {
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,817344))',[id])
      const row=await this.row(c,id,true)
      if(row){
        receipt=this.receipt(row,key)
        if(receipt.fingerprint!==fingerprint||receipt.tool!==command.tool){await c.query('COMMIT');return conflict('operation_key_mismatch')}
        if(receipt.state!=='uncertain'||receipt.guardedWriterVersion!==1){
          if(receipt.state==='saved'&&this.guardedPayload(receipt).change.id!==(receipt.result.state==='saved'?receipt.result.mutationId:undefined))throw Error('Saved mutation mismatch')
          if(!validServiceResult(command,receipt.result))throw Error('Invalid calendar receipt')
          await c.query('COMMIT');return receipt.result
        }
        this.guardedPayload(receipt)
      }else{
        const preflight=this.calendarPreflight(command,snapshot,true)
        const result:Result='state' in preflight?preflight:{state:'uncertain',operationKey:key}
        receipt={v:1,actorHash:this.actorHash,key,fingerprint,tool:command.tool,state:result.state,result}
        if(!('state' in preflight)){
          receipt.guardedWriterVersion=1;receipt.calendarCommand=structuredClone(command);receipt.change=preflight
          receipt.writerPayloadJson=JSON.stringify(preflight);receipt.writerPayloadHash=hash(receipt.writerPayloadJson)
          this.guardedPayload(receipt)
        }
        await this.insert(c,id,RECEIPT_KIND,receipt)
      }
      await c.query('COMMIT')
    }catch(error){try{await c.query('ROLLBACK')}catch{destroy=true}throw error}
    finally{if(destroy)c.release(true);else c.release()}
    if(!receipt)throw Error('Missing calendar reservation')
    return receipt.guardedWriterVersion===1&&receipt.state==='uncertain'?this.recoverCalendar(receipt,true):receipt.result
  }
  private async taskMutation(c:PoolClient,{tool,args}:Command):Promise<Result>{
    await c.query('SELECT pg_advisory_xact_lock(817342)')
    const old=await this.row(c,COLLECTION,true),saved=collection(old),id=String(args.id)
    if(saved.version!==args.expectedVersion)return conflict('revision_mismatch')
    const index=saved.tasks.findIndex(t=>t.id===id),prior=saved.tasks[index]
    let next:ManualTask
    if(tool==='create_task'){
      if(prior)return conflict('already_exists')
      if(saved.tasks.length>=10000)return rejected('operation_capacity')
      next={id,title:String(args.title),date:String(args.date),notes:String(args.notes??''),important:args.important===true,completed:false,deleted:false}
      if(args.recurrenceFrequency==='weekly')next.recurrence={version:1,kind:'template',frequency:'weekly',weekday:args.recurrenceWeekday,startDate:args.recurrenceStartDate,paused:args.recurrencePaused===true}
      if(args.templateId!==undefined){
        const template=saved.tasks.find(t=>t.id===args.templateId),r=template?.recurrence as {kind:string;startDate:string;weekday:number;paused:boolean}|undefined
        if(!template||template.deleted||!r||r.kind!=='template'||r.paused||String(args.sourceDate)<r.startDate||new Date(String(args.sourceDate)+'T00:00:00Z').getUTCDay()!==r.weekday)return rejected('parent_unavailable')
        next.recurrence={version:1,kind:'occurrence',templateId:template.id,sourceDate:args.sourceDate}
      }
    }else{
      if(!prior)return rejected('not_found')
      if(prior.deleted)return conflict('deleted')
      next={...prior}
      const recurrence=prior.recurrence as {kind:string;[key:string]:unknown}|undefined
      if(recurrence){
        if(recurrence.kind==='template'&&tool==='set_task_completed')return rejected('unsupported_recurrence')
        if(tool==='update_task'&&Object.keys(args).some(k=>k.startsWith('recurrence'))){
          if(recurrence.kind!=='template')return rejected('unsupported_recurrence')
          next.recurrence={...recurrence,...(args.recurrenceWeekday!==undefined?{weekday:args.recurrenceWeekday}:{}),...(args.recurrenceStartDate!==undefined?{startDate:args.recurrenceStartDate}:{}),...(args.recurrencePaused!==undefined?{paused:args.recurrencePaused}:{})}
        }
      }else if(tool==='update_task'&&Object.keys(args).some(k=>k.startsWith('recurrence')))return rejected('unsupported_recurrence')
      if(tool==='update_task')for(const k of ['title','date','notes','important'])if(Object.hasOwn(args,k))next[k]=args[k]
      if(tool==='set_task_completed')next.completed=args.completed===true
      if(tool==='remove_task')next.deleted=true
    }
    if(!validManualTask(next))return rejected('invalid_arguments')
    const comparable=(task:ManualTask)=>canonicalJson({...task,important:!!task.important,deleted:!!task.deleted})
    if(prior&&comparable(prior)===comparable(next))return {state:'applied',id,version:saved.version}
    const all=[...saved.tasks];if(index<0)all.push(next);else all[index]=next
    const data={...saved.data,tasks:all}
    const version=old?await this.update(c,old,data):(await this.insert(c,COLLECTION,'manual-tasks',data),1)
    return {state:'applied',id,version}
  }
  private async projectMutation(c:PoolClient,{tool,args}:Command):Promise<Result>{
    await c.query('SELECT pg_advisory_xact_lock(817340)')
    const id=String(args.id),old=await this.row(c,id,true)
    const creating=tool==='create_project'||tool==='create_assignment'
    if(creating&&old)return conflict('already_exists')
    if(!creating&&(!old||old.kind!=='project'))return rejected('not_found')
    if(old&&checkedVersion(old.version)!==args.expectedVersion)return conflict('revision_mismatch')
    let data:Record<string,unknown>
    if(creating)data={id,kind:tool==='create_assignment'?'assignment':'project',title:args.title,description:args.description??'',deadline:args.deadline??'',progress:args.progress??'',category:args.category,importance:args.importance,remainingMinutes:args.remainingMinutes,status:'active'}
    else {
      data={...projectData(old!.data)}
      if(data.id!==id)throw Error('Project ID mismatch')
      if(data.status==='archived'&&tool!=='restore_project')return conflict('archived')
      if(tool==='restore_project'&&data.status!=='archived')return conflict('revision_mismatch')
      if(tool==='update_project')for(const k of ['title','description','deadline','category','importance','remainingMinutes','progress'])if(Object.hasOwn(args,k))data[k]=args[k]
      if(tool==='set_project_status')data.status=args.status
      if(tool==='archive_project')data.status='archived'
      if(tool==='restore_project')data.status='active'
    }
    if(data.kind==='assignment'&&data.deadline==='')return rejected('invalid_arguments')
    projectData(data)
    if(old&&canonicalJson(data)===canonicalJson(old.data))return {state:'applied',id,version:old.version}
    const version=old?await this.update(c,old,data):(await this.insert(c,id,'project',data),1)
    const queued=await c.query('UPDATE planner_runs SET requested=true,next_attempt=now() WHERE id=1')
    if(queued.rowCount!==1)throw Error('Planning request did not affect one row')
    return {state:'applied',id,version}
  }
  private calendarPreflight({tool,args}:Command,snapshot:Snapshot|undefined,guarded=false):Result|EventChange {
    if(this.options.guardedCalendarWriter?.mode!=='scoped-v1'&&(args.scope!=='single'||recurrenceFields.some(k=>args[k]!==undefined)))return rejected('unsupported_recurrence')
    if(!(guarded?this.options.guardedCalendarWriter:this.options.calendarWriter)||!this.options.calendarSnapshot)return rejected('transport_unconfigured')
    if(!snapshot||!Array.isArray(snapshot.calendars)||snapshot.calendars.length>10000||!Array.isArray(snapshot.events)||snapshot.events.length>100000||!snapshot.calendars.some(c=>c.id===args.calendarId))return rejected('cache_unavailable')
    if(tool!=='create_calendar_event'){
      const event=snapshot.events.find(e=>e.id===args.eventId&&e.calendarId===args.calendarId)
      if(!event)return rejected('not_found')
      if(event.etag!==args.expectedEtag)return conflict('revision_mismatch')
      const scoped=this.options.guardedCalendarWriter?.mode==='scoped-v1'
      if(event.recurrenceId&&!scoped)return rejected('unsupported_recurrence')
      if(scoped&&(args.scope==='single'&&(event.recurrenceId??undefined)!==args.recurrenceId||args.scope==='series'&&args.recurrenceId!==undefined))return rejected('unsupported_recurrence')
      if(guarded){
        const cancel=tool==='cancel_calendar_event'
        return {id:uuid(canonicalJson(['dcc-mcp-calendar',this.actorHash,String(args.operationKey)])),calendarId:String(args.calendarId),eventId:String(args.eventId),etag:String(args.expectedEtag),...(scoped?{scope:args.scope as 'single'|'series',uid:event.uid,...(args.scope==='single'&&event.recurrenceId===null?{sourceOccurrenceStart:instant(event.start)}:{}),...recurrenceArguments(args)}:{}),...(cancel?{operation:'delete' as const}:{}),title:cancel?event.title:String(args.title),start:cancel?instant(event.start):String(args.start),end:cancel?instant(event.end):String(args.end),allDay:cancel?event.allDay:args.allDay===true,description:String(args.description??event.description),location:String(args.location??event.location)}
      }
      // Expanded cache has no authoritative nonrecurrence marker. applyChange's
      // live GET can turn a series into an occurrence edit; caller scope is not proof.
      return rejected('recurrence_unverified')
    }
    if(!this.covered(snapshot,String(args.start),String(args.end)))return rejected('cache_unavailable')
    return {id:String(args.id),calendarId:String(args.calendarId),...(this.options.guardedCalendarWriter?.mode==='scoped-v1'?{scope:args.scope as 'single'|'series',...recurrenceArguments(args)}:{}),title:String(args.title),start:String(args.start),end:String(args.end),allDay:args.allDay===true,description:String(args.description??''),location:String(args.location??'')}
  }
}
