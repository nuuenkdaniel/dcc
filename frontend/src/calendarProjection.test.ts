import {describe,expect,it} from 'vitest'
import {projectCalendarChanges,snapshotConfirmsChange,type CalendarEvent} from './calendarProjection'
import type {Pending} from './calendarOutbox'

const occurrence=(id:string,start='2026-10-07T13:00:00.000Z'):CalendarEvent=>({id,calendarId:'fixture',etag:'etag-1',uid:'series',recurrenceId:start,title:'Weekly class',start,end:'2026-10-07T14:00:00.000Z',allDay:false,description:'',location:''})
const queued=(change:Pending['change']):Pending=>({change,createdAt:'2026-10-07T12:00:00.000Z'})

describe('calendar pending projections',()=>{
 it('shows a durable all-day create through its exclusive end date',()=>{
  const pending=queued({id:'create-1',calendarId:'fixture',title:'Conference',start:'2026-10-07',end:'2026-10-09',allDay:true,description:'',location:''})
  const projected=projectCalendarChanges([], [pending])
  expect(projected).toEqual([expect.objectContaining({id:'pending:create-1',start:'2026-10-07',end:'2026-10-09',pendingMutationId:'create-1'})])
  expect(projected[0]!.start<='2026-10-08'&&projected[0]!.end>'2026-10-08').toBe(true)
  expect(projected[0]!.end>'2026-10-09').toBe(false)
 })

 it('overlays an edit and deletion on only their matching occurrences',()=>{
  const first=occurrence('first'),second=occurrence('second','2026-10-14T13:00:00.000Z')
  const edit=queued({id:'edit-1',calendarId:'fixture',eventId:'first',etag:'etag-1',title:'Moved class',start:'2026-10-07T15:00:00.000Z',end:'2026-10-07T16:00:00.000Z',allDay:false,description:'changed',location:''})
  const remove=queued({id:'delete-1',operation:'delete',calendarId:'fixture',eventId:'second',etag:'etag-1',title:second.title,start:second.start,end:second.end,allDay:false,description:'',location:''})
  expect(projectCalendarChanges([first,second],[edit,remove])).toEqual([expect.objectContaining({id:'first',title:'Moved class',pendingMutationId:'edit-1'})])
 })

 it('keeps a confirmed create projected while an authoritative snapshot is stale',()=>{
  const pending={...queued({id:'create-1',calendarId:'fixture',title:'Saved event',start:'2026-10-07T13:00:00.000Z',end:'2026-10-07T14:00:00.000Z',allDay:false,description:'',location:''}),awaitingConfirmation:true}
  expect(projectCalendarChanges([], [pending])).toHaveLength(1)
 })

 it('does not duplicate a create once its mutation appears in the snapshot',()=>{
  const pending={...queued({id:'create-1',calendarId:'fixture',title:'Saved event',start:'2026-10-07T13:00:00.000Z',end:'2026-10-07T14:00:00.000Z',allDay:false,description:'',location:''}),awaitingConfirmation:true}
  const confirmed={...occurrence('confirmed'),uid:'create-1@daymark',mutationId:'create-1',title:'Saved event'}
  expect(projectCalendarChanges([confirmed],[pending])).toEqual([confirmed])
 })

 it('keeps an edited occurrence visible if its old occurrence id is missing',()=>{
  const edit=queued({id:'edit-1',calendarId:'fixture',eventId:'old-id',etag:'etag-1',title:'Moved class',start:'2026-10-08T15:00:00.000Z',end:'2026-10-08T16:00:00.000Z',allDay:false,description:'',location:''})
  expect(projectCalendarChanges([], [edit])).toEqual([expect.objectContaining({id:'pending:edit-1',title:'Moved class',pendingMutationId:'edit-1'})])
 })

 it('confirms deletes only from a healthy authoritative snapshot covering the occurrence date',()=>{
  const remove=queued({id:'delete-1',operation:'delete',calendarId:'fixture',eventId:'occurrence',etag:'etag-1',title:'Weekly class',start:'2026-10-07T13:00:00.000Z',end:'2026-10-07T14:00:00.000Z',allDay:false,description:'',location:''})
  const covered={events:[],coverageStart:'2026-10-01T00:00:00.000Z',coverageEnd:'2026-11-01T00:00:00.000Z'}
  expect(snapshotConfirmsChange(remove,covered)).toBe(true)
  expect(snapshotConfirmsChange(remove,{...covered,error:'Calendar sync failed'})).toBe(false)
  expect(snapshotConfirmsChange(remove,{...covered,coverageEnd:'2026-10-07T00:00:00.000Z'})).toBe(false)
  expect(snapshotConfirmsChange(remove,{...covered,events:[occurrence('occurrence')]})).toBe(false)
 })

 it('scopes mutation confirmation to the changed calendar',()=>{
  const edit=queued({id:'edit-1',calendarId:'fixture',eventId:'old-id',etag:'etag-1',title:'Moved class',start:'2026-10-08T15:00:00.000Z',end:'2026-10-08T16:00:00.000Z',allDay:false,description:'',location:''})
  const moved={...occurrence('new-id'),calendarId:'other',mutationId:'edit-1',title:'Moved class',start:edit.change.start,end:edit.change.end}
  expect(snapshotConfirmsChange(edit,{events:[moved]})).toBe(false)
  expect(snapshotConfirmsChange(edit,{events:[{...moved,calendarId:'fixture'}]})).toBe(true)
 })
})
