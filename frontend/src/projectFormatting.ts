const dateParts=/^(\d{4})-(\d{2})-(\d{2})/

export function formatProjectDate(value:string){
 const match=dateParts.exec(value)
 if(!match)return value||'No deadline'
 const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])))
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(date)
}

export function formatPlanningMinutes(minutes:number){
 const safe=Math.max(0,Math.round(minutes||0)),hours=Math.floor(safe/60),rest=safe%60
 return hours&&rest?`${hours}h ${rest}m`:hours?`${hours}h`:`${rest}m`
}
