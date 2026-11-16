import {useState} from 'react'
import {type Change} from './calendarOutbox'
import {AccessibleDialog} from './AccessibleDialog'
export type EditableEvent={id:string;calendarId:string;etag?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
const localTime=(value:string)=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
export function CalendarEditor({date,calendars,event,draft,onClose,onSave}:{date:string;calendars:{id:string;name:string}[];event?:EditableEvent;draft?:Change;onClose:()=>void;onSave:(change:Change)=>boolean}){
 const [title,setTitle]=useState(draft?.title??event?.title??'')
 const [allDay,setAllDay]=useState(draft?.allDay??event?.allDay??false)
 const [calendar,setCalendar]=useState(draft?.calendarId??event?.calendarId??calendars[0]?.id??'')
 const [start,setStart]=useState((draft??event)?(allDay?(draft??event)!.start:localTime((draft??event)!.start)):`${date}T09:00`)
 const [end,setEnd]=useState((draft??event)?(allDay?(draft??event)!.end:localTime((draft??event)!.end)):`${date}T10:00`)
 const [description,setDescription]=useState(draft?.description??event?.description??'')
 const [location,setLocation]=useState(draft?.location??event?.location??'')
 const [error,setError]=useState('')
 const [confirmDelete,setConfirmDelete]=useState(false)
 const save=(deleting=false)=>{
  if(new Date(end)<=new Date(start)){setError('End must be after start.');return}
  try{
   const change:Change={id:crypto.randomUUID(),...(deleting?{operation:'delete'}:{}),calendarId:calendar,title,start:allDay?start:new Date(start).toISOString(),end:allDay?end:new Date(end).toISOString(),allDay,description,location,...(event?{eventId:event.id,etag:event.etag??''}:{})}
   if(onSave(change))onClose()
   else setError('Connect to save, or wait for this event’s current save.')
  }catch{setError('Check the event dates and try again.')}
 }
 return <AccessibleDialog label={event?'Edit event':'New event'} onClose={onClose}><section className="timer-dialog"><h2>{event?'Edit this occurrence':'New event'}</h2><form className="calendar-login" onSubmit={e=>{e.preventDefault();save()}}>
 <label>Event title<input required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Calendar<select disabled={!!event} value={calendar} onChange={e=>setCalendar(e.target.value)}>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label className="priority-toggle"><input type="checkbox" checked={allDay} onChange={e=>{setAllDay(e.target.checked);if(e.target.checked){setStart(start.slice(0,10));const next=new Date(`${start.slice(0,10)}T12:00:00`);next.setDate(next.getDate()+1);setEnd(localTime(next.toISOString()).slice(0,10))}else{setStart(start+'T09:00');setEnd(end+'T10:00')}}}/>All day</label>
 <label>Starts<input required type={allDay?'date':'datetime-local'} value={start} onChange={e=>setStart(e.target.value)}/></label><label>{allDay?'Ends (exclusive date)':'Ends'}<input required type={allDay?'date':'datetime-local'} value={end} onChange={e=>setEnd(e.target.value)}/></label>
 <label>Location<input value={location} maxLength={1000} onChange={e=>setLocation(e.target.value)}/></label><label>Description<textarea value={description} maxLength={20000} onChange={e=>setDescription(e.target.value)}/></label>
 <p className="local-note">Editing an invited event may notify its participants.</p>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button className="primary-action" disabled={!calendar}>Save event</button><button className="secondary-action" type="button" onClick={onClose}>Cancel</button>{event&&<button className="danger-action" type="button" onClick={()=>setConfirmDelete(true)}>Delete this occurrence</button>}</div>{confirmDelete&&<div role="group" aria-label="Confirm deletion"><p>Delete this occurrence?</p><button className="danger-action" type="button" onClick={()=>save(true)}>Delete event</button><button type="button" onClick={()=>setConfirmDelete(false)}>Keep event</button></div>}</form></section></AccessibleDialog>
}
