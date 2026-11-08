import {validActionReceipt,type ActionReceipt} from './action-receipt.js'
import {validConversationClarification,type Clarification} from './clarification.js'
import {conversationTextFits} from './conversation-contract.js'
import {validAssistantReply,type AssistantReply} from './assistant-reply.js'
export type ConversationView={version:1;rootKey:string;turnKey:string;expiresAt:number;questions:number;original?:string;question?:Clarification&{id:string};receipt:ActionReceipt;continuable?:boolean;assistantReply?:AssistantReply;replyUnavailable?:true;chatVersion?:1;toolSummary?:AssistantReply}
export function validConversationView(v:unknown):v is ConversationView{
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const r=v as Record<string,unknown>,key=(x:unknown)=>typeof x==='string'&&/^\w[\w-]{15,79}$/.test(x)
  if(r.chatVersion!==undefined&&(r.chatVersion!==1||r.question!==undefined)||r.toolSummary!==undefined&&(r.chatVersion!==1||!validAssistantReply(r.toolSummary)))return false
  if(Object.keys(r).some(k=>!['version','rootKey','turnKey','expiresAt','questions','original','question','receipt','continuable','assistantReply','replyUnavailable','chatVersion','toolSummary'].includes(k))||r.assistantReply!==undefined&&!validAssistantReply(r.assistantReply)||r.replyUnavailable!==undefined&&r.replyUnavailable!==true||r.assistantReply!==undefined&&(r.question!==undefined||r.replyUnavailable!==undefined)||r.continuable!==undefined&&typeof r.continuable!=='boolean'||r.version!==1||!key(r.rootKey)||!key(r.turnKey)||!Number.isSafeInteger(r.expiresAt)||!Number.isInteger(r.questions)||Number(r.questions)<0||Number(r.questions)>3||r.original!==undefined&&(typeof r.original!=='string'||!conversationTextFits([r.original]))||!validActionReceipt(r.receipt)||r.receipt.key!==r.turnKey)return false
  if(r.question!==undefined){
    if(!r.question||typeof r.question!=='object'||Array.isArray(r.question))return false
    const q=r.question as Record<string,unknown>
    if(Object.keys(q).sort().join(',')!=='id,question,reason'||typeof q.id!=='string'||!/^[a-f0-9]{64}$/.test(q.id)||!validConversationClarification({reason:q.reason,question:q.question})||!r.original||r.receipt.outcome!=='question')return false
  }
  if(r.continuable===true){
    const receipt=r.receipt as ActionReceipt
    if(r.question||!['complete','partial'].includes(receipt.outcome)||receipt.verified<1||!receipt.targets.every(t=>t.state==='applied'&&t.verification==='verified'||t.state==='conflict'||t.state==='rejected'))return false
  }
  return r.receipt.outcome!=='question'||r.question!==undefined
}
