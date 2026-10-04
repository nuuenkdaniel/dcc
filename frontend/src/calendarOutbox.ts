export type Change={id:string;calendarId:string;eventId?:string;etag?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
export type Pending={change:Change;error?:string;conflict?:boolean}
async function db(){return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('daymark-calendar-outbox',1);r.onupgradeneeded=()=>r.result.createObjectStore('changes',{keyPath:'change.id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
export async function pending(action?:Pending|string):Promise<Pending[]>{const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction('changes',action===undefined?'readonly':'readwrite');const store=tx.objectStore('changes');if(typeof action==='string')store.delete(action);else if(action)store.put(action);const r=store.getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{d.close()}}
export async function flush(){
 return navigator.locks.request('daymark-calendar-outbox',async()=>{
  for(const item of await pending()){
   if(item.conflict)continue
   try{
    const r=await fetch('/api/v1/calendar/changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.change),signal:AbortSignal.timeout(45000)})
    if(r.ok){await pending(item.change.id);continue}
    if(r.status===401||r.status===403){await pending({...item,error:'Sign in to send this change.'});break}
    const conflict=r.status===409
    await pending({...item,error:conflict?'Changed in Nextcloud. Discard this draft, refresh, then review the latest event before editing again.':'Save failed; draft retained. Check calendar permission and dates.',conflict})
    break
   }catch{break}
  }
 })
}
