// Display data only. No effect/permission/target authority is accepted here.
export type AssistantReply={version:1;text:string}
export type RuntimeCompletion={status:'finished';replyVersion:1;assistantText?:string}
export function replyTextFits(v:unknown):v is string {
  if(typeof v!=='string'||/^[\t\n\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/.test(v)||v.length>2048||new TextEncoder().encode(v).length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))return false
  for(let i=0;i<v.length;i++){
    const c=v.charCodeAt(i)
    if(c>=0xd800&&c<=0xdbff){const next=v.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false}
    else if(c>=0xdc00&&c<=0xdfff)return false
  }
  return true
}
export function validAssistantReply(v:unknown):v is AssistantReply {
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const r=v as Record<string,unknown>
  return Object.keys(r).sort().join(',')==='text,version'&&r.version===1&&replyTextFits(r.text)
}
export function validRuntimeCompletion(v:unknown):v is RuntimeCompletion {
  if(!v||typeof v!=='object'||Array.isArray(v))return false
  const r=v as Record<string,unknown>
  return Object.keys(r).sort().join(',')===(r.assistantText===undefined?'replyVersion,status':'assistantText,replyVersion,status')&&r.status==='finished'&&r.replyVersion===1&&(r.assistantText===undefined||replyTextFits(r.assistantText))
}
