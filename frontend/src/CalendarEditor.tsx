import {useEffect,useState} from 'react'
import {pending,flush,type Pending,type Change} from './calendarOutbox'
export type EditableEvent={id:string;calendarId:string;etag?:string;title:string;start:string;end:string;allDay:boolean;description:string;location:string}
const localTime=(value:string)=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
export function CalendarEditor({date,calendars,event,onClose,onSaved}:{date:string;calendars:{id:string;name:string}[];event?:EditableEvent;onClose:()=>void;onSaved:()=>void}){
 const [title,setTitle]=useState(event?.title??'')
 const [allDay,setAllDay]=useState(event?.allDay??false)
 const [calendar,setCalendar]=useState(event?.calendarId??calendars[0]?.id??'')
 const [start,setStart]=useState(event?(event.allDay?event.start:localTime(event.start)):`${date}T09:00`)
 const [end,setEnd]=useState(event?(event.allDay?event.end:localTime(event.end)):`${date}T10:00`)
 const [description,setDescription]=useState(event?.description??'')
 const [location,setLocation]=useState(event?.location??'')
 const [error,setError]=useState('')
 const [saving,setSaving]=useState(false)
 return <div className="modal-backdrop"><section className="timer-dialog" role="dialog" aria-modal="true" aria-label={event?'Edit event':'New event'}><h2>{event?'Edit this occurrence':'New event'}</h2><form className="calendar-login" onSubmit={async e=>{e.preventDefault();if(new Date(end)<=new Date(start)){setError('End must be after start.');return}setSaving(true);try{const change:Change={id:crypto.randomUUID(),calendarId:calendar,title,start:allDay?start:new Date(start).toISOString(),end:allDay?end:new Date(end).toISOString(),allDay,description,location,...(event?{eventId:event.id,etag:event.etag??''}:{})};await pending({change});onSaved();onClose()}catch{setError('Could not save the local draft. Browser storage may be unavailable.')}finally{setSaving(false)}}}>
 <label>Event title<input required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Calendar<select disabled={!!event} value={calendar} onChange={e=>setCalendar(e.target.value)}>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label className="priority-toggle"><input type="checkbox" checked={allDay} onChange={e=>{setAllDay(e.target.checked);if(e.target.checked){setStart(start.slice(0,10));const next=new Date(`${start.slice(0,10)}T12:00:00`);next.setDate(next.getDate()+1);setEnd(localTime(next.toISOString()).slice(0,10))}else{setStart(start+'T09:00');setEnd(end+'T10:00')}}}/>All day</label>
 <label>Starts<input required type={allDay?'date':'datetime-local'} value={start} onChange={e=>setStart(e.target.value)}/></label><label>{allDay?'Ends (exclusive date)':'Ends'}<input required type={allDay?'date':'datetime-local'} value={end} onChange={e=>setEnd(e.target.value)}/></label>
 <label>Location<input value={location} maxLength={1000} onChange={e=>setLocation(e.target.value)}/></label><label>Description<textarea value={description} maxLength={20000} onChange={e=>setDescription(e.target.value)}/></label>
 <p className="local-note">Saved locally first, then sent to Nextcloud. Editing an invited event may notify its participants.</p>{error&&<p role="alert">{error}</p>}<button disabled={saving||!calendar}>Save event</button><button type="button" onClick={onClose}>Cancel</button></form></section></div>
}
export function PendingChanges({onSent,revision}:{onSent:()=>void;revision:number}){
 const [items,setItems]=useState<Pending[]>([])
 useEffect(()=>{let active=true;const load=async()=>{try{const value=await pending();if(active)setItems(value)}catch{}};const send=async()=>{await load();try{await flush();await load();if(active)onSent()}catch{}};void send();const id=setInterval(()=>void send(),30000);window.addEventListener('online',send);return()=>{active=false;clearInterval(id);window.removeEventListener('online',send)}},[revision,onSent])
 if(!items.length)return null
 return <div className="pending-calendar"><h3>Pending calendar changes</h3>{items.map(item=><div key={item.change.id}><strong>{item.change.title}</strong><p className="local-note">{item.error??'Saved on this device · awaiting sync'}</p><details><summary>Draft details</summary><p>{item.change.start} → {item.change.end}</p><p>{item.change.description}</p></details><button onClick={async()=>{setItems(await pending(item.change.id));onSent()}}>Discard draft</button></div>)}</div>
}
