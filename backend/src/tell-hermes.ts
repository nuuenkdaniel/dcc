import {createHash} from 'node:crypto'
import type {Pool} from 'pg'
import type {EventChange} from './calendar-write.js'
import {callCurator,validDate,type Entity} from './planner.js'
import {appendHermesTask} from './manual-tasks.js'

type ProjectCommand={action:'create-project-or-assignment';kind:'project'|'assignment';title:string;description:string;deadline:string|null;remainingMinutes:number|null}
type TaskCommand={action:'create-manual-task';title:string;date:string;notes:string}
type EventCommand={action:'create-calendar-event';title:string;calendar:string;start:string;minutes:number;description:string;location:string}
type Command=ProjectCommand|TaskCommand|EventCommand|{action:'missing';fields:string[]}|{action:'rejected'}
type Result={code:number;message:string;id?:string;kind?:string;origin?:'hermes'}
type Receipt={id:string;fingerprint:string;command:Command;targetId:string;change?:EventChange;result?:Result}
export type TellOptions={pool:Pool;curator?:((input:unknown)=>Promise<unknown>)|undefined;calendarChange?:((change:EventChange)=>Promise<{code:number;error?:string;saved?:boolean}>)|undefined;now?:()=>Date}
const fields=['title','date','time','duration','calendar','deadline','kind']
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export function easternInstant(local:string){
 if(typeof local!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)||!validDate(local.slice(0,10)))throw Error('Invalid local time')
 const base=Date.parse(local+'Z'),matches:string[]=[]
 // Check both Eastern offsets by round-trip; reject DST gaps and ambiguity.
 for(const offset of [4,5]){const date=new Date(base+offset*3600000);if(Number.isFinite(date.getTime())&&formatter.format(date).replace(' ','T')===local)matches.push(date.toISOString())}
 if(matches.length!==1)throw Error('Specify an unambiguous New York time')
 return matches[0]!
}
export function validateCommand(raw:unknown):Command{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid command')
 const d=raw as Record<string,unknown>
 const keys=(names:string[])=>Object.keys(d).sort().join(',')===['action',...names].sort().join(',')
 const text=(key:string,max:number,required=false)=>typeof d[key]==='string'&&(d[key] as string).length<=max&&(!required||!!(d[key] as string).trim())
 let valid=false
 switch(d.action){
  case 'rejected':valid=keys([]);break
  case 'missing':valid=keys(['fields'])&&Array.isArray(d.fields)&&d.fields.length>0&&d.fields.length<=fields.length&&new Set(d.fields).size===d.fields.length&&d.fields.every(f=>typeof f==='string'&&fields.includes(f));break
  case 'create-project-or-assignment':valid=keys(['kind','title','description','deadline','remainingMinutes'])&&['project','assignment'].includes(String(d.kind))&&text('title',240,true)&&text('description',12000)&&(d.deadline===null&&d.kind==='project'||validDate(d.deadline))&&(d.remainingMinutes===null||Number.isInteger(d.remainingMinutes)&&Number(d.remainingMinutes)>=0&&Number(d.remainingMinutes)<=100000);break
  case 'create-manual-task':valid=keys(['title','date','notes'])&&text('title',240,true)&&validDate(d.date)&&text('notes',4000);break
  case 'create-calendar-event':
   valid=keys(['title','calendar','start','minutes','description','location'])&&text('title',240,true)&&text('calendar',240,true)&&text('start',16,true)&&Number.isInteger(d.minutes)&&Number(d.minutes)>=1&&Number(d.minutes)<=10080&&text('description',12000)&&text('location',1000)
   if(valid)easternInstant(d.start as string)
   break
 }
 if(!valid)throw Error('Invalid command fields')
 return raw as Command
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
function stableId(value:string){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export async function tellHermes(input:{key:string;prompt:string},options:TellOptions):Promise<Result>{
 if(!input||typeof input.key!=='string'||!/^\w[\w-]{15,79}$/.test(input.key)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)return {code:400,message:'Provide a command of up to 4,000 characters and a stable submission key.'}
 const id=stableId('tell-receipt:'+input.key),fingerprint=hash(input.prompt),c=await options.pool.connect()
 let locked=false,released=false
 try{
  await c.query('SELECT pg_advisory_lock(hashtextextended($1,817343))',[id]);locked=true
  const old=(await c.query("SELECT data FROM planner_entities WHERE id=$1 AND kind='hermes-command'",[id])).rows[0]
  let receipt=old?.data as Receipt|undefined
  if(receipt&&receipt.fingerprint!==fingerprint)return {code:409,message:'Submission key already used for a different command.'}
  if(receipt?.result)return receipt.result
  if(!receipt){
   let command:Command
   try{command=validateCommand(await (options.curator??callCurator)({mode:'tell-hermes',prompt:input.prompt,timezone:'America/New_York',referenceTime:formatter.format((options.now??(()=>new Date()))()).replace(' ','T')}))}
   catch{return {code:502,message:'Hermes could not parse a safe command. Nothing was created; retry or add required details.'}}
   receipt={id,fingerprint,command,targetId:stableId('tell-target:'+input.key)}
   if(command.action==='create-calendar-event'){
    if(!options.calendarChange)return {code:503,message:'Calendar writes are not configured. Nothing was created.'}
    const state=(await c.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0]
    const calendars=(state?.snapshot?.calendars??[]) as {id:string;name:string}[]
    const matches=calendars.filter(calendar=>calendar.name===command.calendar)
    if(matches.length!==1)return {code:422,message:'Missing required details: specify one exact, unambiguous calendar name.'}
    const start=easternInstant(command.start)
    receipt.change={id:receipt.targetId,calendarId:matches[0]!.id,title:command.title,start,end:new Date(Date.parse(start)+command.minutes*60000).toISOString(),allDay:false,description:command.description?`Hermes-created\n${command.description}`:'Hermes-created',location:command.location}
   }
   // Save the exact payload before execution so retries cannot reparse it.
   await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'hermes-command',$2)",[id,receipt])
  }
  const command=receipt.command
  let result:Result
  if(command.action==='missing')result={code:422,message:`Missing required details: ${command.fields.join(', ')}. Nothing was created.`}
  else if(command.action==='rejected')result={code:422,message:'Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.'}
  else if(command.action==='create-calendar-event'){
   if(!options.calendarChange)return {code:503,message:'Calendar writes are not configured. Retry this submission later.'}
   // The calendar writer takes its own mutation lock and deduplicates this exact
   // payload. Release our connection first: otherwise concurrent calendar
   // commands could exhaust the pool while each waits for a second connection.
   await c.query('SELECT pg_advisory_unlock(hashtextextended($1,817343))',[id]);locked=false
   c.release();released=true
   const saved=await options.calendarChange(receipt.change!)
   if(saved.code!==200||!saved.saved)return {code:saved.code===200?502:saved.code,message:'Calendar save not confirmed. Retry this same submission safely.'}
   result={code:200,message:`Hermes-created event: ${command.title}.`,id:receipt.targetId,kind:'event',origin:'hermes'}
  }else{
   await c.query('BEGIN')
   try{
    if(command.action==='create-manual-task')await appendHermesTask(c,{id:receipt.targetId,title:command.title,date:command.date,notes:command.notes,completed:false,origin:'hermes'})
    else{
     await c.query('SELECT pg_advisory_xact_lock(817340)')
     const data:Entity={id:receipt.targetId,kind:command.kind,title:command.title,description:command.description,deadline:command.deadline??'',remainingMinutes:command.remainingMinutes??0,category:'personal',importance:2,progress:'',status:'active',origin:'hermes'}
     await c.query("INSERT INTO planner_entities(id,kind,data) VALUES($1,'project',$2)",[receipt.targetId,data])
     await c.query('UPDATE planner_runs SET requested=true,next_attempt=now() WHERE id=1')
    }
    result={code:200,message:`Hermes-created ${command.action==='create-manual-task'?'task':command.kind}: ${command.title}.`,id:receipt.targetId,kind:command.action==='create-manual-task'?'task':command.kind,origin:'hermes'}
    receipt.result=result
    await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[id,receipt])
    await c.query('COMMIT')
    return result
   }catch(error){await c.query('ROLLBACK');throw error}
  }
  receipt.result=result
  await (released?options.pool:c).query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1',[id,receipt])
  return result
 }finally{if(!released){try{if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,817343))',[id])}finally{c.release()}}}
}
