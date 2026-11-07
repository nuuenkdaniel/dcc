// Shared public bounds and deliberately narrow interpretation. No model output,
// browser date, tool-returned text or client checklist is execution authority.
export const CONVERSATION_LIMITS=Object.freeze({chars:4000,bytes:8192,questions:3,ttlMs:86400000})
export type TaskGoal={title:string;date:string}
export type Checklist={version:1;kind:'create_tasks';tasks:TaskGoal[]}
export type Interpretation={kind:'checklist';checklist:Checklist}|{kind:'question';reason:'task_topics'|'task_names'}|{kind:'unsupported'}
export function conversationTextFits(parts:string[]){
  const text=parts.join('')
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i)
    if(c>=0xd800&&c<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false}
    else if(c>=0xdc00&&c<=0xdfff)return false
  }
  return text.length<=CONVERSATION_LIMITS.chars&&new TextEncoder().encode(text).length<=CONVERSATION_LIMITS.bytes&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
}
export function nyDate(now:number){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now))
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-')
}
function names(text:string):string[]|undefined{
  const clean=text.trim().replace(/[.!]$/,'')
  const quoted=[...clean.matchAll(/"([^"\n]{1,200})"/g)].map(m=>m[1]!)
  if(clean.includes('"')){
    // Every quoted title needs a real separator; mixed/unclosed quotes are not
    // permission to drop a malformed entry or substitute a generic title.
    const markers=clean.replace(/"[^"\n]+"/g,'\u0000')
    return quoted.length&&/^\u0000(?:\s*(?:;|,(?:\s*and)?|\band\b)\s*\u0000)*$/i.test(markers)?quoted:undefined
  }
  const titles=clean.split(/\s*;\s*|\s*,\s*(?:and\s+)?|\s+and\s+/i).map(t=>t.trim())
  return titles.every(Boolean)?titles:undefined
}
const extraScope=/\b(?:delete|remove|complete|calendar|tomorrow|yesterday|minutes?|hours?|then|also|after|before|except|not|don['’]t|do not|schedule|reschedule|mark|send|ignore|override|disregard|invoke|execute)\b|\b(?:call|system|developer|tool)\s+(?:instructions?|prompt|message|create_task|tools?)\b/i
function genericLabels(answer:string){
  // Contextual label choice ONLY, never generic consent to another operation.
  return /^(?:please\s+)?(?:(?:just\s+)?general(?:\s+(?:study\s+)?chunks?)?|(?:just\s+)?label(?:\s+them)?(?:\s+(?:generically|however you like))?|(?:just\s+)?use\s+(?:generic|general)\s+(?:labels|names|titles)|(?:you\s+can\s+)?(?:just\s+)?(?:choose|pick)(?:\s+(?:the|some|any|generic|general))?\s+(?:labels|names|titles)|(?:any|generic|general)\s+(?:labels|names|titles)\s+are\s+(?:fine|okay|ok))[.!]?$/i.test(answer.trim())
}
export function interpretTasks(original:string,answers:string[],today:string):Interpretation{
  // Full anchored task-only clauses, not number/keyword spotting. Strip only an
  // allowlisted exam context immediately preceding the supported study clause.
  // Unsupported broader requests retain unresolved scope in the existing catalog.
  if(extraScope.test(original)||answers.some(a=>extraScope.test(a)))return {kind:'unsupported'}
  const text=original.trim()
  const context=/^I (?:have an (?:exam|midterm) coming up|am studying for an upcoming (?:exam|midterm))(?: for (?<course>[a-z]{2,6}\s?\d{3,4}))?[,.]?\s+(?=I need to study\b)/i.exec(text)
  const body=context?text.slice(context[0].length):text
  const explicit=/^(?:please\s+)?(?:add|create|put)\s+(?:exactly\s+)?(?<count>[1-4]|one|two|three|four)?\s*(?:named\s+)?tasks?\s+(?:for\s+)?today\s*:\s*(?<titles>.*?)\s*$/i.exec(text)
  const sentence=/^I need to study (?:the\s+first\s+|first\s+)?(?<count>[1-4]|one|two|three|four)\s+(?:study\s+)?chunks? today(?<beforeTopics>\s+using specific topics)?[,.]?\s+(?:can you\s+)?put (?:that|them) (?:in my tasks|on my task list)(?<topics>\s+using specific topics)?(?:\s*:\s*(?<titles>.*?))?[?.!]?\s*$/i.exec(body)
  const command=!context?/^(?:please\s+)?(?:add|create|put)\s+(?:exactly\s+)?(?:the\s+first\s+|first\s+)?(?<count>[1-4]|one|two|three|four)\s+(?:study\s+)?chunks?\s+(?:for\s+)?today(?<topics>\s+using specific topics)?(?:\s*:\s*(?<titles>.*?))?[.!]?\s*$/i.exec(body):null
  const study=sentence??command
  if(!explicit&&!study)return {kind:'unsupported'}
  const countText=(explicit??study)?.groups?.count
  const words:Record<string,number>={one:1,two:2,three:3,four:4}
  const requested=countText?(words[countText.toLowerCase()]??Number(countText)):undefined
  const course=context?.groups?.course?.replace(/\s/g,'').toUpperCase()
  const supplied=(explicit??study)?.groups?.titles
  const topics=!!(study?.groups?.topics||study?.groups?.beforeTopics)
  const valid=(titles:string[]|undefined):titles is string[]=>!!titles&&titles.length>=1&&titles.length<=4&&(requested===undefined||titles.length===requested)&&titles.every(t=>t.length<=200&&!!t&&!/[\n\r:]/.test(t))&&new Set(titles.map(t=>t.toLowerCase())).size===titles.length
  const checklist=(titles:string[]):Interpretation=>({kind:'checklist',checklist:{version:1,kind:'create_tasks',tasks:titles.map(title=>({title:course?`${course}: ${title}`:title,date:today}))}})
  const literal=supplied!==undefined?names(supplied):undefined
  if(valid(literal))return checklist(literal) // Never genericize valid user titles.
  const answer=answers.at(-1)
  if(answer!==undefined&&!genericLabels(answer)){
    const titles=names(answer)
    return valid(titles)?checklist(titles):{kind:'question',reason:'task_names'}
  }
  // Generic defaults/legacy label-choice replies are valid only for a bounded
  // study request without supplied names or a request to select actual topics.
  if(study&&supplied===undefined&&!topics&&requested!==undefined)return checklist(Array.from({length:requested},(_,i)=>`Study chunk ${i+1}`))
  return {kind:'question',reason:topics&&supplied===undefined?'task_topics':'task_names'}
}
