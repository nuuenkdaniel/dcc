import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import {TOOLS,isTool,matches,plainRecord,validateArguments,validResult,validEntity,validDate,validInstant,DATE_SCHEMA,INSTANT_SCHEMA,type Arguments,type Command,type Definition,type Result,type Rule,type ToolName} from './contracts.js'
import {schemaForDefinition} from './schemas.js'
import {validManualTask} from '../manual-tasks.js'
import {EXTENDED_READS,validExtendedRead} from './product-projections.js'
import {validTimerSnapshot} from './browser-timer.js'

const field=(check:Rule['check'],schema:Rule['schema']):Rule=>({check,schema})
const integer=(min:number,max:number)=>field(v=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max,{type:'integer',minimum:min,maximum:max})
const version=integer(0,2147483646)
const category=field(v=>typeof v==='string'&&['school','work','personal','club'].includes(v),{type:'string',enum:['school','work','personal','club']})
const importance=integer(1,3),remainingMinutes=integer(0,100000)
const progress=TOOLS.create_task.fields.notes
const planning={category,importance,remainingMinutes,progress}
const clearableDeadline=field(v=>v===''||validDate(v),{anyOf:[{const:''},DATE_SCHEMA]})
const optional=(rule:Rule):Rule=>({...rule,optional:true})
export const projectUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/.test(v)
export const manualId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$(?![\s\S])/.test(v)
const {projectId:_unsupported,...taskCreateFields}=TOOLS.create_task.fields
const recurrenceFields={
  recurrenceFrequency:optional(field(v=>v==='weekly',{type:'string',enum:['weekly']})),
  recurrenceWeekday:optional(integer(0,6)),
  recurrenceStartDate:optional(field(validDate,DATE_SCHEMA)),
  recurrencePaused:optional(field(v=>typeof v==='boolean',{type:'boolean'})),
}
function boundedRuleParts(value:string){
  const parts=value.split(';').map(p=>p.split('=')),keys=parts.map(p=>p[0])
  if(new Set(keys).size!==keys.length||keys.includes('COUNT')&&keys.includes('UNTIL'))return false
  for(const [key,raw] of parts){
    if(key===undefined||raw===undefined)return false
    if(key==='BYMONTHDAY'&&raw.split(',').some(day=>!Number.isInteger(Number(day))||Math.abs(Number(day))>31||Number(day)===0))return false
    if(key==='UNTIL'){
      const date=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8)
      if(!validDate(date)||raw.length>8&&!validInstant(date+'T'+raw.slice(9,11)+':'+raw.slice(11,13)+':'+raw.slice(13,15)+'Z'))return false
    }
  }
  return true
}
const scopedCalendar={scope:field(v=>v==='single'||v==='series',{type:'string',enum:['single','series']}),
  timezone:optional(field(v=>typeof v==='string'&&/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+){1,3}$/.test(v)&&v.length<=200,{type:'string',maxLength:200,description:'Named TZID from the trusted source event VTIMEZONE; UTC inputs remain unambiguous instants.'})),
  timezoneSourceEventId:optional(TOOLS.create_task.fields.id),
  clearRecurrence:optional(field(v=>v===true,{const:true})),
  exceptionPolicy:optional(field(v=>v==='reject'||v==='discard',{type:'string',enum:['reject','discard'],description:'On clearRecurrence, reject existing exceptions by default; discard explicitly removes all exception components.'})),
  rdates:optional(field(v=>Array.isArray(v)&&v.length<=100&&Object.keys(v).length===v.length&&v.every(x=>validDate(x)||validInstant(x))&&new Set(v).size===v.length,{type:'array',maxItems:100,uniqueItems:true,items:{anyOf:[DATE_SCHEMA,INSTANT_SCHEMA]},description:'Replace the complete RDATE list. Dates for all-day events, UTC instants for timed events. Empty clears this list.'})),
  exdates:optional(field(v=>Array.isArray(v)&&v.length<=100&&Object.keys(v).length===v.length&&v.every(x=>validDate(x)||validInstant(x))&&new Set(v).size===v.length,{type:'array',maxItems:100,uniqueItems:true,items:{anyOf:[DATE_SCHEMA,INSTANT_SCHEMA]},description:'Replace the complete EXDATE list; read the authoritative series first. Empty clears this list.'})),
  recurrenceId:optional(field(v=>typeof v==='string'&&/^(?:20\d{2}|2100)-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?$(?![\s\S])/.test(v),{type:'string',maxLength:20})),
  rrule:optional(field(v=>typeof v==='string'&&v.length<=512&&/^(?:FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY))(?:;(?:INTERVAL|COUNT)=[1-9]\d{0,3}|;UNTIL=\d{8}(?:T\d{6}Z)?|;BYDAY=(?:[+-]?[1-5]?(?:MO|TU|WE|TH|FR|SA|SU))(?:,[+-]?[1-5]?(?:MO|TU|WE|TH|FR|SA|SU))*|;BYMONTHDAY=-?[1-9]\d?(?:,-?[1-9]\d?)*|;BYMONTH=(?:[1-9]|1[0-2])(?:,(?:[1-9]|1[0-2]))*)*$(?![\s\S])/.test(v)&&boundedRuleParts(v),{type:'string',maxLength:512})),
}
export const SERVICE_TOOLS:Record<ToolName,Definition>={...TOOLS,
  list_daily_actions:{...TOOLS.list_daily_actions,fields:{...TOOLS.list_daily_actions.fields,limit:integer(1,10)}},
  list_preparations:{...TOOLS.list_preparations,fields:{...TOOLS.list_preparations.fields,limit:integer(1,1),topicId:optional(TOOLS.create_task.fields.id),notesOffset:optional(integer(0,4000))}},
  search_inbox:{...TOOLS.search_inbox,fields:{...TOOLS.search_inbox.fields,limit:integer(1,25)}},
  list_prices:{...TOOLS.list_prices,fields:{...TOOLS.list_prices.fields,limit:integer(1,1)}},
  list_projects:{...TOOLS.list_projects,fields:{...TOOLS.list_projects.fields,id:optional(field(projectUuid,{type:'string',format:'uuid'}))}},
  create_task:{...TOOLS.create_task,fields:{...taskCreateFields,expectedVersion:version,...recurrenceFields,
    templateId:optional(field(v=>manualId(v)&&v.length<=80,{type:'string',maxLength:80})),sourceDate:optional(field(validDate,DATE_SCHEMA))}},
  update_task:{...TOOLS.update_task,fields:{...TOOLS.update_task.fields,...recurrenceFields},patch:[...TOOLS.update_task.patch,...Object.keys(recurrenceFields)]},
  create_calendar_event:{...TOOLS.create_calendar_event,fields:{...TOOLS.create_calendar_event.fields,...scopedCalendar}},
  update_calendar_event:{...TOOLS.update_calendar_event,fields:{...TOOLS.update_calendar_event.fields,...scopedCalendar}},
  cancel_calendar_event:{...TOOLS.cancel_calendar_event,fields:{...TOOLS.cancel_calendar_event.fields,scope:scopedCalendar.scope,recurrenceId:scopedCalendar.recurrenceId}},
  create_project:{...TOOLS.create_project,fields:{...TOOLS.create_project.fields,...planning}},
  create_assignment:{...TOOLS.create_assignment,fields:{...TOOLS.create_assignment.fields,...planning}},
  update_project:{...TOOLS.update_project,fields:{...TOOLS.update_project.fields,...Object.fromEntries(Object.entries(planning).map(([k,v])=>[k,optional(v)])),deadline:optional(clearableDeadline)},patch:['title','description','deadline','category','importance','remainingMinutes','progress']},
}
for(const name of Object.keys(SERVICE_TOOLS) as ToolName[]){
  const definition=SERVICE_TOOLS[name]
  if(!definition.write)continue
  const fields={...definition.fields}
  if(name.includes('task'))fields.id=field(manualId,{type:'string',pattern:'^[A-Za-z0-9_.-]{1,100}$(?![\\s\\S])',minLength:1,maxLength:100})
  if(name.includes('project')||name==='create_assignment'||name==='create_calendar_event')fields.id=field(projectUuid,{type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\\s\\S])',minLength:36,maxLength:36})
  if(fields.expectedVersion)fields.expectedVersion=name==='create_task'?version:integer(1,2147483646)
  SERVICE_TOOLS[name]={...definition,fields}
}

