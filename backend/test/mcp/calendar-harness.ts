// Synthetic SQL/provider harness only. Never falls through to network or a DB.
import {ServicePool} from './service-pool.js'
import {buildEventResource,type EventChange} from '../../src/calendar-write.js'
import {sourceHash,type Snapshot} from '../../src/sync.js'

export const config={url:'https://synthetic.invalid/',username:'synthetic',password:'synthetic-not-a-secret',interval:600,past:30,future:12}
export const mutation='12345678-1234-4234-a234-123456789abc'
export const change:EventChange={id:mutation,calendarId:'Calendar_A',title:'Synthetic event',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false,description:'Synthetic description',location:'Synthetic location'}
export class CalendarHarness extends ServicePool {
  ledger=new Map<string,{id:string;payload_hash:string;result:any}>()
  snapshot:Snapshot={calendars:[{id:'Calendar_A',name:'Synthetic calendar',url:'https://synthetic.invalid/calendar/'}],events:[],coverageStart:'2026-11-01T00:00:00Z',coverageEnd:'2026-12-01T00:00:00Z'}
  resources=new Map<string,{body:string;etag:string}>()
  fetches:{url:string;method:string;headers:Headers}[]=[]
  puts=0
  appliedPuts=0
  losePutResponse=false
  failVerify=false
  failPut=false
  omitEtags=false
  failCompletion=false
  failBeforePut=false
  zeroLedgerUpdate:'attempted'|'saved'|undefined
  private tail:Promise<void>=Promise.resolve()
  seedEvent(extraIcs=''){
    const resource='https://synthetic.invalid/calendar/existing.ics'
    const body=buildEventResource({...change,id:'original'}).replace('END:VEVENT',`${extraIcs?extraIcs+'\r\n':''}END:VEVENT`)
    this.resources.set(resource,{body,etag:'"original"'})
    this.snapshot.events=[{id:'snapshot-event-id',calendarId:'Calendar_A',resource,etag:'"original"',uid:'original@daymark',recurrenceId:null,title:change.title,description:change.description,location:change.location,start:change.start,end:change.end,allDay:false}]
    return {...change,eventId:'snapshot-event-id',etag:'"original"'}
  }
  override async connect(){
    const base=await super.connect()
    let unlock:(()=>void)|undefined
    return {query:async(sql:string,args:unknown[]=[])=>{
      const result=(rows:any[]=[],rowCount=rows.length)=>({rows,rowCount})
      if(sql==='SELECT pg_advisory_lock(817332)'){
        const prior=this.tail;this.tail=new Promise<void>(resolve=>{unlock=resolve});await prior
        return result([{}])
      }
      if(sql==='SELECT pg_advisory_unlock(817332)'){unlock?.();unlock=undefined;return result([{}])}
      if(sql==='SELECT * FROM calendar_mutations WHERE id=$1')return result(this.ledger.has(String(args[0]))?[structuredClone(this.ledger.get(String(args[0])))]:[])
      if(sql.startsWith('SELECT snapshot,source_hash FROM calendar_sync_state'))return result([{snapshot:structuredClone(this.snapshot),source_hash:sourceHash(config)}])
      if(sql.startsWith('INSERT INTO calendar_mutations')){
        const [id,fingerprint,raw]=args,key=String(id),old=this.ledger.get(key)
        if(old){
          if(sql.includes('DO UPDATE')&&raw!==undefined){old.result=JSON.parse(String(raw));return result([{id:key}])}
          return result()
        }
        this.ledger.set(key,{id:key,payload_hash:String(fingerprint),result:raw===undefined?null:JSON.parse(String(raw))})
        return result([{id:key}])
      }
      if(sql.startsWith('UPDATE calendar_mutations SET result=$3')){
        const [id,fingerprint,raw]=args,row=this.ledger.get(String(id))
        if(!row||row.payload_hash!==fingerprint)return result()
        const next=JSON.parse(String(raw))
        if(this.zeroLedgerUpdate&&(next.phase===this.zeroLedgerUpdate||next.saved===true&&this.zeroLedgerUpdate==='saved')){this.zeroLedgerUpdate=undefined;return result()}
        if(this.failCompletion&&next.saved===true){this.failCompletion=false;throw Error('Synthetic completion SQL failure')}
        if(this.failBeforePut&&next.phase==='attempted'){this.failBeforePut=false;throw Error('Synthetic crash before dispatch marker')}
        row.result=next
        return result([{id:String(id)}])
      }
      if(sql==='UPDATE calendar_sync_state SET next_run=now() WHERE id=1')return result([],1)
      return base.query(sql,args)
    },release:()=>{unlock?.();base.release()}}
  }
  fetch:typeof fetch=async(input,init)=>{
    const url=String(input),method=init?.method??'GET',headers=new Headers(init?.headers)
    if(!url.startsWith('https://synthetic.invalid/calendar/'))throw Error('Synthetic origin violation')
    this.fetches.push({url,method,headers})
    if(method==='PUT'){
      this.puts++
      const old=this.resources.get(url)
      if(headers.get('if-none-match')==='*'&&old||headers.has('if-match')&&headers.get('if-match')!==old?.etag)return new Response(null,{status:412})
      if(this.failPut)return new Response(null,{status:500})
      const etag=`"provider-${this.puts}"`
      this.appliedPuts++
      this.resources.set(url,{body:String(init?.body),etag})
      if(this.losePutResponse){this.losePutResponse=false;throw Error('Synthetic lost PUT reply after provider applied')}
      return new Response(null,{status:201,headers:this.omitEtags?{}:{etag}})
    }
    if(method!=='GET')throw Error('Unexpected synthetic method')
    if(this.failVerify&&this.puts>0)throw Error('Synthetic readback unavailable')
    const resource=this.resources.get(url)
    return resource?new Response(resource.body,{status:200,headers:this.omitEtags?{}:{etag:resource.etag}}):new Response(null,{status:404})
  }
}
