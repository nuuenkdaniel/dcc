import type {MailMessage,MailSnapshot} from './useMail'

const DATABASE='daymark-mail-paged'
const VERSION=1
const LEGACY_DATABASE='daymark-mail'
const LEGACY_STORE='cache'
const MIGRATION_KEY='__legacy_snapshot_migrated__'
export const DEFAULT_MAIL_PAGE_KEY='account=all&q=&important=false'
export const LEGACY_MAIL_PAGE_KEY='__legacy_snapshot_archive__'

export type StoredMailPage={messages:MailMessage[];overflow?:MailMessage[];accounts:MailSnapshot['accounts'];today:string;briefing:MailMessage[];nextCursor:string|null;total:number}

function requestResult<T>(request:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transactionDone(transaction:IDBTransaction){return new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error)})}
function openPaged(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DATABASE,VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('pages'))db.createObjectStore('pages');if(!db.objectStoreNames.contains('bodies'))db.createObjectStore('bodies')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}

export async function readMailPage(key:string){const db=await openPaged();try{const transaction=db.transaction('pages','readonly');const result=await requestResult(transaction.objectStore('pages').get(key));await transactionDone(transaction);return result as StoredMailPage|undefined}finally{db.close()}}
export async function writeMailPage(key:string,value:StoredMailPage){const db=await openPaged();try{const transaction=db.transaction('pages','readwrite');transaction.objectStore('pages').put(value,key);await transactionDone(transaction)}finally{db.close()}}
export async function readMailBody(id:string){const db=await openPaged();try{const transaction=db.transaction('bodies','readonly');const result=await requestResult(transaction.objectStore('bodies').get(id));await transactionDone(transaction);return typeof result==='string'?result:undefined}finally{db.close()}}
export async function writeMailBody(id:string,body:string){const db=await openPaged();try{const transaction=db.transaction('bodies','readwrite');transaction.objectStore('bodies').put(body,id);await transactionDone(transaction)}finally{db.close()}}
export async function patchMailOverride(id:string,override:boolean|null){
 const db=await openPaged()
 try{
  const transaction=db.transaction('pages','readwrite'),store=transaction.objectStore('pages'),request=store.openCursor()
  request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const value=cursor.value as StoredMailPage|boolean;if(value&&typeof value==='object'&&Array.isArray(value.messages)){const patch=(messages:MailMessage[]|undefined)=>messages?.map(message=>message.data.id===id?{...message,override}:message),next={...value,messages:patch(value.messages)!,overflow:patch(value.overflow),briefing:patch(value.briefing)!};cursor.update(next)}cursor.continue()}
  await transactionDone(transaction)
 }finally{db.close()}
}

type LegacySnapshot={messages:MailMessage[];accounts:MailSnapshot['accounts'];today:string}
async function readLegacySnapshot(){
 return new Promise<LegacySnapshot|undefined>((resolve,reject)=>{let newDatabase=false;const request=indexedDB.open(LEGACY_DATABASE,1)
  request.onupgradeneeded=()=>{newDatabase=true;request.transaction?.abort()}
  request.onerror=()=>newDatabase?resolve(undefined):reject(request.error)
  request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains(LEGACY_STORE)){db.close();resolve(undefined);return}const transaction=db.transaction(LEGACY_STORE,'readonly'),get=transaction.objectStore(LEGACY_STORE).get('snapshot');transaction.oncomplete=()=>{db.close();const value=get.result as Partial<LegacySnapshot>|undefined;resolve(value&&Array.isArray(value.messages)&&Array.isArray(value.accounts)&&typeof value.today==='string'?value as LegacySnapshot:undefined)};transaction.onerror=()=>{db.close();reject(transaction.error)};transaction.onabort=()=>{db.close();reject(transaction.error)}}
 })
}

function withoutBody(message:MailMessage):MailMessage{const data={...message.data};delete data.body;return {...message,data}}
function legacyBriefing(snapshot:LegacySnapshot){return snapshot.messages.filter(message=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(message.data.receivedAt));return day===snapshot.today&&(message.override??message.analysis?.important??false)}).map(withoutBody)}

export async function migrateLegacyMail(){
 const existing=await openPaged()
 try{const transaction=existing.transaction('pages','readonly'),migrated=await requestResult(transaction.objectStore('pages').get(MIGRATION_KEY));await transactionDone(transaction);if(migrated)return}finally{existing.close()}
 const legacy=await readLegacySnapshot()
 if(!legacy)return
 const target=await openPaged()
 try{
  const transaction=target.transaction(['pages','bodies'],'readwrite'),pages=transaction.objectStore('pages'),bodies=transaction.objectStore('bodies')
  const migrated=await requestResult(pages.get(MIGRATION_KEY))
  if(!migrated){
   const metadata=legacy.messages.map(withoutBody),first=metadata.slice(0,100),overflow=metadata.slice(100)
   for(const message of legacy.messages){const body=message.data.body;if(typeof body==='string'){const get=bodies.get(message.data.id);get.onsuccess=()=>{if(get.result===undefined)bodies.put(body,message.data.id)}}}
   const archived=await requestResult(pages.get(LEGACY_MAIL_PAGE_KEY))
   if(!archived)pages.put({messages:first,overflow,accounts:legacy.accounts,today:legacy.today,briefing:legacyBriefing(legacy),nextCursor:null,total:metadata.length} satisfies StoredMailPage,LEGACY_MAIL_PAGE_KEY)
   const existing=await requestResult(pages.get(DEFAULT_MAIL_PAGE_KEY))
   if(!existing)pages.put({messages:first,overflow,accounts:legacy.accounts,today:legacy.today,briefing:legacyBriefing(legacy),nextCursor:null,total:metadata.length} satisfies StoredMailPage,DEFAULT_MAIL_PAGE_KEY)
    pages.put(true,MIGRATION_KEY)
   }
  await transactionDone(transaction)
 }finally{target.close()}
}
