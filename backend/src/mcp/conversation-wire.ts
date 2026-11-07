import {validActionReceipt,type ActionReceipt} from './action-receipt.js'
import {validClarification,type Clarification} from './clarification.js'
import {conversationTextFits} from './conversation-contract.js'
export type ConversationView={version:1;rootKey:string;turnKey:string;expiresAt:number;questions:number;original?:string;question?:Clarification&{id:string};receipt:ActionReceipt}
export function validConversationView(v:unknown):v is ConversationView{
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const r=v as Record<string,unknown>,key=(x:unknown)=>typeof x==='string'&&/^\w[\w-]{15,79}$/.test(x)
  if(Object.keys(r).some(k=>!['version','rootKey','turnKey','expiresAt','questions','original','question','receipt'].includes(k))||r.version!==1||!key(r.rootKey)||!key(r.turnKey)||!Number.isSafeInteger(r.expiresAt)||!Number.isInteger(r.questions)||Number(r.questions)<0||Number(r.questions)>3||r.original!==undefined&&(typeof r.original!=='string'||!conversationTextFits([r.original]))||!validActionReceipt(r.receipt)||r.receipt.key!==r.turnKey)return false
  if(r.question!==undefined){
    if(!r.question||typeof r.question!=='object'||Array.isArray(r.question))return false
    const q=r.question as Record<string,unknown>
    if(Object.keys(q).sort().join(',')!=='id,question,reason'||typeof q.id!=='string'||!/^[a-f0-9]{64}$/.test(q.id)||!validClarification({reason:q.reason,question:q.question})||!r.original||r.receipt.outcome!=='question')return false
  }
  return r.receipt.outcome!=='question'||r.question!==undefined
}
