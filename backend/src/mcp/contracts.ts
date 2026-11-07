// Offline domain contracts and shared field-schema metadata. No runtime routes.
import {CLARIFICATION_QUESTIONS,validClarification} from './clarification.js'
export type Scalar=string|number|boolean|string[]
export type Arguments=Record<string,Scalar>
export type Rule={check:(value:unknown)=>boolean;schema:Record<string,unknown>;optional?:true}
const rule=(check:Rule['check'],schema:Record<string,unknown>={}):Rule=>({check,schema})
const optional=(field:Rule):Rule=>({...field,optional:true})
const text=(max:number,nonempty=false)=>rule(v=>typeof v==='string'&&v.length<=max&&(!nonempty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),{
  type:'string',maxLength:max,allOf:[{pattern:'^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$'},...(nonempty?[{pattern:'\\S'}]:[])],
})
const integer=(min:number,max=Number.MAX_SAFE_INTEGER)=>rule(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max,{type:'integer',minimum:min,maximum:max})
const boolean=rule(v=>typeof v==='boolean',{type:'boolean'})
const enumeration=(...values:string[])=>rule(v=>typeof v==='string'&&values.includes(v),{type:'string',enum:values})
const patterned=(pattern:RegExp,minLength:number,maxLength:number)=>{
  // JS `$` alone also matches before a final newline; opaque tokens must not.
  const exact=new RegExp(`(?:${pattern.source})(?![\\s\\S])`)
  return rule(v=>typeof v==='string'&&exact.test(v),{type:'string',pattern:exact.source,minLength,maxLength})
}
const id=patterned(/^[A-Za-z0-9][A-Za-z0-9._@+%=-]{0,199}$/,1,200)
const operationKey=patterned(/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/,16,80)
const etag=patterned(/^"[\x21\x23-\x7e]{1,128}"$/,3,130)
const DAY=86400000
export const LIMITS={minYear:2000,maxYear:2100,page:100,offset:10000,taskWindowDays:93,eventWindowDays:31} as const
export function validDate(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value
}
export function validInstant(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)&&validDate(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().replace('.000Z','Z')===value
}
export const DATE_SCHEMA={type:'string',format:'date',pattern:'^(?:20\\d{2}|2100)-\\d{2}-\\d{2}$',minLength:10,maxLength:10}
export const INSTANT_SCHEMA={type:'string',format:'date-time',pattern:'^(?:20\\d{2}|2100)-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\dZ$',minLength:20,maxLength:20}
const date=rule(validDate,DATE_SCHEMA),instant=rule(validInstant,INSTANT_SCHEMA)
const time=rule(v=>validDate(v)||validInstant(v),{anyOf:[DATE_SCHEMA,INSTANT_SCHEMA]})
const revision=integer(1)
const title=text(240,true),notes=text(4000),description=text(12000)
const page={limit:integer(1,LIMITS.page),offset:optional(integer(0,LIMITS.offset))}
const write={operationKey}
const edit={...write,id,expectedVersion:revision}
const taskFields={title,date,notes:optional(notes),important:optional(boolean)}
const projectFields={title,description:optional(description),deadline:optional(date)}
const eventFields={title,start:time,end:time,allDay:boolean,description:optional(description),location:optional(text(1000))}
const eventEdit={...write,calendarId:id,eventId:id,expectedEtag:etag,scope:enumeration('single')}
export type Definition={write:boolean;capability:string;fields:Record<string,Rule>;patch?:readonly string[]}
export const TOOLS={
  request_clarification:{write:false,capability:'clarification:request',fields:{reason:enumeration(...Object.keys(CLARIFICATION_QUESTIONS))}},
  list_calendars:{write:false,capability:'calendars:read',fields:page},
  list_calendar_events:{write:false,capability:'calendars:read',fields:{...page,calendarId:id,from:instant,to:instant}},
  list_tasks:{write:false,capability:'tasks:read',fields:{...page,from:date,to:date}},
  list_projects:{write:false,capability:'projects:read',fields:page},
  get_operation_status:{write:false,capability:'operations:read',fields:{operationKey}},
  create_task:{write:true,capability:'tasks:write',fields:{...write,id,...taskFields,projectId:optional(id)}},
  update_task:{write:true,capability:'tasks:write',fields:{...edit,title:optional(title),date:optional(date),notes:optional(notes),important:optional(boolean)},patch:['title','date','notes','important']},
  set_task_completed:{write:true,capability:'tasks:write',fields:{...edit,completed:boolean}},
  remove_task:{write:true,capability:'tasks:write',fields:edit},
  create_project:{write:true,capability:'projects:write',fields:{...write,id,...projectFields}},
  create_assignment:{write:true,capability:'projects:write',fields:{...write,id,...projectFields,deadline:date}},
  update_project:{write:true,capability:'projects:write',fields:{...edit,title:optional(title),description:optional(description),deadline:optional(date)},patch:['title','description','deadline']},
  set_project_status:{write:true,capability:'projects:write',fields:{...edit,status:enumeration('active','complete')}},
  archive_project:{write:true,capability:'projects:write',fields:edit},
  restore_project:{write:true,capability:'projects:write',fields:edit},
  create_calendar_event:{write:true,capability:'calendars:write',fields:{...write,id,calendarId:id,scope:enumeration('single'),...eventFields}},
  update_calendar_event:{write:true,capability:'calendars:write',fields:{...eventEdit,...eventFields}},
  cancel_calendar_event:{write:true,capability:'calendars:write',fields:eventEdit},
  list_daily_actions:{write:false,capability:'planner:read',fields:{...page,id:optional(id),from:date,to:date}},
  create_daily_action:{write:true,capability:'planner:write',fields:{...write,id,projectId:id,title,date,notes,minutes:integer(5,180)}},
  update_daily_action:{write:true,capability:'planner:write',fields:{...edit,title:optional(title),notes:optional(notes),minutes:optional(integer(5,180)),date:optional(date),completed:optional(boolean),dismissed:optional(boolean),feedback:optional(enumeration('','comfortable','review'))},patch:['title','notes','minutes','date','completed','dismissed','feedback']},
  list_preparations:{write:false,capability:'planner:read',fields:{...page,id:optional(id)}},
  update_preparation:{write:true,capability:'planner:write',fields:{...edit,title:optional(title),startDate:optional(date),status:optional(enumeration('active','paused')),progress:optional(notes)},patch:['title','startDate','status','progress']},
  update_preparation_topic:{write:true,capability:'planner:write',fields:{...edit,topicId:id,title:optional(title),notes:optional(notes),minutes:optional(integer(5,1800))},patch:['title','notes','minutes']},
  create_preparation:{write:true,capability:'planner:write',fields:{...write,id,calendarId:id,eventId:id,title,startDate:date,progress:notes,topicTitle:title,topicNotes:notes,topicMinutes:integer(5,1800)}},
  relink_preparation:{write:true,capability:'planner:write',fields:{...edit,calendarId:id,eventId:id}},
  insert_preparation_topic:{write:true,capability:'planner:write',fields:{...edit,title,notes,minutes:integer(5,1800),position:optional(integer(0,60))}},
  remove_preparation_topic:{write:true,capability:'planner:write',fields:{...edit,topicId:id}},
  search_inbox:{write:false,capability:'inbox:read',fields:{...page,query:text(200),account:enumeration('all','personal','school','work'),importantOnly:boolean}},
  get_inbox_message:{write:false,capability:'inbox:read',fields:{id,offset:integer(0,1000000),limit:integer(1,10000)}},
  // Historical journal decoder ONLY. Never an active tool/schema/capability.
  list_prices:{write:false,capability:'prices:read',fields:page},
  get_calendar_series:{write:false,capability:'calendars:read',fields:{calendarId:id,eventId:id}},
  get_focus_timer:{write:false,capability:'timer:read',fields:{}},
  control_focus_timer:{write:true,capability:'timer:write',fields:{...edit,action:enumeration('start','pause','resume','reset','configure'),phase:optional(enumeration('focus','break')),focusMinutes:optional(integer(1,180)),breakMinutes:optional(integer(1,60))}},
  edit_focus_queue:{write:true,capability:'timer:write',fields:{...edit,action:enumeration('add','remove','move'),miniId:optional(id),beforeId:optional(id),name:optional(text(240,true)),minutes:optional(integer(1,120))}},
} satisfies Record<string,Definition>
export type ToolName=keyof typeof TOOLS
export const ACTIVE_TOOLS=Object.freeze((Object.keys(TOOLS) as ToolName[]).filter(name=>name!=='list_prices'))
export function isActiveTool(value:unknown):value is ToolName{return isTool(value)&&value!=='list_prices'}
export type Command={tool:ToolName;args:Arguments}
export function isTool(value:unknown):value is ToolName {return typeof value==='string'&&Object.hasOwn(TOOLS,value)}
export const isCreation=(tool:ToolName)=>['create_task','create_project','create_assignment','create_calendar_event','create_daily_action','create_preparation','control_focus_timer','edit_focus_queue'].includes(tool)

