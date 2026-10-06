import {useCallback,useEffect,useRef,useState} from 'react'
export type MailMessage={data:{id:string;account:string;address:string;subject:string;sender:string;to:string;receivedAt:string;body:string;bodyNotice:string;unread:boolean;hasHtml?:boolean;attachments:{part:string;name:string;size:number}[]};analysis?:{important:boolean;summary:string;reason:string}|null;override:boolean|null}
type Snapshot={messages:MailMessage[];accounts:{account:string;last_success:string|null;error:string|null}[];today:string}
const blank:Snapshot={messages:[],accounts:[],today:''}
async function storage(value?:Snapshot){return new Promise<Snapshot|undefined>((resolve,reject)=>{const r=indexedDB.open('daymark-mail',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('cache',value?'readwrite':'readonly'),op=value?tx.objectStore('cache').put(value,'snapshot'):tx.objectStore('cache').get('snapshot');tx.oncomplete=()=>{resolve(value??op.result);db.close()};tx.onerror=()=>{reject(tx.error);db.close()}}})}
export function useMail(){
 const [snapshot,setSnapshot]=useState<Snapshot>(blank),[message,setMessage]=useState('Loading email…'),[busy,setBusy]=useState(false);const working=useRef(false)
 const refresh=useCallback(async(manual=false)=>{if(working.current)return;working.current=true;if(manual)setBusy(true)
 try{if(manual){const request=await fetch('/api/v1/mail/refresh',{method:'POST'});if(!request.ok)throw Error();setMessage('Mailbox sync requested. New messages appear as the worker finishes.')}
 const r=await fetch('/api/v1/mail/snapshot',{signal:AbortSignal.timeout(15000)});if(r.status===401){setMessage('Sign in to sync email. Cached messages remain on this device.');return}if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.messages)||!Array.isArray(data.accounts))throw Error();setSnapshot(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data);await storage(data);if(!manual)setMessage(data.accounts.some((a:{error:string|null})=>a.error)?'Some accounts could not sync; cached mail remains available.':'Email cache up to date. Mailboxes checked every 15 minutes.')
 }catch{setMessage('Offline or email backend unavailable — showing cached messages.')}finally{working.current=false;setBusy(false)}},[])
 useEffect(()=>{let active=true;void storage().then(c=>{if(c&&active)setSnapshot(c)}).catch(()=>{}).finally(()=>{if(active)void refresh()});const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer)}},[refresh])
 const feedback=async(id:string,important:boolean|null)=>{try{const r=await fetch('/api/v1/mail/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,important})});if(!r.ok)throw Error();await refresh();setMessage('Importance preference saved. It takes priority over AI classification.')}catch{setMessage('Could not save feedback. Reconnect and try again.')}}
 return {snapshot,message,busy,refresh,feedback}
}
export type MailState=ReturnType<typeof useMail>
export const accountLabel=(account:string)=>({personal:'Personal',school:'School',work:'Work'}[account]??account)
export const isImportant=(m:MailMessage)=>m.override??m.analysis?.important??false
export function receivedToday(m:MailMessage){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.data.receivedAt))===new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
