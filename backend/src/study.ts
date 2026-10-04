import {randomUUID} from 'node:crypto'
import {easternDay} from './planner-policy.js'
export type Exam={id:string;calendarId:string;uid:string;recurrenceId:string|null;start:string;allDay:boolean}
export type Topic={id:string;title:string;notes:string;minutes:number}
export type Preparation={id:string;title:string;event:Exam;startDate:string;status:string;topics:Topic[];progress:string}
export type StudyAction={projectId:unknown;completed:unknown;dismissed:unknown;feedback?:unknown;minutes:unknown;date?:unknown}
export function resolveExam(p:Preparation,events:Exam[]){return events.find(e=>e.calendarId===p.event.calendarId&&e.uid===p.event.uid&&e.recurrenceId===p.event.recurrenceId)}
export function examDay(e:Exam){return e.allDay?e.start.slice(0,10):easternDay(new Date(e.start))}
export function validPreparation(p:Preparation){return p&&typeof p.id==='string'&&typeof p.title==='string'&&p.title.length>0&&p.title.length<=240&&p.event&&typeof p.event.uid==='string'&&typeof p.event.calendarId==='string'&&(p.event.recurrenceId===null||typeof p.event.recurrenceId==='string')&&/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)&&Number.isFinite(Date.parse(p.startDate))&&['active','paused'].includes(p.status)&&typeof p.progress==='string'&&p.progress.length<=4000&&Array.isArray(p.topics)&&p.topics.length>0&&p.topics.length<=60&&new Set(p.topics.map(t=>t.id)).size===p.topics.length&&p.topics.every(t=>typeof t.id==='string'&&t.id.length<=80&&typeof t.title==='string'&&t.title.length>0&&t.title.length<=240&&typeof t.notes==='string'&&t.notes.length<=4000&&Number.isInteger(t.minutes)&&t.minutes>=5&&t.minutes<=1800)}
export function validateOutline(raw:unknown){
 const p=raw as {topics?:Topic[];progress?:string}
 if(!p||!Array.isArray(p.topics)||!p.topics.length||p.topics.length>60||typeof p.progress!=='string'||p.progress.length>4000)throw Error('Invalid extracted outline')
 const topics=p.topics.map(t=>({...t,id:randomUUID()}))
 if(!validPreparation({id:'draft',title:'draft',event:{id:'',calendarId:'',uid:'',recurrenceId:null,start:'',allDay:true},startDate:'2026-01-01',status:'active',topics,progress:p.progress}))throw Error('Invalid topics')
 return {topics,progress:p.progress}
}
export function studyCandidates(preps:Preparation[],events:Exam[],actions:StudyAction[],day:string){
 return preps.flatMap(p=>{
  const e=resolveExam(p,events);if(p.status!=='active'||!e||day<p.startDate||day>=examDay(e))return []
  return p.topics.flatMap((t,index)=>{
   const id=p.id+':'+t.id,history=actions.filter(a=>a.projectId===id)
   const completed=history.filter(a=>a.completed&&!a.dismissed).sort((a,b)=>String(a.date??'').localeCompare(String(b.date??'')))
   const used=completed.reduce((n,a)=>n+Number(a.minutes),0)
   const latest=completed.at(-1)
   const remaining=Math.max(0,t.minutes-used,latest?.feedback==='review'?30:0)
   if(!remaining)return []
   return [{id,title:p.title+' — '+t.title,category:'school',deadline:examDay(e),importance:3,remainingMinutes:remaining,description:t.notes,progress:p.progress,preparationId:p.id,topicId:t.id,sequence:index,study:true,feedback:latest?.feedback??'',daysUntilExam:Math.ceil((Date.parse(examDay(e))-Date.parse(day))/86400000)}]
  })
 })
}
