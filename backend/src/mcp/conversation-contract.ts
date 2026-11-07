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
function names(text:string){
  const clean=text.trim().replace(/[.!]$/,'')
  const quoted=[...clean.matchAll(/"([^"\n]{1,200})"/g)].map(m=>m[1]!)
  if(quoted.length&&clean.replace(/"[^"\n]+"/g,'').replace(/[\s,;]|\band\b/gi,'')==='')return quoted
  return clean.split(/\s*;\s*|\s*,\s*(?:and\s+)?|\s+and\s+/i).map(t=>t.trim()).filter(Boolean)
}
export function interpretTasks(original:string,answers:string[],today:string):Interpretation{
  // Supported grammar is intentionally explicit. Broad product requests continue
  // through the existing catalog, but never receive a full-fulfillment claim.
  const chunk=/\b(?:study\s+)?([1-4]|one|two|three|four)\s+(?:study\s+)?chunks?\b/i.exec(original)
  const explicit=/^\s*(?:please\s+)?(?:add|create|put)\s+(?:exactly\s+)?([1-4]|one|two|three|four)?\s*(?:named\s+)?tasks?\s+(?:for\s+)?today\s*:\s*(.+?)\s*$/i.exec(original)
  // Do not certify arbitrary sentences by spotting a number and ignoring the
  // rest. Only this bounded study grammar and the explicit literal-name list
  // establish a checklist; other natural language retains unresolved scope.
  const study=/^\s*(?:I have an exam coming up for ([a-z]{2,6}\s?\d{3,4})[,.]?\s+)?I need to study (?:[1-4]|one|two|three|four) chunks? today[,.]?\s+(?:can you )?put (?:that|them) in my tasks[?.!]?\s*$/i.exec(original)
  if(!explicit&&(!chunk||!study))return {kind:'unsupported'}
  // Never silently ignore a second mutation, scheduling constraint or duration.
  if(/\b(?:delete|remove|complete|calendar|tomorrow|minutes?|hours?|then|also|after|before|except|not|don't|do not)\b/i.test(original))return {kind:'unsupported'}
  const countText=explicit?explicit[1]:chunk?.[1]
  const words:Record<string,number>={one:1,two:2,three:3,four:4}
  const requested=countText?(words[countText.toLowerCase()]??Number(countText)):undefined
  const answer=answers.at(-1)
  const list=answer??explicit?.[2]??original.split(/\b(?:topics?|named|called)\s*:\s*/i)[1]
  const course=study?.[1]?.replace(/\s/g,'').toUpperCase()
  const general=!!study&&answer!==undefined&&/^(?:just\s+)?general(?:\s+(?:study\s+)?chunks?)?[.!]?$/i.test(answer.trim())
  if(!list&&!general)return {kind:'question',reason:'task_topics'}
  const titles=general&&requested?Array.from({length:requested},(_,i)=>`Study chunk ${i+1}`):names(list??'')
  if(titles.length<1||titles.length>4||requested!==undefined&&titles.length!==requested||titles.some(t=>t.length>200||!t||/[\n\r:]/.test(t))||new Set(titles.map(t=>t.toLowerCase())).size!==titles.length)return {kind:'question',reason:'task_names'}
  return {kind:'checklist',checklist:{version:1,kind:'create_tasks',tasks:titles.map(title=>({title:course?`${course}: ${title}`:title,date:today}))}}
}
