import {useCallback,useEffect,useRef,useState} from 'react'
import {AUTH_REQUIRED_EVENT,protectedFetch} from './auth'
export type MailMessage={data:{id:string;account:string;address:string;subject:string;sender:string;to:string;receivedAt:string;body:string;bodyNotice:string;unread:boolean;hasHtml?:boolean;attachments:{part:string;name:string;size:number}[]};analysis?:{important:boolean;summary:string;reason:string}|null;override:boolean|null}
type Snapshot={messages:MailMessage[];accounts:{account:string;last_success:string|null;error:string|null}[];today:string}
const blank:Snapshot={messages:[],accounts:[],today:''}
function validated(value:unknown):Snapshot{if(!value||typeof value!=='object'||!Array.isArray((value as Snapshot).messages)||!Array.isArray((value as Snapshot).accounts)||typeof (value as Snapshot).today!=='string')throw Error('Invalid email snapshot');return value as Snapshot}
async function storage(value?:Snapshot){return new Promise<Snapshot|undefined>((resolve,reject)=>{const r=indexedDB.open('daymark-mail',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('cache',value===undefined?'readonly':'readwrite'),op=value===undefined?tx.objectStore('cache').get('snapshot'):tx.objectStore('cache').put(value,'snapshot');tx.oncomplete=()=>{resolve(value??op.result);db.close()};tx.onerror=()=>{reject(tx.error);db.close()};tx.onabort=()=>{reject(tx.error);db.close()}}})}
const timedSignal=(controller:AbortController,milliseconds:number)=>AbortSignal.any([controller.signal,AbortSignal.timeout(milliseconds)])

export function useMail(enabled=true){
 const [snapshot,setSnapshot]=useState<Snapshot>(blank),[message,setMessage]=useState('Loading email…'),[busy,setBusy]=useState(false)
 const working=useRef(false),activeKind=useRef<'automatic'|'manual'|null>(null),manualQueued=useRef(false),mounted=useRef(false),generation=useRef(0),lifecycle=useRef(0),automaticController=useRef<AbortController|null>(null),manualController=useRef<AbortController|null>(null),mutations=useRef(new Set<AbortController>())
 const refreshRef=useRef<(manual?:boolean)=>Promise<void>>(async()=>{})
 const restore=useRef<Promise<void>|null>(null),lastPersisted=useRef<string|null>(null),networkApplied=useRef(false)
 const ensureCache=useCallback(()=>{
  if(!restore.current)restore.current=storage().then(value=>{if(!value)return;const data=validated(value),serialized=JSON.stringify(data);if(!networkApplied.current){lastPersisted.current=serialized;if(mounted.current)setSnapshot(data)}}).catch(()=>{if(mounted.current&&!networkApplied.current)setMessage('Device email cache unavailable. Open Inbox to refresh.')})
  return restore.current
 },[])
 const refresh=useCallback(async(manual=false):Promise<void>=>{
  if(working.current){if(manual){manualQueued.current=true;setBusy(true)}return}
  working.current=true;activeKind.current=manual?'manual':'automatic';if(manual)setBusy(true)
  const id=++generation.current,current=new AbortController()
  if(manual)manualController.current=current;else automaticController.current=current
  const active=()=>mounted.current&&generation.current===id&&!current.signal.aborted
  try{
   const cacheReady=ensureCache()
   if(manual){const request=await protectedFetch('/api/v1/mail/refresh',{method:'POST',signal:timedSignal(current,10_000)});if(!request.ok)throw Error()}
   const request=protectedFetch('/api/v1/mail/snapshot',{signal:timedSignal(current,15_000)})
   const [,response]=await Promise.all([cacheReady,request])
   if(!active())return
   if(response.status===401){setMessage('Sign in to sync email. Cached messages remain on this device.');return}
   if(!response.ok)throw Error()
   const data=validated(await response.json());if(!active())return
   const serialized=JSON.stringify(data);networkApplied.current=true;setSnapshot(previous=>JSON.stringify(previous)===serialized?previous:data)
   let durable=true
   if(serialized!==lastPersisted.current){try{await storage(data);if(!active())return;lastPersisted.current=serialized}catch{durable=false}}
   if(!active())return
   if(!durable)setMessage('Email refreshed, but the device cache could not be saved. Keep this tab open to retain the latest view.')
   else if(manual)setMessage('Mailbox sync requested. New messages appear as the worker finishes.')
   else setMessage(data.accounts.some(account=>account.error)?'Some accounts could not sync; the last durable cache remains available.':'Email cache up to date. Mailboxes checked every 15 minutes.')
  }catch{if(active())setMessage('Offline or email backend unavailable — showing cached messages.')}
  finally{if(generation.current===id){working.current=false;activeKind.current=null;if(manual){if(manualController.current===current)manualController.current=null}else if(automaticController.current===current)automaticController.current=null;const queued=manualQueued.current&&mounted.current;manualQueued.current=false;if(mounted.current)setBusy(false);if(queued)queueMicrotask(()=>void refreshRef.current(true))}}
 },[ensureCache])
 useEffect(()=>{refreshRef.current=refresh},[refresh])
 const cancelAutomatic=useCallback(()=>{
  if(activeKind.current!=='automatic')return
  generation.current++;automaticController.current?.abort();automaticController.current=null;activeKind.current=null;working.current=false
  const queued=manualQueued.current&&mounted.current;manualQueued.current=false
  if(queued)queueMicrotask(()=>void refreshRef.current(true))
 },[])
 useEffect(()=>{
  mounted.current=true;void ensureCache()
  const cancel=()=>{generation.current++;lifecycle.current++;automaticController.current?.abort();manualController.current?.abort();automaticController.current=null;manualController.current=null;activeKind.current=null;for(const request of mutations.current)request.abort();mutations.current.clear();working.current=false;manualQueued.current=false;if(mounted.current)setBusy(false)}
  window.addEventListener(AUTH_REQUIRED_EVENT,cancel)
  return()=>{mounted.current=false;cancel();window.removeEventListener(AUTH_REQUIRED_EVENT,cancel)}
 },[ensureCache])
 useEffect(()=>{
  if(!enabled)return
  const run=()=>{if(document.visibilityState==='visible')void refresh();else cancelAutomatic()}
  run();const timer=window.setInterval(run,30_000)
  window.addEventListener('online',run);document.addEventListener('visibilitychange',run)
  return()=>{window.clearInterval(timer);window.removeEventListener('online',run);document.removeEventListener('visibilitychange',run);cancelAutomatic()}
 },[enabled,refresh,cancelAutomatic])
 const feedback=async(id:string,important:boolean|null)=>{
  const started=lifecycle.current,current=new AbortController();mutations.current.add(current)
  try{const response=await protectedFetch('/api/v1/mail/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,important}),signal:timedSignal(current,10_000)});if(!response.ok)throw Error();if(!mounted.current||lifecycle.current!==started||current.signal.aborted)return;await refresh();if(mounted.current&&lifecycle.current===started&&!current.signal.aborted)setMessage('Importance preference saved. It takes priority over AI classification.')}
  catch{if(mounted.current&&lifecycle.current===started&&!current.signal.aborted)setMessage('Could not save feedback. Reconnect and try again.')}
  finally{mutations.current.delete(current)}
 }
 return {snapshot,message,busy,refresh,feedback}
}
export type MailState=ReturnType<typeof useMail>
export const accountLabel=(account:string)=>({personal:'Personal',school:'School',work:'Work'}[account]??account)
export const isImportant=(m:MailMessage)=>m.override??m.analysis?.important??false
export function receivedToday(m:MailMessage){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.data.receivedAt))===new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