export function validateServiceArguments(tool:unknown,input:unknown):{valid:true;args:Arguments}|{valid:false;code:'invalid_arguments'|'unsupported_linkage'|'unsupported_recurrence'} {
  if(!isTool(tool)||!plainRecord(input))return {valid:false,code:'invalid_arguments'}
  if(tool.includes('task')&&Object.hasOwn(input,'projectId'))return {valid:false,code:'unsupported_linkage'}
  if(TOOLS[tool].write&&['recurrence','rdate','exdate','seriesId',...(!tool.includes('calendar_event')?['recurrenceId','rrule']:[])].some(k=>Object.hasOwn(input,k)))return {valid:false,code:'unsupported_recurrence'}
  if(TOOLS[tool].write&&tool.includes('calendar_event')&&!['single','series'].includes(String(input.scope)))return {valid:false,code:'unsupported_recurrence'}
  const definition=SERVICE_TOOLS[tool]
  if(!matches(input,definition.fields)||definition.patch&&!definition.patch.some(k=>Object.hasOwn(input,k)))return {valid:false,code:'invalid_arguments'}
  if(tool.includes('task')&&TOOLS[tool].write&&!manualId(input.id))return {valid:false,code:'invalid_arguments'}
  if(tool.includes('project')&&TOOLS[tool].write||tool==='create_assignment'){
    if(!projectUuid(input.id))return {valid:false,code:'invalid_arguments'}
  }
  if(tool==='create_calendar_event'&&!projectUuid(input.id))return {valid:false,code:'invalid_arguments'}
  if((['create_daily_action','update_daily_action'].includes(tool)||tool.includes('preparation')&&TOOLS[tool].write)&&(!projectUuid(input.id)||input.projectId!==undefined&&!projectUuid(input.projectId)))return {valid:false,code:'invalid_arguments'}
  if(['list_daily_actions','list_preparations'].includes(tool)&&input.id!==undefined&&!projectUuid(input.id))return {valid:false,code:'invalid_arguments'}
  if(tool==='list_preparations'){
    if(input.topicId!==undefined&&input.id===undefined||input.notesOffset!==undefined&&(input.id===undefined||input.topicId===undefined))return {valid:false,code:'invalid_arguments'}
    return {valid:true,args:{...input} as Arguments}
  }
  if(input.expectedVersion!==undefined&&!version.check(input.expectedVersion))return {valid:false,code:'invalid_arguments'}
  if(tool==='control_focus_timer'){
    if(input.phase!==undefined&&input.action!=='start'||['focusMinutes','breakMinutes'].some(k=>input[k]!==undefined)&&input.action!=='configure'||input.action==='configure'&&input.focusMinutes===undefined&&input.breakMinutes===undefined)return {valid:false,code:'invalid_arguments'}
  }
  if(tool==='edit_focus_queue'){
    const fields=input.action==='add'?['name','minutes']:input.action==='remove'?['miniId']:['miniId','beforeId']
    if(fields.some(k=>input[k]===undefined)||['name','minutes','miniId','beforeId'].some(k=>input[k]!==undefined&&!fields.includes(k)))return {valid:false,code:'invalid_arguments'}
  }
  if(tool==='list_projects')return input.id!==undefined&&input.offset!==undefined&&input.offset!==0?{valid:false,code:'invalid_arguments'}:{valid:true,args:{...input} as Arguments}
  if(TOOLS[tool].write&&tool.includes('calendar_event')){
    if(input.scope==='series'&&input.recurrenceId!==undefined||input.scope==='single'&&['rrule','rdates','exdates','clearRecurrence','exceptionPolicy'].some(k=>input[k]!==undefined)||tool==='create_calendar_event'&&input.recurrenceId!==undefined||tool==='create_calendar_event'&&input.scope==='series'&&input.rrule===undefined&&!(Array.isArray(input.rdates)&&input.rdates.length))return {valid:false,code:'unsupported_recurrence'}
    if(input.timezone!==undefined&&(tool!=='create_calendar_event'||input.allDay===true||input.timezoneSourceEventId===undefined)||input.timezoneSourceEventId!==undefined&&input.timezone===undefined)return {valid:false,code:'unsupported_recurrence'}
    if(input.clearRecurrence===true&&(tool!=='update_calendar_event'||['rrule','rdates','exdates'].some(k=>input[k]!==undefined))||input.exceptionPolicy!==undefined&&input.clearRecurrence!==true)return {valid:false,code:'unsupported_recurrence'}
    if(typeof input.rrule==='string'){
      const until=input.rrule.split(';').find(part=>part.startsWith('UNTIL='))?.slice(6)
      if(until!==undefined&&(input.allDay===true?until.length!==8:until.length!==16))return {valid:false,code:'unsupported_recurrence'}
    }
    for(const key of ['rdates','exdates'])if(Array.isArray(input[key])&&!(input[key] as unknown[]).every(input.allDay===true?validDate:validInstant))return {valid:false,code:'invalid_arguments'}
    const {rrule:_rrule,recurrenceId:_rid,timezone:_zone,timezoneSourceEventId:_source,clearRecurrence:_clear,exceptionPolicy:_policy,rdates:_rd,exdates:_ed,...base}=input
    const checked=validateArguments(tool,{...base,scope:'single'})
    return checked.valid?{valid:true,args:{...input} as Arguments}:checked
  }
  if(tool==='update_project'||tool==='create_project'||tool==='create_assignment')return {valid:true,args:{...input} as Arguments}
  if(tool==='create_task'){
    const {expectedVersion:_version,recurrenceFrequency,recurrenceWeekday,recurrenceStartDate,recurrencePaused,templateId,sourceDate,...base}=input
    if((templateId===undefined)!==(sourceDate===undefined)||templateId!==undefined&&(recurrenceFrequency!==undefined||input.id!==`occ.${templateId}.${sourceDate}`||input.date!==sourceDate))return {valid:false,code:'invalid_arguments'}
    if([recurrenceFrequency,recurrenceWeekday,recurrenceStartDate,recurrencePaused].some(v=>v!==undefined)&&
      (recurrenceFrequency!=='weekly'||recurrenceWeekday===undefined||recurrenceStartDate===undefined))return {valid:false,code:'invalid_arguments'}
    const validated=validateArguments(tool,base)
    return validated.valid?{valid:true,args:{...input} as Arguments}:validated
  }
  if(tool==='update_task')return {valid:true,args:{...input} as Arguments}
  return validateArguments(tool,input)
}