// Never invoke accessors or accept inherited/symbol/non-enumerable payload fields.
export function plainRecord(value:unknown):value is Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const prototype=Object.getPrototypeOf(value)
  return (prototype===null||prototype===Object.prototype)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.getOwnPropertyDescriptor(value,key)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'))
}
export function matches(value:unknown,fields:Record<string,Rule>):value is Record<string,unknown> {
  return plainRecord(value)&&Object.keys(value).every(key=>Object.hasOwn(fields,key))&&Object.entries(fields).every(([key,field])=>Object.hasOwn(value,key)?field.check(value[key]):field.optional===true)
}
function densePage(value:unknown):value is unknown[] {
  return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=LIMITS.page&&Reflect.ownKeys(value).length===value.length+1&&Array.from({length:value.length},(_,index)=>Object.getOwnPropertyDescriptor(value,String(index))).every(field=>field?.enumerable&&Object.hasOwn(field,'value'))
}
function interval(from:Scalar|undefined,to:Scalar|undefined,maxDays:number){
  return typeof from==='string'&&typeof to==='string'&&Date.parse(to)>Date.parse(from)&&Date.parse(to)-Date.parse(from)<=maxDays*DAY
}
export type Validation={valid:true;args:Arguments}|{valid:false;code:'invalid_arguments'|'unsupported_recurrence'}
export function validateArguments(name:string,value:unknown,historical=false):Validation {
  if(!isTool(name)||!plainRecord(value))return {valid:false,code:'invalid_arguments'}
  if(name==='list_prices'&&!historical)return {valid:false,code:'invalid_arguments'}
  const definition:Definition=TOOLS[name]
  if(definition.write&&(['recurrence','recurrenceId','rrule','rdate','exdate','seriesId'].some(key=>Object.hasOwn(value,key))||name.includes('calendar_event')&&value.scope!=='single'))return {valid:false,code:'unsupported_recurrence'}
  if(!matches(value,definition.fields))return {valid:false,code:'invalid_arguments'}
  const args={...value} as Arguments
  if(definition.patch&&!definition.patch.some(key=>Object.hasOwn(args,key)))return {valid:false,code:'invalid_arguments'}
  if((name==='list_tasks'||name==='list_daily_actions')&&!interval(args.from,args.to,LIMITS.taskWindowDays))return {valid:false,code:'invalid_arguments'}
  if(name==='list_calendar_events'&&!interval(args.from,args.to,LIMITS.eventWindowDays))return {valid:false,code:'invalid_arguments'}
  if(name==='create_calendar_event'||name==='update_calendar_event'){
    const check=args.allDay?validDate:validInstant
    if(!check(args.start)||!check(args.end)||!interval(args.start,args.end,LIMITS.eventWindowDays))return {valid:false,code:'invalid_arguments'}
  }
  return {valid:true,args}
}

