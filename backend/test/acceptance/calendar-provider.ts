// Synthetic resource-level CalDAV fixture. Importing does not listen or use PG.
// Real GET/conditional PUT, real ICS; not a DAV discovery/auth interoperability test.
import {createServer,type Server} from 'node:http'
import {createHash} from 'node:crypto'
import ICAL from 'ical.js'
import type {Pool} from 'pg'
import {parseExpandedEvents} from '../../src/events.js'
import {sourceHash,type Snapshot} from '../../src/sync.js'

export const PROVIDER='http://127.0.0.1:18535'
export const calendarConfig={url:PROVIDER+'/',username:'synthetic-calendar',password:'synthetic-only',interval:600,past:60,future:6}
export const EASTERN_ZONE=['BEGIN:VTIMEZONE','TZID:America/New_York',
  'BEGIN:STANDARD','DTSTART:19701101T020000','TZOFFSETFROM:-0400','TZOFFSETTO:-0500','RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU','END:STANDARD',
  'BEGIN:DAYLIGHT','DTSTART:19700308T020000','TZOFFSETFROM:-0500','TZOFFSETTO:-0400','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU','END:DAYLIGHT','END:VTIMEZONE'].join('\r\n')
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
export const calendars=['School','Work'].map(name=>({id:hash(PROVIDER+'/'+name.toLowerCase()+'/'),name,url:PROVIDER+'/'+name.toLowerCase()+'/'}))
export type Resource={body:string;etag:string}
export type ProviderEvent={method:'GET'|'PUT';path:string;code:number;ifMatch?:string;ifNoneMatch?:string;bodySha256?:string;etag?:string}
export function allowedResource(path:string){return /^\/(school|work)\/[a-zA-Z0-9-]{1,100}\.ics$(?![\s\S])/.test(path)}
export function putStatus(old:Resource|undefined,ifMatch:string|undefined,ifNoneMatch:string|undefined){
  return old?ifMatch===old.etag&&ifNoneMatch===undefined?204:412:ifNoneMatch==='*'&&ifMatch===undefined?201:412
}
export function expanded(raw:string,calendarId:string,url:string,etag:string){
  const root=new ICAL.Component(ICAL.parse(raw))
  for(const zone of root.getAllSubcomponents('vtimezone')){const tzid=String(zone.getFirstPropertyValue('tzid'));ICAL.TimezoneService.register(new ICAL.Timezone({component:zone,tzid}),tzid)}
  const components=root.getAllSubcomponents('vevent'),master=components.find(c=>!c.hasProperty('recurrence-id'))
  if(!master)throw Error('Synthetic master missing')
  const event=new ICAL.Event(master)
  for(const component of components.filter(c=>c.hasProperty('recurrence-id')))event.relateException(new ICAL.Event(component))
  const out=new ICAL.Component('vcalendar');out.addPropertyWithValue('version','2.0')
  for(const zone of root.getAllSubcomponents('vtimezone'))out.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(zone.toJSON()))))
  const times:ICAL.Time[]=[]
  if(event.isRecurring()){
    const iterator=event.iterator()
    for(let i=0;i<64;i++){const next=iterator.next();if(!next)break;times.push(next);if(i===63)throw Error('Synthetic recurrence bound')}
  }else times.push(event.startDate)
  for(const time of times){
    const details=event.getOccurrenceDetails(time)
    const item=new ICAL.Component(JSON.parse(JSON.stringify(details.item.component.toJSON())))
    for(const name of ['rrule','rdate','exdate','dtstart','dtend','duration','recurrence-id'])item.removeAllProperties(name)
    const addTime=(name:string,value:ICAL.Time)=>{
      const property=new ICAL.Property(name);property.setValue(value)
      if(!value.isDate&&value.zone!==ICAL.Timezone.utcTimezone&&value.zone!==ICAL.Timezone.localTimezone)property.setParameter('tzid',value.zone.tzid)
      item.addProperty(property)
    }
    addTime('dtstart',details.startDate);addTime('dtend',details.endDate)
    if(event.isRecurring())addTime('recurrence-id',time)
    out.addSubcomponent(item)
  }
  return parseExpandedEvents(out.toString(),calendarId,url,etag)
}

