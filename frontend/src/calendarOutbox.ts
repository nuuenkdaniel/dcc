import {protectedFetch} from './auth'
import {snapshotConfirmsChange,type CalendarConfirmationSnapshot} from './calendarProjection'

export type Change={operation?:'delete';id:string;calendarId:string;eventId?:string;etag?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
export type Pending={change:Change;createdAt?:string;error?:string;conflict?:boolean;awaitingConfirmation?:boolean}
const sending=new Set<string>()
const listeners=new Set<()=>void>()
const notify=()=>listeners.forEach(listener=>listener())
export const isSending=(id:string)=>sending.has(id)
export function subscribeOutbox(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
async function db(){return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('daymark-calendar-outbox',1);r.onupgradeneeded=()=>r.result.createObjectStore('changes',{keyPath:'change.id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function pending(action?:Pending|string):Promise<Pending[]>{const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction('changes',action===undefined?'readonly':'readwrite');const store=tx.objectStore('changes');if(typeof action==='string')store.delete(action);else if(action)store.put({...action,createdAt:action.createdAt??new Date().toISOString()});const r=store.getAll();tx.oncomplete=()=>{if(action!==undefined)notify();resolve(r.result)};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{d.close()}}
export async function flush(){
 const queued=(await pending()).filter(value=>!value.conflict&&!value.awaitingConfirmation)
 if(!navigator.locks?.request){for(const item of queued)await pending({...item,error:'Automatic calendar sync is unavailable; draft retained.'});return 0}
 return navigator.locks.request('daymark-calendar-outbox',async()=>{
  let sent=0
  for(;;){
   const item=(await pending()).find(value=>!value.conflict&&!value.awaitingConfirmation)
   if(!item)break
   sending.add(item.change.id);notify()
   try{
     const r=await protectedFetch('/api/v1/calendar/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.change),signal:AbortSignal.timeout(45000)})
     if(r.ok){await pending({...item,error:undefined,awaitingConfirmation:true});sent++;continue}
     if(r.status===401||r.status===403){await pending({...item,error:'Sign in to send this change.'});break}
     const conflict=r.status===409
     await pending({...item,error:conflict?'Changed in Nextcloud. Discard this draft, refresh, then review the latest event before editing again.':'Save failed; draft retained. Check calendar permission and dates.',conflict})
     break
    }catch{break}finally{sending.delete(item.change.id);notify()}
   }
  return sent
  })
}

export async function reconcile(snapshot:CalendarConfirmationSnapshot){
 for(const item of await pending()){
  if(!item.awaitingConfirmation)continue
  if(snapshotConfirmsChange(item,snapshot))await pending(item.change.id)
 }
 return pending()
}
