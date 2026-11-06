// Pure finite campaign manifest: no imports that can start a process/service.
export const EVERYDAY_SEED=20261107
export const EVERYDAY_MODEL_CAP=12
export const EVERYDAY_ORIGIN='http://127.0.0.1:18534'
export function everydayRequestHeaders(cookie:string,hasBody:boolean):Record<string,string>{
  // Every request, including the very first login, owns a closing connection.
  // Cases deliberately close/rebind the same app port; never reuse that socket.
  return {Connection:'close',Cookie:cookie,...(hasBody?{Origin:EVERYDAY_ORIGIN,'Content-Type':'application/json'}:{})}
}
export const EVERYDAY_CASES=[
  {id:'EA01',tools:['create_task','create_task'],goal:'Create study/work tasks; estimates explicitly stored as notes, not a duration field'},
  {id:'EA02',tools:['update_task','set_task_completed','set_task_completed'],goal:'Rename/update notes; complete then reopen the exact study task'},
  {id:'EA03',tools:['remove_task'],goal:'Delete only work task via retained tombstone; replay and changed-payload refusal'},
  {id:'EA04',tools:['create_project','create_daily_action'],goal:'Create coursework project and its dated manual child with typed minutes'},
  {id:'EA05',tools:['update_daily_action','update_daily_action'],goal:'Update child fields then complete child without completing parent'},
  {id:'EA06',tools:['update_project','set_project_status'],goal:'Rename/update project and explicitly complete parent'},
  {id:'EA07',tools:['archive_project','restore_project'],goal:'Archive/restore parent; retain completed child and parent history'},
  {id:'EA08',tools:['create_assignment','update_project'],goal:'Create assignment with explicit planning fields, then update only deadline'},
  {id:'EA09',tools:[],goal:'Ambiguous project removal asks exact typed clarification; zero domain changes'},
  {id:'EA10',tools:['create_calendar_event'],goal:'Create one School appointment with grounded VTIMEZONE; actual HTTP ICS/SQL readback'},
  {id:'EA11',tools:['update_calendar_event'],goal:'Move only that simple appointment with current source ETag'},
  {id:'EA12',tools:['cancel_calendar_event'],goal:'Cancel only that appointment; same-key replay cannot PUT again'},
] as const
export type EverydayCaseId=typeof EVERYDAY_CASES[number]['id']
export const TASK_WINDOW={from:'2030-11-07',to:'2030-11-10',limit:25,offset:0}
// 31-day maximum event window, including the October donor and November event.
export const CALENDAR_WINDOW={from:'2030-10-20T00:00:00Z',to:'2030-11-20T00:00:00Z',limit:25,offset:0}
export const RECURRENCE_SENTINEL={id:'qa-template-20261107',title:'QA untouched weekly template',date:'2030-11-07',notes:'Host-owned synthetic recurrence sentinel',completed:false,important:true,deleted:false,recurrence:{version:1,kind:'template',frequency:'weekly',weekday:4,startDate:'2030-11-07',paused:false},futureMetadata:{synthetic:true,seed:EVERYDAY_SEED}}
export function everydayOptions(args:string[],env:Record<string,string|undefined>){
  if(env.DCC_QA_EVERYDAY_APPROVED!=='synthetic-everyday-actions-model'||env.DCC_QA_RUNTIME_APPROVED!=='synthetic-loopback-model'||!(args.length===0||args.length===1&&args[0]==='--preflight-only'))throw Error('Everyday approval/arguments refused')
  if(Object.keys(env).some(k=>k.startsWith('PG')||['DATABASE_URL','NODE_OPTIONS','NODE_EXTRA_CA_CERTS'].includes(k)))throw Error('Ambient configuration refused')
  const database=env.DCC_QA_DATABASE??'',user=env.DCC_QA_PG_USER??''
  if(!/^dcc_qa_[a-z0-9_]{1,48}$(?![\s\S])/.test(database)||!/^[a-z_][a-z0-9_]{0,62}$(?![\s\S])/.test(user))throw Error('Isolated database/role required')
  return {database,user,preflightOnly:args.length===1}
}
