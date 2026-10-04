export type CalendarBlock={start:string;end:string;allDay:boolean}
export function easternDay(now:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
export function easternHour(now:Date){return Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now))}
export function budgetForDay(now:Date,events:CalendarBlock[]){
 const day=easternDay(now)
 const noon=new Date(day+'T16:00:00Z')
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(noon).find(p=>p.type==='timeZoneName')!.value
 const hours=Number(offset.replace('GMT',''))
 const weekend=[0,6].includes(noon.getUTCDay())
 const at=(minutes:number)=>Date.parse(day+'T00:00:00Z')+(minutes-hours*60)*60000
 const start=Math.max(at(weekend?540:510),now.getTime()),end=at(1380)
 const warnings:string[]=[]
 if(events.some(e=>e.allDay&&e.start<=day&&e.end>day)){warnings.push('All-day commitment: review availability before adding work.');return {day,minutes:0,warnings}}
 const ranges=events.filter(e=>!e.allDay).map(e=>[Math.max(start,Date.parse(e.start)),Math.min(end,Date.parse(e.end))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b!>a!).sort((a,b)=>a[0]!-b[0]!)
 let used=0,last=start
 for(const [a,b] of ranges){used+=Math.max(0,b!-Math.max(a!,last));last=Math.max(last,b!)}
 // Conservative remaining-day budget: never assume meals/rest already happened.
 return {day,minutes:Math.max(0,Math.floor((end-start-used)/60000)-360),warnings}
}
export type SuggestedAction={projectId:string;title:string;notes:string;minutes:number}
export function validatePlan(value:unknown,projects:{id:string;remainingMinutes:number}[],budget:number):{actions:SuggestedAction[];summary:string}{
 if(!value||typeof value!=='object')throw new Error('Invalid plan')
 const v=value as Record<string,unknown>
 if(!Array.isArray(v.actions)||v.actions.length>20||typeof v.summary!=='string'||v.summary.length>2000)throw new Error('Invalid plan')
 const seen=new Set<string>();let total=0
 const actions=v.actions.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object')throw new Error('Invalid action')
  const a=raw as SuggestedAction,p=projects.find(p=>p.id===a.projectId)
  if(!p||seen.has(a.projectId)||typeof a.title!=='string'||!a.title.trim()||a.title.length>240||typeof a.notes!=='string'||a.notes.length>4000||!Number.isInteger(a.minutes)||a.minutes<5||a.minutes>Math.min(180,p.remainingMinutes))throw new Error('Invalid action')
  seen.add(a.projectId);total+=a.minutes;return {projectId:a.projectId,title:a.title.trim(),notes:a.notes,minutes:a.minutes}
 })
 if(total>budget)throw new Error('Plan exceeds available time')
 return {actions,summary:v.summary}
}
