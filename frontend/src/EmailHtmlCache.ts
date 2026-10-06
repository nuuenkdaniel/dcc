import {sanitizeEmailHtml} from './emailHtml'

export const EMAIL_HTML_CACHE_MAX_ENTRIES=20
export const EMAIL_HTML_CACHE_MAX_BYTES=4*1024*1024
export const EMAIL_HTML_FETCH_TIMEOUT_MS=15_000

export type EmailHtmlResult={kind:'html';srcDoc:string;bytes:number}|{kind:'no-html'}
type FetchLike=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>

export class EmailHtmlCache{
 private entries=new Map<string,EmailHtmlResult>()
 private inFlight=new Map<string,Promise<EmailHtmlResult>>()
 private controllers=new Set<AbortController>()
 private totalBytes=0
 private destroyed=false
 private destroyTimer:ReturnType<typeof setTimeout>|undefined
 private readonly fetcher:FetchLike

 constructor(fetcher:FetchLike=(input,init)=>fetch(input,init)){this.fetcher=fetcher}

 retain(){
  if(this.destroyTimer!==undefined){clearTimeout(this.destroyTimer);this.destroyTimer=undefined}
 }

 release(){
  if(this.destroyed)return
  this.destroyTimer=setTimeout(()=>{this.destroyTimer=undefined;this.destroy()},0)
 }

 get(id:string){
  const entry=this.entries.get(id)
  if(!entry)return undefined
  this.entries.delete(id);this.entries.set(id,entry)
  return entry
 }

 load(id:string){
  const cached=this.get(id)
  if(cached)return Promise.resolve(cached)
  const existing=this.inFlight.get(id)
  if(existing)return existing

  const controller=new AbortController();this.controllers.add(controller)
  let timer:ReturnType<typeof setTimeout>|undefined
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Formatted email request timed out.'))},EMAIL_HTML_FETCH_TIMEOUT_MS)})
  const retrieval=this.fetcher(`/api/v1/mail/html/${encodeURIComponent(id)}`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw new Error('Formatted email request failed.')
   const data:unknown=await response.json(),payload=typeof data==='object'&&data!==null?data as {html?:unknown;hasHtml?:unknown}:null
   const html=payload?.html
   if(html===null||payload?.hasHtml===false)return {kind:'no-html'} as const
   if(typeof html!=='string')throw new Error('Formatted email response was invalid.')
   const srcDoc=sanitizeEmailHtml(html)
   return {kind:'html',srcDoc,bytes:new TextEncoder().encode(srcDoc).byteLength} as const
  })
  const shared=Promise.race([retrieval,timeout]).then(result=>{if(!this.destroyed)this.store(id,result);return result}).finally(()=>{
   if(timer!==undefined)clearTimeout(timer);this.controllers.delete(controller)
   if(this.inFlight.get(id)===shared)this.inFlight.delete(id)
  })
  this.inFlight.set(id,shared)
  return shared
 }

 private store(id:string,result:EmailHtmlResult){
  if(result.kind==='html'&&result.bytes>EMAIL_HTML_CACHE_MAX_BYTES)return
  const previous=this.entries.get(id)
  if(previous?.kind==='html')this.totalBytes-=previous.bytes
  this.entries.delete(id);this.entries.set(id,result)
  if(result.kind==='html')this.totalBytes+=result.bytes
  while(this.entries.size>EMAIL_HTML_CACHE_MAX_ENTRIES||this.totalBytes>EMAIL_HTML_CACHE_MAX_BYTES){
   const oldest=this.entries.entries().next().value as [string,EmailHtmlResult]|undefined
   if(!oldest)break
   this.entries.delete(oldest[0]);if(oldest[1].kind==='html')this.totalBytes-=oldest[1].bytes
  }
 }

 stats(){return {entries:this.entries.size,htmlBytes:this.totalBytes,inFlight:this.inFlight.size}}

 destroy(){
  this.destroyed=true
  if(this.destroyTimer!==undefined){clearTimeout(this.destroyTimer);this.destroyTimer=undefined}
  for(const controller of this.controllers)controller.abort()
  this.controllers.clear();this.inFlight.clear();this.entries.clear();this.totalBytes=0
 }
}
