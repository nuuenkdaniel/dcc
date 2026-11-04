import {CalendarHarness,change} from './calendar-harness.js'

export const projectId='12345678-1234-4234-a234-123456789abc'
export const actionId='22345678-1234-4234-a234-123456789abc'
export const preparationId='32345678-1234-4234-a234-123456789abc'
// Synthetic data only; unknown queries still fail in the parent harness. This
// models query contracts, not PostgreSQL isolation or live integration behavior.
export class ProductPool extends CalendarHarness {
  constructor(){
    super();this.seedEvent('RRULE:FREQ=WEEKLY;COUNT=4')
    this.seed({id:projectId,kind:'project',version:1,data:{id:projectId,title:'Synthetic project',description:'',progress:'',deadline:'',category:'personal',importance:2,remainingMinutes:0,status:'active',unknown:'retain'}})
    this.seed({id:actionId,kind:'action',version:1,data:{id:actionId,title:'Synthetic generated action',projectId,date:'2026-11-02',notes:'',minutes:30,completed:false,dismissed:false,unknown:'retain'}})
    this.seed({id:preparationId,kind:'preparation',version:1,data:{id:preparationId,title:'Synthetic preparation',event:{id:'snapshot-event-id',calendarId:'Calendar_A',uid:'original@daymark',recurrenceId:null,start:change.start,allDay:false},startDate:'2026-10-01',status:'active',topics:[{id:'topic',title:'Synthetic topic',notes:'',minutes:30}],progress:'',unknown:'retain'}})
  }
  override async connect(){
    const base=await super.connect()
    return {query:async(sql:string,args:unknown[]=[])=>{
      const result=(rows:unknown[]=[])=>({rows,rowCount:rows.length})
      if(sql.startsWith('SELECT id,kind,version,data FROM planner_entities WHERE kind=$1'))return result([...this.rows.values()].filter(r=>r.kind===args[0]&&(!args[1]||r.id===args[1])&&(!args[2]||r.data.date>=String(args[2])&&r.data.date<String(args[3]))).sort((a,b)=>a.id.localeCompare(b.id)).slice(Number(args[5]),Number(args[5])+Number(args[4])))
      if(sql==='SELECT snapshot FROM calendar_sync_state WHERE id=1')return result([{snapshot:this.snapshot}])
      if(sql.startsWith('SELECT id,data->>'))return result([{id:'synthetic-mail',sender:'Synthetic sender',subject:'Synthetic cached message',received_at:'2026-11-02T10:00:00Z',account:'personal',important:true,summary:'Synthetic summary',html:'must-not-leak',providerToken:'must-not-leak'}].slice(Number(args[4]),Number(args[4])+Number(args[3])))
      if(sql.startsWith('SELECT id,substring(')){
        if(args[0]!=='synthetic-mail')return result()
        const text=Array.from('Synthetic 😀 cached body')
        return result([{id:'synthetic-mail',body:text.slice(Number(args[1])-1,Number(args[1])-1+Number(args[2])).join(''),body_length:text.length}])
      }
      if(sql.startsWith('SELECT id,title,target_cents,paused FROM price_items'))return result([{id:'synthetic-price',title:'Synthetic price item',target_cents:10000,paused:false}].slice(Number(args[1]),Number(args[1])+Number(args[0])))
      if(sql.startsWith('SELECT item_id,store,status,last_good FROM price_sources'))return result([{item_id:'synthetic-price',store:'dell',status:'verified',last_good:{url:'https://must-not-leak.invalid',observedAt:'2026-11-02T10:00:00Z',offers:[{condition:'new',cents:9000,currency:'USD',eligible:true,availability:'Synthetic stock',url:'https://must-not-leak.invalid'}]}}])
      return base.query(sql,args)
    },release:base.release}
  }
}