export const CODES=['forbidden','unknown_tool','invalid_arguments','unsupported_recurrence','transport_unconfigured','transport_failure','operation_capacity','not_found','revision_mismatch','already_exists','operation_key_mismatch','deleted','archived','parent_unavailable','calendar_read_only','unsupported_linkage','recurrence_unverified','cache_unavailable'] as const
export type Code=typeof CODES[number]
export type Result=
  |{state:'ok';data:unknown}
  |{state:'applied';id:string;version:number}
  |{state:'applied';id:string;etag:string}
  |{state:'rejected';code:Code}
  |{state:'conflict';code:Code}
  |{state:'uncertain';operationKey:string}
  |{state:'saved';operationKey:string;mutationId:string;confirmation:'snapshot_pending';readback:'verified'|'pending';providerEtag:string|null}
export type OperationState='unknown'|'applied'|'rejected'|'conflict'|'uncertain'|'saved'
export const recordFields={
  calendar:{id,name:text(240,true),writable:boolean},
  task:{id,...taskFields,notes,important:boolean,projectId:optional(id),completed:boolean,deleted:boolean,version:revision},
  project:{id,...projectFields,description,kind:enumeration('project','assignment'),status:enumeration('active','complete'),archived:boolean,version:revision},
  event:{id,calendarId:id,...eventFields,description,location:text(1000),cancelled:boolean,recurring:boolean,etag},
}
export function validEntity(kind:keyof typeof recordFields,value:unknown):value is Arguments {
  if(!matches(value,recordFields[kind]))return false
  if(kind==='project'&&value.kind==='assignment'&&!validDate(value.deadline))return false
  if(kind==='event'){
    const check=value.allDay?validDate:validInstant
    return check(value.start)&&check(value.end)&&Date.parse(value.end)>Date.parse(value.start)
  }
  return true
}

