import {plainRecord,type Arguments,type ToolName,validDate} from './contracts.js'

const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plainRecord(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
export const EXTENDED_READS=['list_daily_actions','list_preparations','search_inbox','get_inbox_message','get_calendar_series'] as const
export function validActionData(v:unknown):v is Record<string,unknown>{
  return plainRecord(v)&&text(v.id,200)&&text(v.title,240)&&String(v.title).trim().length>0&&validDate(v.date)&&text(v.notes,4000)&&integer(v.minutes,5,180)&&typeof v.completed==='boolean'&&typeof v.dismissed==='boolean'&&(v.feedback===undefined||['','comfortable','review'].includes(String(v.feedback)))&&text(v.projectId,200)
}
export function validPreparationData(v:unknown):v is Record<string,unknown>{
  if(!plainRecord(v)||!text(v.id,200)||!text(v.title,240)||!String(v.title).trim()||!validDate(v.startDate)||!['active','paused'].includes(String(v.status))||!text(v.progress,4000)||!plainRecord(v.event)||!text(v.event.id,200)||!text(v.event.calendarId,200)||!text(v.event.uid,200)||(v.event.recurrenceId!==null&&!text(v.event.recurrenceId,200))||!text(v.event.start,40)||typeof v.event.allDay!=='boolean'||!Array.isArray(v.topics)||v.topics.length<1||v.topics.length>60)return false
  const ids=new Set<string>()
  return v.topics.every(t=>{if(!plainRecord(t)||!text(t.id,80)||ids.has(String(t.id))||!text(t.title,240)||!String(t.title).trim()||!text(t.notes,4000)||!integer(t.minutes,5,1800))return false;ids.add(String(t.id));return true})
}
export function validExtendedRead(tool:ToolName,args:Arguments,data:unknown):boolean{
  // list_prices shape below is decode-only for explicitly historical journals;
  // it is excluded from EXTENDED_READS and rejected by active service validation.
  const serialized=JSON.stringify(data)
  if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>450000)return false
  if(tool==='get_inbox_message')return exact(data,['id','body','nextOffset'])&&data.id===args.id&&typeof data.body==='string'&&Array.from(data.body).length<=Number(args.limit)&&(data.nextOffset===null||data.nextOffset===Number(args.offset)+Array.from(data.body).length)
  if(tool==='get_calendar_series')return exact(data,['calendarId','eventId','etag','uid','title','start','end','allDay','timezone','rrule','rdates','exdates','recurrenceIds'])&&data.calendarId===args.calendarId&&data.eventId===args.eventId&&text(data.etag,130)&&/^"[\x21\x23-\x7e]+"$/.test(String(data.etag))&&text(data.uid,200)&&text(data.title,240)&&text(data.start,40)&&text(data.end,40)&&typeof data.allDay==='boolean'&&text(data.timezone,200)&&(data.rrule===null||text(data.rrule,512))&&['rdates','exdates','recurrenceIds'].every(k=>Array.isArray(data[k])&&(data[k] as unknown[]).length<=100&&(data[k] as unknown[]).every(x=>text(x,40)))
  if(!exact(data,['items','nextOffset'])||!Array.isArray(data.items)||data.items.length>Number(args.limit)||data.nextOffset!==null&&data.nextOffset!==Number(args.offset??0)+data.items.length)return false
  const ids=new Set<string>()
  return data.items.every(v=>{
    if(!plainRecord(v)||typeof v.id!=='string'||ids.has(v.id))return false
    ids.add(v.id)
    if(tool==='list_daily_actions')return exact(v,['id','title','date','notes','minutes','completed','dismissed','feedback','projectId','source','version'])&&validActionData(v)&&text(v.source,80)&&integer(v.version,1,2147483647)&&String(v.date)>=String(args.from)&&String(v.date)<String(args.to)
    if(tool==='list_preparations')return exact(v,['id','title','event','startDate','status','topics','progress','version'])&&exact(v.event,['id','calendarId','uid','recurrenceId','start','allDay'])&&validPreparationData(v)&&integer(v.version,1,2147483647)&&Array.isArray(v.topics)&&v.topics.every(t=>exact(t,['id','title','notes','minutes','notesOffset','nextNotesOffset'])&&text(t.notes,512)&&t.notesOffset===Number(args.notesOffset??0)&&(t.nextNotesOffset===null||t.nextNotesOffset===Number(t.notesOffset)+String(t.notes).length))
    if(tool==='search_inbox')return exact(v,['id','sender','subject','receivedAt','account','important','summary'])&&text(v.id,200)&&text(v.sender,500)&&text(v.subject,1000)&&text(v.receivedAt,40)&&['personal','school','work'].includes(String(v.account))&&typeof v.important==='boolean'&&text(v.summary,500)
    if(tool==='list_prices')return exact(v,['id','title','targetCents','paused','sources'])&&text(v.id,200)&&text(v.title,240)&&integer(v.targetCents,1,10000000)&&typeof v.paused==='boolean'&&Array.isArray(v.sources)&&v.sources.length<=3&&v.sources.every(s=>exact(s,['store','status','observedAt','offers'])&&['bestbuy','dell','microcenter'].includes(String(s.store))&&['pending','verified','blocked','unverified','unmatched','failed'].includes(String(s.status))&&(s.observedAt===null||text(s.observedAt,40))&&Array.isArray(s.offers)&&s.offers.length<=20&&s.offers.every(o=>exact(o,['condition','cents','currency','eligible','availability'])&&text(o.condition,80)&&integer(o.cents,1,10000000)&&o.currency==='USD'&&typeof o.eligible==='boolean'&&text(o.availability,1000)))
    return false
  })
}