export class SyntheticCalendarProvider {
  readonly resources=new Map<string,Resource>()
  readonly events:ProviderEvent[]=[]
  private server:Server|undefined
  constructor(readonly year:2026|2030=2026){
    if(year!==2026&&year!==2030)throw Error('Synthetic calendar year refused')
    for(const calendar of calendars){
      const path=new URL(calendar.url).pathname+'zone-donor.ics'
      this.resources.set(path,{etag:'"synthetic-donor-1"',body:['BEGIN:VCALENDAR','VERSION:2.0',EASTERN_ZONE,'BEGIN:VEVENT',`UID:qa-zone-${calendar.name}`,'SUMMARY:Synthetic timezone donor',`DTSTART;TZID=America/New_York:${year}1026T090000`,`DTEND;TZID=America/New_York:${year}1026T100000`,'END:VEVENT','END:VCALENDAR'].join('\r\n')})
    }
  }
  async start(){
    if(this.server)throw Error('Already started')
    const server=createServer(async(req,res)=>{
      try{
        const path=req.url??''
        if(req.headers.authorization!=='Basic '+Buffer.from('synthetic-calendar:synthetic-only').toString('base64')){res.writeHead(401);res.end();return}
        if(!allowedResource(path)||!['GET','PUT'].includes(req.method??'')){res.writeHead(403);res.end();return}
        if(this.events.length>=256){res.writeHead(429);res.end();return}
        const old=this.resources.get(path)
        if(req.method==='GET'){
          this.events.push({method:'GET',path,code:old?200:404,...(old?{etag:old.etag}:{})})
          res.writeHead(old?200:404,old?{'Content-Type':'text/calendar',ETag:old.etag}:{})
          res.end(old?.body);return
        }
        const match=typeof req.headers['if-match']==='string'?req.headers['if-match']:undefined
        const none=typeof req.headers['if-none-match']==='string'?req.headers['if-none-match']:undefined
        let body=''
        for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>200000){res.writeHead(413);res.end();return}}
        // Recheck after reading the body: concurrent conditional PUTs must not
        // both win against an ETag captured before this asynchronous boundary.
        const code=putStatus(this.resources.get(path),match,none)
        const event:ProviderEvent={method:'PUT',path,code,...(match?{ifMatch:match}:{}),...(none?{ifNoneMatch:none}:{}),bodySha256:hash(body)}
        if(code!==412){
          const parsed=new ICAL.Component(ICAL.parse(body))
          if(parsed.name!=='vcalendar'||parsed.getAllSubcomponents('vevent').length>12)throw Error('Invalid bounded ICS')
          const etag='"qa-'+hash(body).slice(0,24)+'"'
          this.resources.set(path,{body,etag});event.etag=etag
        }
        this.events.push(event);res.writeHead(code,event.etag?{ETag:event.etag}:{});res.end()
      }catch{if(!res.headersSent)res.writeHead(400);res.end()}
    })
    server.requestTimeout=15000;server.headersTimeout=10000
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(18535,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()})})
    this.server=server
  }
  async snapshot():Promise<Snapshot>{
    const snapshot:Snapshot={calendars:structuredClone(calendars),events:[],coverageStart:`${this.year}-10-01T00:00:00Z`,coverageEnd:`${this.year}-12-01T00:00:00Z`}
    // Discover only the fixture's own finite resource set. Every ICS body/ETag
    // comes through actual HTTP GET, never from an injected success value.
    for(const path of this.resources.keys()){
      const response=await fetch(PROVIDER+path,{headers:{Authorization:'Basic '+Buffer.from('synthetic-calendar:synthetic-only').toString('base64')},redirect:'error',signal:AbortSignal.timeout(5000)})
      if(response.status!==200)throw Error('Synthetic snapshot GET failed')
      const calendar=calendars.find(c=>path.startsWith(new URL(c.url).pathname))!
      snapshot.events.push(...expanded(await response.text(),calendar.id,PROVIDER+path,response.headers.get('etag')??''))
    }
    return snapshot
  }
  async refresh(pool:Pool){
    const snapshot=await this.snapshot()
    await pool.query('UPDATE calendar_sync_state SET snapshot=$1,source_hash=$2,last_success=now() WHERE id=1',[snapshot,sourceHash(calendarConfig)])
    return snapshot
  }
  async close(){const server=this.server;this.server=undefined;if(server)await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections()})}
}