const exact=(value:unknown,keys:string[])=>plainRecord(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))
// Service projections differ intentionally from the synthetic product: collection
// task versions, real project enum/fields, and recurrence unknown on cached events.
export function validServiceResult(command:Command,value:unknown):value is Result {
  if(!plainRecord(value))return false
  if(command.tool==='request_clarification')return validResult(command,value)
  if(command.tool==='get_focus_timer'&&value.state==='ok')return exact(value,['state','data'])&&validTimerSnapshot(value.data)
  if(value.state==='saved')return TOOLS[command.tool].write&&command.tool.includes('calendar_event')&&validSavedResult(value,String(command.args.operationKey))
  if(command.tool==='get_operation_status'&&value.state==='ok'&&plainRecord(value.data)&&value.data.status==='saved')return exact(value,['state','data'])&&exact(value.data,['operationKey','status','result'])&&value.data.operationKey===command.args.operationKey&&validSavedResult(value.data.result,String(command.args.operationKey))
  if(value.state!=='ok'&&value.state!=='applied')return validResult(command,value)
  if(value.state==='applied')return TOOLS[command.tool].write&&!command.tool.includes('calendar_event')&&exact(value,['state','id','version'])&&value.id===command.args.id&&typeof value.version==='number'&&Number.isInteger(value.version)&&value.version>=1&&value.version<=2147483647&&(command.args.expectedVersion===undefined||value.version>=Number(command.args.expectedVersion))
  if((EXTENDED_READS as readonly string[]).includes(command.tool))return exact(value,['state','data'])&&value.state==='ok'&&validExtendedRead(command.tool,command.args,value.data)
  if(command.tool==='get_operation_status')return validResult(command,value)
  if(TOOLS[command.tool].write||!exact(value,['state','data'])||!exact(value.data,command.tool==='list_tasks'?['items','nextOffset','collectionVersion']:['items','nextOffset']))return false
  const data=value.data as {items:unknown;nextOffset:unknown;collectionVersion?:unknown}
  if(command.tool==='list_tasks'&&(!Number.isInteger(data.collectionVersion)||Number(data.collectionVersion)<0||Number(data.collectionVersion)>2147483647))return false
  if(!Array.isArray(data.items)||data.items.length>Number(command.args.limit)||Reflect.ownKeys(data.items).length!==data.items.length+1||!Array.from({length:data.items.length},(_,i)=>Object.getOwnPropertyDescriptor(data.items,String(i))).every(d=>d?.enumerable&&Object.hasOwn(d,'value')))return false
  if(data.nextOffset!==null&&(!Number.isInteger(data.nextOffset)||Number(data.nextOffset)>10000||data.items.length===0||data.nextOffset!==Number(command.args.offset??0)+data.items.length))return false
  const seen=new Set<string>()
  return data.items.every(item=>{
    if(!plainRecord(item)||typeof item.id!=='string'||seen.has(item.id))return false
    seen.add(item.id)
    if(command.tool==='list_projects'){
      if(!exact(item,['id','title','description','deadline','kind','status','category','importance','remainingMinutes','progress','version'])||!projectUuid(item.id)||typeof item.status!=='string'||!['active','complete','archived'].includes(item.status))return false
      const {version:v,kind,status,deadline,...fields}=item
      const definition=kind==='assignment'?SERVICE_TOOLS.create_assignment:SERVICE_TOOLS.create_project
      return typeof kind==='string'&&['project','assignment'].includes(kind)&&typeof v==='number'&&v>=1&&v<=2147483647&&Number.isInteger(v)&&matches({operationKey:'projection_key_0001',...fields,...(deadline===''?{}:{deadline})},definition.fields)
    }
    if(command.tool==='list_tasks'){
      if(!exact(item,['id','title','date','notes','important','completed','deleted','recurring','version',...(item.recurrence!==undefined?['recurrence']:[])])||typeof item.recurring!=='boolean')return false
      const {recurring:_recurring,recurrence,...base}=item
      if(!manualId(item.id)||!validEntity('task',base)||item.version!==data.collectionVersion||String(item.date)<String(command.args.from)||String(item.date)>=String(command.args.to))return false
      // The projection validator establishes the scalar contract; explicit field
      // narrowing establishes the structural ManualTask contract for recurrence.
      if(typeof base.id!=='string'||typeof base.title!=='string'||typeof base.date!=='string'||typeof base.notes!=='string'||typeof base.completed!=='boolean')return false
      return recurrence===undefined||validManualTask({id:base.id,title:base.title,date:base.date,notes:base.notes,completed:base.completed,recurrence})
    }
    if(command.tool==='list_calendar_events'){
      if(item.recurring!==null&&typeof item.recurring!=='boolean')return false
      const {recurrenceId,...base}=item
      if(recurrenceId!==undefined&&recurrenceId!==null&&!scopedCalendar.recurrenceId.check(recurrenceId))return false
      return validResult(command,{state:'ok',data:{items:[{...base,recurring:item.recurring??false}],nextOffset:null}})
    }
    return validEntity('calendar',item)
  })
}

