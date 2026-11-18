import {validDate} from './planner.js'

export const easternMinuteFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export function easternInstant(local:string){
 if(typeof local!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)||!validDate(local.slice(0,10)))throw Error('Invalid local time')
 const base=Date.parse(local+'Z'),matches:string[]=[]
 // Check both Eastern offsets by round-trip; reject DST gaps and ambiguity.
 for(const offset of [4,5]){const date=new Date(base+offset*3600000);if(Number.isFinite(date.getTime())&&easternMinuteFormatter.format(date).replace(' ','T')===local)matches.push(date.toISOString())}
 if(matches.length!==1)throw Error('Specify an unambiguous New York time')
 return matches[0]!
}
