import {useEffect,useRef,useState} from 'react'
import {protectedFetch} from './auth'

type Mode='legacy'|'tasks'|'actions'
type Submission={key:string;prompt:string;mode:Mode;settled:boolean}
const STORAGE='dcc.tell-hermes.submission.v1'
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
function legacyApplied(v:Record<string,unknown>){
  return exact(v,['code','message','id','kind','origin'])&&v.code===200&&v.origin==='hermes'&&typeof v.message==='string'&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&['task','project','assignment','event'].includes(String(v.kind))
}
function taskReceipt(v:Record<string,unknown>){
  if(!exact(v,['message','summary'])||typeof v.message!=='string'||!record(v.summary))return null
  const s=v.summary,completed=s.phase==='completed'
  if(!exact(s,[...(completed?['phase','outcome','effects','pending']:['phase','effects','pending']),...(s.reads!==undefined?['reads']:[]),...(s.readsTruncated!==undefined?['readsTruncated']:[])])||s.readsTruncated!==undefined&&s.readsTruncated!==true||!['admitted','active','uncertain','completed'].includes(String(s.phase))||!Number.isInteger(s.pending)||Number(s.pending)<0||Number(s.pending)>12||!Array.isArray(s.effects)||s.effects.length>4)return null
  const reads=s.reads??[]
  if(!Array.isArray(reads)||reads.length>12||reads.some(r=>!record(r)||!exact(r,['tool','data'])||!['list_tasks','list_projects','list_calendars','list_calendar_events','get_operation_status','list_daily_actions','list_preparations','search_inbox','get_inbox_message','list_prices','get_calendar_series'].includes(String(r.tool))||!record(r.data))||JSON.stringify(reads).length>2000000)return null
  const domains=new Set<'tasks'|'projects'|'calendar'>()
  let applied=0,failed=0,uncertain=0
  for(const e of s.effects){
    if(!record(e)||!['create_task','update_task','set_task_completed','remove_task','create_project','create_assignment','update_project','set_project_status','archive_project','restore_project','create_calendar_event','update_calendar_event','cancel_calendar_event','create_daily_action','update_daily_action','create_preparation','relink_preparation','insert_preparation_topic','remove_preparation_topic','update_preparation','update_preparation_topic'].includes(String(e.tool)))return null
    const domain=String(e.tool).includes('calendar_event')?'calendar':String(e.tool).includes('task')?'tasks':'projects'
    if(e.state==='applied'){
      if(!exact(e,['tool','state','id','version'])||typeof e.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._@+%=-]{0,199}$(?![\s\S])/.test(e.id)||!Number.isSafeInteger(e.version)||Number(e.version)<1||Number(e.version)>2147483647)return null
       applied++
       domains.add(domain)
    }else if(e.state==='saved'){
      if(domain!=='calendar'||!exact(e,['tool','state','confirmation'])||e.confirmation!=='snapshot_pending')return null
      applied++;domains.add('calendar')
    }else{
      if(!exact(e,['tool','state'])||!['conflict','rejected','uncertain'].includes(String(e.state)))return null
      if(e.state==='uncertain')uncertain++;else failed++
    }
  }
  if(Number(s.pending)<uncertain)return null
  if(s.phase==='admitted'&&(s.effects.length||s.pending!==0))return null
  if(completed){
    if(s.pending!==0||uncertain)return null
    const outcome=applied?(failed?'partial':'effects_recorded'):failed?'rejected':'no_effects_recorded'
    if(s.outcome!==outcome)return null
  }
  const message=completed
    ? applied?(failed?`Some task actions saved (${applied}); others conflicted or were rejected. Review tasks before a new request.`:'Task actions saved.'):failed?'No task writes were applied. The request was rejected or conflicted.':'No task writes were recorded. Edit the request to start a new intent.'
    : `Task action ${s.phase==='uncertain'?'uncertain':'pending'}. Recorded saved effects: ${applied}. Retry unchanged to check receipts.`
  return {applied,settled:completed,message:(domains.has('calendar')?message+' Calendar saved; snapshot confirmation pending.':message)+(s.readsTruncated?' Some read results were omitted from this bounded summary.':''),domains:[...domains],reads}
}
function terminalNoWrite(result:Record<string,unknown>){
 if(result.code!==422||Object.keys(result).sort().join(',')!=='code,message'||typeof result.message!=='string')return false
 return /^Missing required details: (?:title|date|time|duration|calendar|deadline|kind)(?:, (?:title|date|time|duration|calendar|deadline|kind))*\. Nothing was created\.$/.test(result.message)||result.message==='Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.'
}
function read():Submission|null{
 const raw=localStorage.getItem(STORAGE)
 if(!raw)return null
  const value:unknown=JSON.parse(raw)
   if(!record(value)||Object.keys(value).some(k=>!['key','prompt','mode','settled'].includes(k))||typeof value.key!=='string'||!/^\w[\w-]{15,79}$/.test(value.key)||typeof value.prompt!=='string'||value.prompt.length>4000||value.mode!==undefined&&!['legacy','tasks','actions'].includes(String(value.mode))||value.settled!==undefined&&typeof value.settled!=='boolean')throw Error('Invalid saved submission')
  // Old entries are unresolved LEGACY attempts; never migrate their executor.
  return {key:value.key,prompt:value.prompt,mode:value.mode===undefined?'legacy':value.mode as Mode,settled:value.settled===true}
}
export function TellHermes({onCreated}:{onCreated:(scope?:'tasks'|'projects'|'calendar')=>void}){
 const [initial]=useState(()=>{try{return {submission:read(),error:false}}catch{return {submission:null,error:true}}})
  const [prompt,setPrompt]=useState(initial.submission?.prompt??'')
  const [mode,setMode]=useState<Mode>(initial.submission?.mode??'actions')
  const [reads,setReads]=useState<{tool:string;data:unknown}[]>([])
  const [saved,setSaved]=useState(initial.submission),[available,setAvailable]=useState(false)
  const submission=useRef(initial.submission),inFlight=useRef(false),newIntent=useRef(false)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(initial.error?'Saved Tell Hermes submission cannot be read. Sending is paused to protect retries.':'')
  const locked=!!saved&&!saved.settled
  useEffect(()=>{
    if(initial.error)return
    let alive=true,generation=0
    const discover=async()=>{
      const current=++generation
      try{
        const r=await protectedFetch(mode==='tasks'?'/api/v1/hermes/capabilities':'/api/v1/hermes/action-capabilities',{signal:AbortSignal.timeout(8000)})
        const v:unknown=r.ok?await r.json():null
        if(alive&&current===generation)setAvailable(record(v)&&(mode==='tasks'?v.taskActions===true:v.productActions===true))
      }catch{if(alive&&current===generation)setAvailable(false)}
    }
    const signedOut=()=>{generation++;setAvailable(false)}
    void discover()
    window.addEventListener('dcc-auth-changed',discover);window.addEventListener('focus',discover);window.addEventListener('dcc-auth-required',signedOut)
    return()=>{alive=false;generation++;window.removeEventListener('dcc-auth-changed',discover);window.removeEventListener('focus',discover);window.removeEventListener('dcc-auth-required',signedOut)}
  },[initial.error,mode])
  const send=async()=>{
   if(inFlight.current||initial.error||!prompt.trim()||mode!=='legacy'&&!available)return
   const prior=submission.current
   if(prior&&!prior.settled&&(prior.prompt!==prompt||prior.mode!==mode))return
   inFlight.current=true;setBusy(true);setMessage(mode==='actions'?'Checking DCC…':mode==='tasks'?'Updating tasks…':'Creating…')
   let confirmedEffects=false
   try{
    const persisted=read()
    if(persisted&&!persisted.settled&&(persisted.key!==prior?.key||persisted.prompt!==prior?.prompt||persisted.mode!==prior?.mode))throw Error('Another saved request must be retained')
    const key=prior&&prior.prompt===prompt&&prior.mode===mode&&!newIntent.current?prior.key:crypto.randomUUID()
    const next:Submission={key,prompt,mode,settled:false}
   // Persist before sending; reloads and uncertain responses reuse this key.
    localStorage.setItem(STORAGE,JSON.stringify(next));submission.current=next;setSaved(next);newIntent.current=false
    const response=await protectedFetch(mode==='actions'?'/api/v1/hermes/actions':mode==='tasks'?'/api/v1/hermes/task-actions':'/api/v1/hermes/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,prompt}),signal:AbortSignal.timeout(180000)})
    const result:unknown=await response.json()
    if(!record(result))throw Error('Invalid receipt')
    if(mode==='legacy'&&response.status===422&&terminalNoWrite(result)){
    // Clear memory only after persistence succeeds so storage failures remain retryable.
     localStorage.removeItem(STORAGE);submission.current=null;setSaved(null);setMode('actions');newIntent.current=true;setMessage(String(result.message));return
    }
    const task=mode!=='legacy'&&response.status===200?taskReceipt(result):null
    const legacy=mode==='legacy'&&response.status===200&&legacyApplied(result)
    if(!task&&!legacy)throw Error('Unconfirmed receipt')
    if(task){setReads(task.reads);if(task.applied){confirmedEffects=true;for(const domain of task.domains)onCreated(domain)}}else if(legacy){confirmedEffects=true;onCreated()}
    if(task?.settled||legacy){
      const settled={...next,settled:true}
      localStorage.setItem(STORAGE,JSON.stringify(settled));submission.current=settled;setSaved(settled)
    }
    setMessage(task?mode==='actions'?task.message.replaceAll('Task action','DCC action').replaceAll('task writes','DCC writes').replaceAll('task actions','DCC actions'):task.message:String(result.message))
   }catch{setMessage(confirmedEffects?'Saved effects confirmed; retry state remains pinned. Retry this request unchanged.':mode!=='legacy'?'Action was not confirmed. Retry this request unchanged.':'Creation was not confirmed. Keep this command unchanged and retry safely.')}
  finally{inFlight.current=false;setBusy(false)}
 }
  return <form className="tell-hermes" aria-busy={busy} onSubmit={event=>{event.preventDefault();void send()}}>
    <div className="tell-hermes-row">
      <label className="sr-only" htmlFor="tell-hermes-command">Ask Hermes about tasks, projects, or calendar</label>
      <input id="tell-hermes-command" type="text" required maxLength={4000} disabled={busy||initial.error||mode!=='legacy'&&!available} readOnly={locked} value={prompt} onChange={event=>{if(!submission.current||submission.current.settled){setPrompt(event.target.value);setMode('actions');newIntent.current=mode!=='actions';setReads([])}}} placeholder="Hermes" aria-describedby="tell-hermes-status"/>
    </div>
    <p id="tell-hermes-status" role="status">{initial.error?message:mode!=='legacy'&&!available?'MCP actions are unavailable. Saved requests are retained; no legacy fallback.':message||(locked?'Saved request retained. Retry unchanged to check its receipt.':'')}</p>
    {reads.length>0&&<details><summary>Authoritative results</summary>{reads.map((r,i)=><pre key={i}>{JSON.stringify(r.data,null,2)}</pre>)}</details>}
  </form>
}
