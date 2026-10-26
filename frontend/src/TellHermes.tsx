import {useRef,useState} from 'react'
import {protectedFetch} from './auth'

type Submission={key:string;prompt:string}
const STORAGE='dcc.tell-hermes.submission.v1'
function read():Submission|null{
 const raw=localStorage.getItem(STORAGE)
 if(!raw)return null
 const value=JSON.parse(raw) as Submission
 if(typeof value.key!=='string'||!/^\w[\w-]{15,79}$/.test(value.key)||typeof value.prompt!=='string'||value.prompt.length>4000)throw Error('Invalid saved submission')
 return value
}
export function TellHermes({onCreated}:{onCreated:()=>void}){
 const [initial]=useState(()=>{try{return {submission:read(),error:false}}catch{return {submission:null,error:true}}})
 const [prompt,setPrompt]=useState(initial.submission?.prompt??'')
 const submission=useRef(initial.submission),inFlight=useRef(false)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(initial.error?'Saved Tell Hermes submission cannot be read. Sending is paused to protect retries.':'')
 const send=async()=>{
  if(inFlight.current||initial.error||!prompt.trim())return
  inFlight.current=true;setBusy(true);setMessage('Creating…')
  try{
   const next=submission.current?.prompt===prompt?submission.current:{key:crypto.randomUUID(),prompt}
   // Persist before sending; reloads and uncertain responses reuse this key.
   localStorage.setItem(STORAGE,JSON.stringify(next));submission.current=next
   const response=await protectedFetch('/api/v1/hermes/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next),signal:AbortSignal.timeout(180000)})
   const result=await response.json() as {message?:string;error?:string}
   setMessage(result.message??result.error??'Creation was not confirmed. Retry this same submission safely.')
   if(response.ok)onCreated()
  }catch{setMessage('Creation was not confirmed. Keep this command unchanged and retry safely.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 return <details className="tell-hermes"><summary>Tell Hermes</summary><form onSubmit={event=>{event.preventDefault();void send()}}><label htmlFor="tell-hermes-command">Create a project, assignment, task, or event</label><textarea id="tell-hermes-command" rows={2} required maxLength={4000} disabled={busy||initial.error} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="Create a task called Read chapter 2 tomorrow"/><p className="local-note">Creates immediately · New York time. Include a task date, assignment deadline, or event calendar, time and duration.</p><button className="primary-action" disabled={busy||initial.error||!prompt.trim()} aria-busy={busy}>{busy?'Creating…':'Tell Hermes'}</button><p role="status">{message}</p></form></details>
}
