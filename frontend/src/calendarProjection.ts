import type {Pending} from './calendarOutbox'

export type CalendarEvent={id:string;calendarId:string;etag?:string;uid?:string;recurrenceId?:string|null;mutationId?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string;pendingMutationId?:string;pendingError?:string}
export type CalendarConfirmationSnapshot={events:CalendarEvent[];error?:string;coverageStart?:string;coverageEnd?:string}

const sameValues=(event:CalendarEvent,change:Pending['change'])=>event.title===change.title&&event.start===change.start&&event.end===change.end&&event.allDay===change.allDay&&event.description===change.description&&event.location===change.location
export function snapshotConfirmsChange(item:Pending,snapshot:CalendarConfirmationSnapshot){
 const change=item.change
 const scoped=snapshot.events.filter(event=>event.calendarId===change.calendarId)
 const occurrence=change.eventId?scoped.find(event=>event.id===change.eventId):undefined
 if(change.operation==='delete'){
  if(snapshot.error||!snapshot.coverageStart||!snapshot.coverageEnd||occurrence)return false
  const affected=Date.parse(change.start)
  return Number.isFinite(affected)&&affected>=Date.parse(snapshot.coverageStart)&&affected<Date.parse(snapshot.coverageEnd)
 }
 return scoped.some(event=>event.mutationId===change.id||(change.eventId?event.id===change.eventId&&sameValues(event,change):event.uid===`${change.id}@daymark`&&sameValues(event,change)))
}

export function projectCalendarChanges(events:CalendarEvent[],items:Pending[]):CalendarEvent[]{
 const projected=[...events]
 for(const item of [...items].sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''))){
  const change=item.change
  if(change.operation==='delete'){
   const index=projected.findIndex(event=>event.id===change.eventId&&event.calendarId===change.calendarId)
   if(index>=0)projected.splice(index,1)
   continue
  }
  if(change.eventId){
   const index=projected.findIndex(event=>event.id===change.eventId&&event.calendarId===change.calendarId)
   if(index>=0)projected[index]={...projected[index]!,...change,id:change.eventId,pendingMutationId:change.id,...(item.error?{pendingError:item.error}:{})}
   else if(!projected.some(event=>event.calendarId===change.calendarId&&event.mutationId===change.id))projected.push({...change,id:`pending:${change.id}`,pendingMutationId:change.id,...(item.error?{pendingError:item.error}:{})})
   continue
  }
  if(projected.some(event=>event.calendarId===change.calendarId&&(event.mutationId===change.id||event.uid===`${change.id}@daymark`)))continue
  projected.push({...change,id:`pending:${change.id}`,uid:`${change.id}@daymark`,pendingMutationId:change.id,...(item.error?{pendingError:item.error}:{})})
 }
 return projected
}
