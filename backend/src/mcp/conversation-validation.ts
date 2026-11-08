import {plainRecord,validDate} from './contracts.js'
import type {ConversationGuard} from './request-intent.js'
import {isClarificationReason} from './clarification.js'
export function validGuard(v:unknown):v is ConversationGuard{
  if(!plainRecord(v)||v.version!==1||Object.keys(v).some(k=>!['version','binding','checklist','questionOnly','questionReason','readOnly','contextual'].includes(k))||v.contextual!==undefined&&v.contextual!==true||v.binding!==undefined&&(typeof v.binding!=='string'||!/^[a-f0-9]{64}$/.test(v.binding))||v.questionOnly!==undefined&&v.questionOnly!==true||v.readOnly!==undefined&&v.readOnly!==true||v.questionReason!==undefined&&!isClarificationReason(v.questionReason))return false
  if(v.checklist===undefined)return true
  const c=v.checklist
  return plainRecord(c)&&Object.keys(c).sort().join(',')==='kind,tasks,version'&&c.version===1&&c.kind==='create_tasks'&&Array.isArray(c.tasks)&&c.tasks.length>=1&&c.tasks.length<=4&&c.tasks.every(t=>plainRecord(t)&&Object.keys(t).sort().join(',')==='date,title'&&typeof t.title==='string'&&t.title.trim()&&t.title.length<=240&&validDate(t.date))&&new Set(c.tasks.map(t=>t.title)).size===c.tasks.length
}
