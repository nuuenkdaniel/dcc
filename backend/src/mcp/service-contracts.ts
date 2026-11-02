import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import {TOOLS,isTool,matches,plainRecord,validateArguments,validResult,validEntity,validDate,DATE_SCHEMA,type Arguments,type Command,type Definition,type Result,type Rule,type ToolName} from './contracts.js'
import {schemaForDefinition} from './schemas.js'

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
export const SERVICE_TOOLS:Record<ToolName,Definition>={...TOOLS,
  create_task:{...TOOLS.create_task,fields:{...taskCreateFields,expectedVersion:version}},
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
  if(TOOLS[tool].write&&['recurrence','recurrenceId','rrule','rdate','exdate','seriesId'].some(k=>Object.hasOwn(input,k)))return {valid:false,code:'unsupported_recurrence'}
  if(TOOLS[tool].write&&tool.includes('calendar_event')&&input.scope!=='single')return {valid:false,code:'unsupported_recurrence'}
  const definition=SERVICE_TOOLS[tool]
  if(!matches(input,definition.fields)||definition.patch&&!definition.patch.some(k=>Object.hasOwn(input,k)))return {valid:false,code:'invalid_arguments'}
  if(tool.includes('task')&&TOOLS[tool].write&&!manualId(input.id))return {valid:false,code:'invalid_arguments'}
  if(tool.includes('project')&&TOOLS[tool].write||tool==='create_assignment'){
    if(!projectUuid(input.id))return {valid:false,code:'invalid_arguments'}
  }
  if(tool==='create_calendar_event'&&!projectUuid(input.id))return {valid:false,code:'invalid_arguments'}
  if(input.expectedVersion!==undefined&&!version.check(input.expectedVersion))return {valid:false,code:'invalid_arguments'}
  if(tool==='update_project'||tool==='create_project'||tool==='create_assignment')return {valid:true,args:{...input} as Arguments}
  if(tool==='create_task'){
    const {expectedVersion:_version,...base}=input
    const validated=validateArguments(tool,base)
    return validated.valid?{valid:true,args:{...input} as Arguments}:validated
  }
  return validateArguments(tool,input)
}

const exact=(value:unknown,keys:string[])=>plainRecord(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))
// Service projections differ intentionally from the synthetic product: collection
// task versions, real project enum/fields, and recurrence unknown on cached events.
export function validServiceResult(command:Command,value:unknown):value is Result {
  if(!plainRecord(value))return false
  if(value.state==='saved')return TOOLS[command.tool].write&&command.tool.includes('calendar_event')&&validSavedResult(value,String(command.args.operationKey))
  if(command.tool==='get_operation_status'&&value.state==='ok'&&plainRecord(value.data)&&value.data.status==='saved')return exact(value,['state','data'])&&exact(value.data,['operationKey','status','result'])&&value.data.operationKey===command.args.operationKey&&validSavedResult(value.data.result,String(command.args.operationKey))
  if(value.state!=='ok'&&value.state!=='applied')return validResult(command,value)
  if(value.state==='applied')return TOOLS[command.tool].write&&!command.tool.includes('calendar_event')&&exact(value,['state','id','version'])&&value.id===command.args.id&&typeof value.version==='number'&&Number.isInteger(value.version)&&value.version>=1&&value.version<=2147483647&&(command.args.expectedVersion===undefined||value.version>=Number(command.args.expectedVersion))
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
      if(!exact(item,['id','title','date','notes','important','completed','deleted','recurring','version'])||typeof item.recurring!=='boolean')return false
      const {recurring:_recurring,...base}=item
      return manualId(item.id)&&validEntity('task',base)&&item.version===data.collectionVersion&&String(item.date)>=String(command.args.from)&&String(item.date)<String(command.args.to)
    }
    if(command.tool==='list_calendar_events'){
      if(item.recurring!==null&&typeof item.recurring!=='boolean')return false
      return validResult(command,{state:'ok',data:{items:[{...item,recurring:item.recurring??false}],nextOffset:null}})
    }
    return validEntity('calendar',item)
  })
}

function validSavedResult(value:unknown,key:string){
  if(!exact(value,['state','operationKey','mutationId','confirmation','readback','providerEtag']))return false
  const r=value as Record<string,unknown>
  return r.state==='saved'&&r.operationKey===key&&projectUuid(r.mutationId)&&r.confirmation==='snapshot_pending'&&(r.readback==='verified'||r.readback==='pending')&&(r.providerEtag===null||typeof r.providerEtag==='string'&&/^"[\x21\x23-\x7e]{1,128}"$(?![\s\S])/.test(r.providerEtag))
}

export function serviceToolDefinitions():Tool[] {
  return (Object.keys(SERVICE_TOOLS) as ToolName[]).map(name=>{
    const projectWrite=TOOLS[name].write&&(name.includes('project')||name==='create_assignment')
    const schema=schemaForDefinition(name,SERVICE_TOOLS[name])
    schema.description='DCC service contract: standalone task expectedVersion is the whole collection version (create requires zero or current version). Projects use real planner fields/status; mutations queue planning. Source calendar recurrence must be authoritative, never a caller claim. Actor binding is trusted-source-only, not an argument.'
    if(name==='create_task')Object.assign(schema.properties?.expectedVersion??{},{description:'Expected version of the entire manual-tasks collection, including zero for absent collection.'})
    return {name,inputSchema:schema,description:projectWrite?'DCC project/assignment mutation: queues planning in planner_runs; background workers may generate/reschedule actions. Archive persists status=archived; restore sets active. Explicit category, importance and remainingMinutes are required on create.':name.includes('task')?'DCC standalone manual checklist collection only. expectedVersion and projected version are COLLECTION versions. No project linkage, generated actions or recurrence mutation.':name.includes('calendar_event')?'DCC nonrecurring-only calendar mutation requires the trusted guarded writer: live source recurrence and conditional ETags are enforced before PUT. Same-key recovery uses the immutable mutation ledger/payload. Saved means provider saved, NOT refreshed snapshot identity; confirmation remains snapshot_pending.':'DCC bounded safe projection; operation receipts are actor-scoped but this is not authentication or data isolation. Calendar saved status includes completion without provider reads.',annotations:{readOnlyHint:!TOOLS[name].write,destructiveHint:TOOLS[name].write,openWorldHint:true},execution:{taskSupport:'forbidden'}}
  })
}
