import {DAVClient} from 'tsdav'
export function readCalendarConfig(env:NodeJS.ProcessEnv=process.env) {
 if(env.NEXTCLOUD_SYNC_ENABLED!=='true') return null
 if(!env.NEXTCLOUD_URL || !env.NEXTCLOUD_USERNAME || !env.NEXTCLOUD_APP_PASSWORD) throw new Error('Nextcloud configuration incomplete')
 const url=new URL(env.NEXTCLOUD_URL)
 if(url.protocol!=='https:' || url.username || url.password) throw new Error('Nextcloud requires HTTPS without URL credentials')
 const number=(key:string,fallback:number,max:number)=>{const n=Number(env[key]??fallback);if(!Number.isInteger(n)||n<1||n>max)throw new Error('Invalid calendar interval or coverage');return n}
 return {url:url.href,username:env.NEXTCLOUD_USERNAME,password:env.NEXTCLOUD_APP_PASSWORD,interval:number('CALENDAR_SYNC_INTERVAL_SECONDS',600,86400),past:number('CALENDAR_PAST_DAYS',30,365),future:number('CALENDAR_FUTURE_MONTHS',12,24)}
}
export type CalendarConfig=NonNullable<ReturnType<typeof readCalendarConfig>>
export function calendarClient(config:CalendarConfig) {
 const origin=new URL(config.url).origin
 let discovering=true
 const safeFetch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
  if(url.origin!==origin) throw new Error('CalDAV origin not permitted')
  let response=await fetch(input,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)})
  for(let hops=0;[301,302,303,307,308].includes(response.status);hops++) {
   if(hops>=4) throw new Error('CalDAV redirect limit')
   const location=response.headers.get('location')
   if(!location) throw new Error('CalDAV redirect missing location')
   const next=new URL(location,response.url)
   if(next.origin!==origin) throw new Error('CalDAV origin not permitted')
   if(init?.redirect==='manual') return response
   await response.body?.cancel()
   response=await fetch(next,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)})
  }
  if(!response.ok && !discovering) throw new Error(response.status===401||response.status===403?'CALDAV_AUTH':`CALDAV_REQUEST_${response.status}`)
  return response
 }
 const client=new DAVClient({serverUrl:config.url,credentials:{username:config.username,password:config.password},authMethod:'Basic',defaultAccountType:'caldav',fetch:safeFetch})
 const login=client.login.bind(client)
 client.login=async options=>{try {await login(options)}finally{discovering=false}}
 return client
}
