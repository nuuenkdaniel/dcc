// Read-only recovery for drafts written by the previous browser calendar flow.
export type Change={operation?:'delete';id:string;calendarId:string;eventId?:string;etag?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
export type Pending={change:Change;createdAt?:string;error?:string;conflict?:boolean;awaitingConfirmation?:boolean}

export async function pending():Promise<Pending[]>{
 const database=await new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('daymark-calendar-outbox',1)
  request.onupgradeneeded=()=>request.result.createObjectStore('changes',{keyPath:'change.id'})
  request.onsuccess=()=>resolve(request.result)
  request.onerror=()=>reject(request.error)
 })
 try{
  return await new Promise((resolve,reject)=>{
   const transaction=database.transaction('changes','readonly')
   const request=transaction.objectStore('changes').getAll()
   transaction.oncomplete=()=>resolve(request.result)
   transaction.onerror=()=>reject(transaction.error)
   transaction.onabort=()=>reject(transaction.error)
  })
 }finally{database.close()}
}
