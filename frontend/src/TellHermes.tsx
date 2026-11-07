import {useCallback,useEffect,useRef,useState} from 'react'
import {protectedFetch} from './auth'
import {useOptionalBrowserTimer} from './timerContext'
import {validClarification,type Clarification} from '../../backend/src/mcp/clarification'
import {HermesConversation} from './HermesConversation'

type Mode='legacy'|'tasks'|'actions'
type Submission={key:string;prompt:string;mode:Mode;settled:boolean;tabId?:string}
type Retained=Submission&{retainedAt:number;warning:string}
const STORAGE='dcc.tell-hermes.submission.v1'
const RETAINED='dcc.tell-hermes.retained.v1'
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
function legacyApplied(v:Record<string,unknown>){
  return exact(v,['code','message','id','kind','origin'])&&v.code===200&&v.origin==='hermes'&&typeof v.message==='string'&&typeof v.id==='string'&&/^[a-f0-9-]{36}$/.test(v.id)&&['task','project','assignment','event'].includes(String(v.kind))
}
function taskReceipt(v:Record<string,unknown>){
  if(!exact(v,['message','summary'])||typeof v.message!=='string'||!record(v.summary))return null
  const s=v.summary,completed=s.phase==='completed'
   if(!exact(s,[...(completed?['phase','outcome','effects','pending']:['phase','effects','pending']),...(s.reads!==undefined?['reads']:[]),...(s.readsTruncated!==undefined?['readsTruncated']:[]),...(s.clarifications!==undefined?['clarifications']:[])])||s.readsTruncated!==undefined&&s.readsTruncated!==true||!['admitted','active','uncertain','completed'].includes(String(s.phase))||!Number.isInteger(s.pending)||Number(s.pending)<0||Number(s.pending)>12||!Array.isArray(s.effects)||s.effects.length>4)return null
   const clarifications=s.clarifications??[]
   if(!Array.isArray(clarifications)||clarifications.length>3||!clarifications.every(validClarification)||new Set(clarifications.map(c=>c.reason)).size!==clarifications.length)return null
  const reads=s.reads??[]
  if(!Array.isArray(reads)||reads.length>12||reads.some(r=>!record(r)||!exact(r,['tool','data'])||!['list_tasks','list_projects','list_calendars','list_calendar_events','get_operation_status','list_daily_actions','list_preparations','search_inbox','get_inbox_message','get_calendar_series','get_focus_timer'].includes(String(r.tool))||!record(r.data))||JSON.stringify(reads).length>2000000)return null
  const domains=new Set<'tasks'|'projects'|'calendar'>()
  let applied=0,failed=0,uncertain=0
  for(const e of s.effects){
    if(!record(e)||!['create_task','update_task','set_task_completed','remove_task','create_project','create_assignment','update_project','set_project_status','archive_project','restore_project','create_calendar_event','update_calendar_event','cancel_calendar_event','create_daily_action','update_daily_action','create_preparation','relink_preparation','insert_preparation_topic','remove_preparation_topic','update_preparation','update_preparation_topic','control_focus_timer','edit_focus_queue'].includes(String(e.tool)))return null
    const domain=String(e.tool).includes('calendar_event')?'calendar':String(e.tool).includes('task')?'tasks':'projects'
    if(e.state==='applied'){
      if(!exact(e,['tool','state','id','version'])||typeof e.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._@+%=-]{0,199}$(?![\s\S])/.test(e.id)||!Number.isSafeInteger(e.version)||Number(e.version)<1||Number(e.version)>2147483647)return null
       applied++
        if(!['control_focus_timer','edit_focus_queue'].includes(String(e.tool)))domains.add(domain)
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
    : `Task action ${s.phase==='uncertain'?'uncertain':'pending'}. Recorded saved effects: ${applied}. You can edit or clear the request.`
    return {applied,failed,settled:completed,message:(clarifications.length&&!applied&&completed?'More details needed. Edit your request with the answer to start a new request.':domains.has('calendar')?message+' Calendar saved; snapshot confirmation pending.':message)+(clarifications.length&&applied?' More details are needed for the remaining work; saved effects above are unchanged.':'')+(s.readsTruncated?' Some read results were omitted from this bounded summary.':''),domains:[...domains],reads,clarifications}
}
function terminalNoWrite(result:Record<string,unknown>){
 if(result.code!==422||Object.keys(result).sort().join(',')!=='code,message'||typeof result.message!=='string')return false
 return /^Missing required details: (?:title|date|time|duration|calendar|deadline|kind)(?:, (?:title|date|time|duration|calendar|deadline|kind))*\. Nothing was created\.$/.test(result.message)||result.message==='Only creating a project/assignment, manual task, or calendar event is allowed. Nothing was created.'
}
function read():Submission|null{
 const raw=localStorage.getItem(STORAGE)
 if(!raw)return null
  const value:unknown=JSON.parse(raw)
   if(!record(value)||Object.keys(value).some(k=>!['key','prompt','mode','settled','tabId'].includes(k))||value.tabId!==undefined&&(typeof value.tabId!=='string'||!/^[a-f0-9-]{36}$/.test(value.tabId))||typeof value.key!=='string'||!/^\w[\w-]{15,79}$/.test(value.key)||typeof value.prompt!=='string'||value.prompt.length>4000||value.mode!==undefined&&!['legacy','tasks','actions'].includes(String(value.mode))||value.settled!==undefined&&typeof value.settled!=='boolean')throw Error('Invalid saved submission')
  // Old entries are unresolved LEGACY attempts; never migrate their executor.
   return {key:value.key,prompt:value.prompt,mode:value.mode===undefined?'legacy':value.mode as Mode,settled:value.settled===true,...(typeof value.tabId==='string'?{tabId:value.tabId}:{})}
}
function history():Retained[]{
  const raw=localStorage.getItem(RETAINED)??'[]'
  if(raw.length>2000000)throw Error('Retained request history too large')
  const values:unknown=JSON.parse(raw)
  if(!Array.isArray(values)||values.some(v=>!record(v)||typeof v.key!=='string'||typeof v.prompt!=='string'||v.prompt.length>4000||v.mode!==undefined&&!['legacy','tasks','actions'].includes(String(v.mode))))throw Error('Retained requests unreadable')
  // Read the previous retained.v1 shape as well; absent executor means legacy.
  return values.slice(-20).map(v=>({...v,mode:v.mode??'legacy',settled:v.settled===true,retainedAt:typeof v.retainedAt==='number'?v.retainedAt:0,warning:typeof v.warning==='string'?v.warning:'Not confirmed; may have saved. Not rolled back.'})) as Retained[]
}
function retain(old:Submission,warning:string):Retained[]{
  const prior=history(),same=prior.find(v=>v.key===old.key)
  if(same&&(same.prompt!==old.prompt||same.mode!==old.mode||same.tabId!==old.tabId))throw Error('Retained key conflict')
  const next=same?prior:[...prior.slice(-19),{...old,retainedAt:Date.now(),warning}]
  // Persist the old executor/key before releasing its active storage slot.
  localStorage.setItem(RETAINED,JSON.stringify(next))
  if(read()?.key===old.key)localStorage.removeItem(STORAGE)
  return next
}
export function TellHermes({onCreated}:{onCreated:(scope?:'tasks'|'projects'|'calendar')=>void}){
 const timerPort=useOptionalBrowserTimer(),timerRef=useRef(timerPort)
 useEffect(()=>{timerRef.current=timerPort;return()=>{timerRef.current=null}},[timerPort])
 const [initial]=useState(()=>{try{return {submission:read(),error:false}}catch{return {submission:null,error:true}}})
  const [prompt,setPrompt]=useState(initial.submission?.prompt??'')
   const [mode,setMode]=useState<Mode>(initial.submission?.settled?initial.submission.mode:'actions')
   const [reads,setReads]=useState<{tool:string;data:unknown}[]>([])
   const [clarifications,setClarifications]=useState<Clarification[]>([])
   const [saved,setSaved]=useState(initial.submission),[available,setAvailable]=useState(false)
   const [conversationOwner,setConversationOwner]=useState<string|null>(null)
   const [conversationEnabled,setConversationEnabled]=useState(false)
   const conversationOwnerRef=useRef(conversationOwner);conversationOwnerRef.current=conversationOwner
   const discoveryDenied=useRef(false),edited=useRef(false)
   const [denied,setDenied]=useState(false)
   const confirmedCatalog=useRef<Mode|null>(null)
   const [retained,setRetained]=useState<Retained[]>(()=>{try{return history()}catch{return []}})
   const [retentionWarning,setRetentionWarning]=useState(''),[confirmNew,setConfirmNew]=useState<string|null>(null)
    const submission=useRef(initial.submission),inFlight=useRef(false),newIntent=useRef(false),requestAbort=useRef<AbortController|null>(null)
   useEffect(()=>()=>{requestAbort.current?.abort()},[])
   const [busy,setBusy]=useState(false),[message,setMessage]=useState(initial.error?'Saved request is unreadable and preserved. You can edit or clear this box; sending is paused.':'')
   const detach=useCallback((old:Submission,warning:string)=>{
    try{setRetained(retain(old,warning));setRetentionWarning('')}
    catch{
     // Storage failure never traps the editor or discards the durable old slot.
     setRetained(previous=>previous.some(v=>v.key===old.key)?previous:[...previous.slice(-19),{...old,retainedAt:Date.now(),warning}])
     setRetentionWarning('Local history could not be saved. The old request is preserved; text remains editable. New sending waits for storage to recover.')
    }
    if(submission.current?.key===old.key)submission.current=null
    setSaved(previous=>previous?.key===old.key?null:previous);setMode('actions');newIntent.current=true;setConfirmNew(null)
   },[])
   useEffect(()=>{
    if(initial.submission&&!initial.submission.settled)detach(initial.submission,'Interrupted or unconfirmed; may have saved. Not rolled back.')
   },[initial,detach])
    const locked=busy&&!!saved&&!saved.settled
   useEffect(()=>{
     if(!locked||!saved?.tabId||saved.tabId!==timerPort?.tabId)return
     const {key,tabId}=saved;let stopped=false,busy=false
      const poll=async()=>{
        if(stopped||busy)return;busy=true
        try{
          if(read()?.key!==key){stopped=true;return}
         const response=await protectedFetch('/api/v1/hermes/timer-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,tabId}),signal:AbortSignal.timeout(5000)})
         const body:unknown=response.ok?await response.json():null
         if(!record(body)||!Array.isArray(body.commands)||body.commands.length>12)return
          for(const c of body.commands){
            if(read()?.key!==key){stopped=true;return}
           if(stopped||!record(c)||typeof c.nonce!=='string'||!/^[a-f0-9]{64}$/.test(c.nonce)||typeof c.expiresAt!=='number'||c.expiresAt<=Date.now()||!timerRef.current||timerRef.current.tabId!==tabId)continue
            if(c.recoverOnly!==undefined&&typeof c.recoverOnly!=='boolean')continue
            const result=timerRef.current.process(c.command,c.recoverOnly===true)
           await protectedFetch('/api/v1/hermes/timer-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,tabId,ack:{nonce:c.nonce,result}}),signal:AbortSignal.timeout(5000)})
         }
       }catch{/* Persisted browser receipts permit an exact retry; never invent an ACK. */}finally{busy=false}
     }
     void poll();const interval=setInterval(()=>void poll(),1000),timeout=setTimeout(()=>{stopped=true;clearInterval(interval)},125000)
     return()=>{stopped=true;clearInterval(interval);clearTimeout(timeout)}
    },[locked,saved,timerPort?.tabId,busy])
  useEffect(()=>{
     let alive=true,generation=0
    const discover=async()=>{
      const current=++generation
      confirmedCatalog.current=null;setAvailable(false)
      try{
        const r=await protectedFetch(mode==='tasks'?'/api/v1/hermes/capabilities':'/api/v1/hermes/action-capabilities',{signal:AbortSignal.timeout(8000)})
        const v:unknown=r.ok?await r.json():null
        if(alive&&current===generation){
          const configured=r.ok&&record(v)&&typeof (mode==='tasks'?v.taskActions:v.productActions)==='boolean'&&
            (mode==='tasks'||v.conversation===undefined||v.conversation===false||v.conversation===true&&v.productActions===true&&typeof v.workspaceOwner==='string'&&/^[a-f0-9]{64}$/.test(v.workspaceOwner))
          discoveryDenied.current=!configured
          setDenied(!configured)
          confirmedCatalog.current=configured?mode:null
          setAvailable(configured&&(mode==='tasks'?v.taskActions===true:v.productActions===true))
          const owner=configured&&mode!=='tasks'&&v.conversation===true&&typeof v.workspaceOwner==='string'&&/^[a-f0-9]{64}$/.test(v.workspaceOwner)?v.workspaceOwner:null
          setConversationEnabled(!!owner)
          if(owner){
            if(conversationOwnerRef.current&&conversationOwnerRef.current!==owner){edited.current=false;setPrompt('')}
            setConversationOwner(owner)
          }
        }
      }catch{if(alive&&current===generation){discoveryDenied.current=true;setDenied(true);setAvailable(false);setConversationEnabled(false)}}
    }
    const signedOut=()=>{
      generation++;discoveryDenied.current=true;setDenied(true);setAvailable(false);setConversationEnabled(false)
      if(conversationOwnerRef.current){edited.current=false;setPrompt('');setConversationOwner(null)}
    }
    void discover()
    window.addEventListener('dcc-auth-changed',discover);window.addEventListener('focus',discover);window.addEventListener('dcc-auth-required',signedOut)
    return()=>{alive=false;generation++;window.removeEventListener('dcc-auth-changed',discover);window.removeEventListener('focus',discover);window.removeEventListener('dcc-auth-required',signedOut)}
  },[mode])
   const send=async(explicitNew=false)=>{
    if(inFlight.current||!prompt.trim())return
    if(initial.error){setMessage('Saved request is unreadable and preserved. You can edit or clear this box; sending is paused.');return}
    // Availability is rendered from authoritative discovery below, not stored
    // over the last receipt/error. Recovery must reveal that status unchanged.
    if(discoveryDenied.current||mode!=='legacy'&&(!available||confirmedCatalog.current!==mode))return
    let retainedNow:Retained[]
    try{retainedNow=history()}catch{setRetentionWarning('Local history is unreadable and preserved. Text remains editable; sending is paused.');return}
    const prior=submission.current
    const successfulReceiptCheck=prior?.settled&&prior.prompt===prompt&&prior.mode===mode&&!newIntent.current
    if(!successfulReceiptCheck&&[...retained,...retainedNow].some(v=>v.prompt===prompt)&&!(explicitNew&&confirmNew===prompt)){
     setConfirmNew(prompt);setMessage('This text matches a previous request. It may already have saved. Check current state before sending it as a new request.');return
    }
    if(prior?.tabId&&prior.tabId!==timerPort?.tabId&&prior.prompt===prompt&&!newIntent.current){setMessage('This receipt belongs to its originating browser tab. You can edit or clear the text to start a different request.');return}
   inFlight.current=true;setBusy(true);setMessage(mode==='actions'?'Checking DCC…':mode==='tasks'?'Updating tasks…':'Creating…')
    let confirmedEffects=false
    let attempted:Submission|null=null
    try{
     const persisted=read()
     if(persisted&&!persisted.settled){setRetained(retain(persisted,'Interrupted or unconfirmed; may have saved. Not rolled back.'));if(persisted.prompt===prompt&&!explicitNew){setConfirmNew(prompt);setMessage('This text matches an unconfirmed request. Check current state before sending it as a new request.');return}}
     const key=prior&&prior.prompt===prompt&&prior.mode===mode&&!newIntent.current&&!explicitNew?prior.key:crypto.randomUUID()
    // An old unbound submission remains unbound on retry; never migrate its scope.
    const tabId=prior&&key===prior.key?prior.tabId:mode==='actions'?timerPort?.tabId:undefined
    const next:Submission={key,prompt,mode,settled:false,...(tabId?{tabId}:{})}
   // Persist before sending; reloads and uncertain responses reuse this key.
     localStorage.setItem(STORAGE,JSON.stringify(next));submission.current=next;setSaved(next);newIntent.current=false
     setRetentionWarning('')
     attempted=next;setConfirmNew(null)
    const abort=new AbortController();requestAbort.current=abort
    const response=await protectedFetch(mode==='actions'?'/api/v1/hermes/actions':mode==='tasks'?'/api/v1/hermes/task-actions':'/api/v1/hermes/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,prompt,...(tabId?{tabId}:{})}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(180000)])})
    const result:unknown=await response.json()
    if(!record(result))throw Error('Invalid receipt')
     if(mode==='legacy'&&response.status===422&&terminalNoWrite(result)){
      detach({...next,settled:true},'Rejected: backend confirmed no write.');setMessage(String(result.message));return
    }
    const task=mode!=='legacy'&&response.status===200?taskReceipt(result):null
    const legacy=mode==='legacy'&&response.status===200&&legacyApplied(result)
    if(!task&&!legacy)throw Error('Unconfirmed receipt')
    if(task){setReads(task.reads);setClarifications(task.clarifications);if(task.applied){confirmedEffects=true;for(const domain of task.domains)onCreated(domain)}}else if(legacy){confirmedEffects=true;onCreated()}
     if(task&&(!task.settled||task.failed>0)){
      detach({...next,settled:task.settled},task.settled&&!task.applied?'Rejected; no writes were applied.':'Unconfirmed or partial; effects may have saved. Not rolled back.')
     }else if(task?.settled||legacy){
      const settled={...next,settled:true}
      if(read()?.key!==next.key)throw Error('A different request is now retained; never overwrite it with a late receipt')
      localStorage.setItem(STORAGE,JSON.stringify(settled));submission.current=settled;setSaved(settled)
    }
     setMessage(task?mode==='actions'?task.message.replaceAll('Task action','DCC action').replaceAll('task writes','DCC writes').replaceAll('task actions','DCC actions').replace(' Retry unchanged to check receipts.',' You can edit or clear the request.'):task.message:String(result.message))
    }catch{
     if(attempted)detach(attempted,confirmedEffects?'Some effects confirmed saved; do not repeat without checking current state.':'Not confirmed; may have saved. Not rolled back.')
     setMessage(confirmedEffects?'Saved effects confirmed; the previous request is retained separately. You can edit or clear the box.':'Action was not confirmed. You can edit or clear the box. Previous effects may have saved; check current state before repeating.')
    }
  finally{requestAbort.current=null;inFlight.current=false;setBusy(false)}
  }
  // Discovery never replaces the editor with a disabled loader. A confirmed v2
  // upgrade transfers typed text and focus; an old saved request stays on its
  // original executor until the user deliberately edits it into a new intent.
  if(conversationOwner&&!busy&&!initial.error&&(!initial.submission||edited.current&&prompt!==initial.submission.prompt)){
    const focused=document.activeElement instanceof HTMLInputElement&&document.activeElement.id==='tell-hermes-command'
    return <HermesConversation key={conversationOwner} owner={conversationOwner} available={conversationEnabled} onCreated={onCreated} {...(edited.current?{initialText:prompt}:{})} focusEditor={focused}/>
  }
  return <form className="tell-hermes" aria-busy={busy} onSubmit={event=>{event.preventDefault();void send()}}>
    <div className="tell-hermes-row">
      <label className="sr-only" htmlFor="tell-hermes-command">Ask Hermes about tasks, projects, or calendar</label>
      <input id="tell-hermes-command" type="text" required maxLength={4000} disabled={busy} value={prompt} onChange={event=>{edited.current=true;setPrompt(event.target.value);setMode('actions');if(confirmNew!==null)setMessage('');setConfirmNew(null);setReads([]);setClarifications([]);if(mode!=='actions')newIntent.current=true}} placeholder="Hermes" aria-describedby="tell-hermes-status"/>
    </div>
    <p id="tell-hermes-status" role="status">{initial.error?message:denied||mode!=='legacy'&&!available?'MCP actions are unavailable. You can still edit or clear this box.':message}</p>
    {clarifications.length>0&&<section aria-label="Details Hermes needs"><ul>{clarifications.map(c=><li key={c.reason}>{c.question}</li>)}</ul><p>{locked?'This request is still unresolved. Check its receipts or explicitly retain it before sending a different request.':'Edit the request above with your answer. This sends a new request; it does not repeat earlier saved effects automatically.'}</p></section>}
    {busy&&<button type="button" onClick={()=>requestAbort.current?.abort()}>Stop waiting</button>}
    {confirmNew===prompt&&<button type="button" disabled={busy} onClick={()=>void send(true)}>Send as new request — may duplicate effects</button>}
    {retentionWarning&&<p className="local-note">{retentionWarning}</p>}
    {retained.length>0&&<><p className="local-note">Previous requests are retained separately; unconfirmed effects may have saved. Check current state before repeating. You can edit or clear the box.</p><details><summary>Previous requests ({retained.length}/20)</summary><ul>{retained.map(item=><li key={item.key}>{item.prompt} — {item.warning}</li>)}</ul><p>Only the latest 20 are kept here. Existing backend receipts are unchanged.</p></details></>}
    {reads.length>0&&<details><summary>Authoritative results</summary>{reads.map((r,i)=><pre key={i}>{JSON.stringify(r.data,null,2)}</pre>)}</details>}
  </form>
}