function validSavedResult(value:unknown,key:string){
  if(!exact(value,['state','operationKey','mutationId','confirmation','readback','providerEtag']))return false
  const r=value as Record<string,unknown>
  return r.state==='saved'&&r.operationKey===key&&projectUuid(r.mutationId)&&r.confirmation==='snapshot_pending'&&(r.readback==='verified'||r.readback==='pending')&&(r.providerEtag===null||typeof r.providerEtag==='string'&&/^"[\x21\x23-\x7e]{1,128}"$(?![\s\S])/.test(r.providerEtag))
}

const dailyActionReadDescription='List daily actions within the explicit date window (exclusive end), bounded pages. Optional id is the exact ACTION ID, never a parent/project ID. There is no project filter argument: omit id and match returned projectId when finding a project\'s children. An empty wrong-id read does not resolve a supplied child target; check the supplied action ID or page the requested date window without that filter before concluding it is missing.'
export function serviceToolDefinitions():Tool[] {
  return (Object.keys(SERVICE_TOOLS) as ToolName[]).map((name):Tool=>{
    const projectWrite=TOOLS[name].write&&(name.includes('project')||name==='create_assignment')
    const schema=schemaForDefinition(name,SERVICE_TOOLS[name])
    schema.description='DCC service contract: standalone task expectedVersion is the whole collection version (create requires zero or current version). Projects use real planner fields/status; mutations queue planning. Source calendar recurrence must be authoritative, never a caller claim. Actor binding is trusted-source-only, not an argument.'
    if(name==='create_task')Object.assign(schema.properties?.expectedVersion??{},{description:'Expected version of the entire manual-tasks collection, including zero for absent collection.'})
    if(name==='list_daily_actions'){
      schema.description+=' '+dailyActionReadDescription
      Object.assign(schema.properties?.id??{},{description:'Optional exact daily ACTION ID (UUID), NOT its parent/project ID. Omit to page the explicit date window and match returned projectId. An empty result for a parent ID says nothing about its children.'})
    }
    if(name==='request_clarification')schema.description+=' Request an exact server-generated question for missing calendar/duration/event time, ambiguous project/calendar/relative date, or a DST gap/fold. Supply only the matching reason, never question/success prose. At most three unique questions per invocation; stop writing after asking. Questions do not establish effects or resolve uncertain receipts. The user answers by editing a fresh intent.'
    if(name==='list_calendars')schema.description+=' writable reflects the configured guarded writer, not a guarantee that the provider will permit a write.'
    if(name==='list_preparations')schema.description+=' One plan/page. Topic notes are 512-character slices with nextNotesOffset; use exact plan id, topicId and notesOffset for later slices. Do not overwrite unseen text.'
    if(['get_focus_timer','control_focus_timer','edit_focus_queue'].includes(name))schema.description+=' Originating browser tab only. Read get_focus_timer for expectedVersion before writes. Browser ACK is required; unavailable/uncertain is never a claimed start. control actions start/pause/resume/reset/configure preserve elapsed progress unless reset is explicit; phase selects focus/break only on start. edit_focus_queue add requires name/minutes; remove requires miniId; move requires miniId/beforeId and a reset/idle queue. No generic frontend code or backend timer session.'
    return {name,inputSchema:schema,description:projectWrite?'DCC project/assignment mutation: queues planning in planner_runs; background workers may generate/reschedule actions. Archive persists status=archived; restore sets active. Explicit category, importance and remainingMinutes are required on create.':name.includes('task')?'DCC standalone manual checklist collection. expectedVersion is the COLLECTION version. Weekly templates use recurrenceFrequency, recurrenceWeekday, recurrenceStartDate and recurrencePaused. Occurrence IDs/source metadata remain immutable; complete/reopen changes only completion, remove/skip retains a tombstone. No generated actions or project linkage.':name.includes('calendar_event')?'DCC guarded calendar mutation. Scope must be explicit. Read get_calendar_series before series edits; rdates/exdates replace complete lists with dates or UTC instants matching allDay. Recurring date-type conversion rejects. clearRecurrence rejects exceptions unless exceptionPolicy=discard explicitly authorizes removing them. New named timezone requires timezoneSourceEventId in this calendar with that VTIMEZONE; no arbitrary zone definitions. Conditional ETags and immutable retries; saved means snapshot_pending, not refreshed identity.':name.includes('preparation')?'DCC versioned preparation operations. Read plan/topics before changes. Create links exact cached calendarId/eventId and includes one initial topic (topicTitle/topicNotes/topicMinutes); insert generates a new topic ID and optionally accepts zero-based position. Remove retains history and requires at least one remaining topic. Relink preserves topics and history. All mutations queue planning atomically; no helper inference grants.':'DCC bounded safe projection; operation receipts are actor-scoped but this is not authentication or data isolation. Calendar saved status includes completion without provider reads.',annotations:{readOnlyHint:!TOOLS[name].write,destructiveHint:TOOLS[name].write,openWorldHint:true},execution:{taskSupport:'forbidden'}}
  }).map(tool=>tool.name==='list_daily_actions'?{...tool,description:dailyActionReadDescription}:tool)
}