// Transport replies are untrusted: no raw backend objects, URLs, credentials or errors escape.
export function validResult(command:Command,value:unknown):value is Result {
  if(!plainRecord(value))return false
  const {tool,args}=command,writing=TOOLS[tool].write
  if(value.state==='rejected'||value.state==='conflict')return matches(value,{state:enumeration('rejected','conflict'),code:enumeration(...CODES)})
  if(value.state==='uncertain')return writing&&matches(value,{state:enumeration('uncertain'),operationKey})&&value.operationKey===args.operationKey
  if(value.state==='applied'){
    if(!writing||value.id!==(args.eventId??args.id))return false
    return tool.includes('calendar_event')?matches(value,{state:enumeration('applied'),id,etag}):matches(value,{state:enumeration('applied'),id,version:revision})&&(args.expectedVersion===undefined||Number(value.version)>Number(args.expectedVersion))
  }
  if(writing||!matches(value,{state:enumeration('ok'),data:rule(()=>true)}))return false
  const data=value.data
  if(tool==='request_clarification')return validClarification(data)&&data.reason===args.reason
  if(tool==='get_operation_status')return matches(data,{operationKey,status:enumeration('unknown','applied','rejected','conflict','uncertain')})&&data.operationKey===args.operationKey
  if(!matches(data,{items:rule(densePage),nextOffset:rule(v=>v===null||integer(0,LIMITS.offset).check(v))}))return false
  const items=data.items as unknown[]
  if(items.length>Number(args.limit)||data.nextOffset!==null&&(items.length===0||data.nextOffset!==Number(args.offset??0)+items.length))return false
  const kind=tool==='list_tasks'?'task':tool==='list_projects'?'project':tool==='list_calendars'?'calendar':'event'
  const ids=new Set<string>()
  return items.every(item=>{
    if(!validEntity(kind,item)||ids.has(String(item.id)))return false
    ids.add(String(item.id))
    if(tool==='list_tasks')return String(item.date)>=String(args.from)&&String(item.date)<String(args.to)
    if(tool==='list_calendar_events')return item.calendarId===args.calendarId&&Date.parse(String(item.start))<Date.parse(String(args.to))&&Date.parse(String(item.end))>Date.parse(String(args.from))
    return true
  })
}
