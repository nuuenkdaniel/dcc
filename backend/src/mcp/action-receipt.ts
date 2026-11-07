// Public bounded wire projection, shared by browser; Android validates this shape.
export type ReceiptFields=Record<string,string|boolean|number>
export type ReceiptTarget={kind:string;id:string;action:string;title:string;date?:string;state:string;verification:'verified'|'unavailable'|'snapshot_pending';before?:ReceiptFields;after?:ReceiptFields}
export type ActionReceipt={version:1;key:string;outcome:'complete'|'partial'|'failed'|'uncertain'|'question'|'read-only';line:string;verified:number;expected:number|null;targets:ReceiptTarget[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=new Set(['title','date','completed','deleted','important','status','deadline','startDate','start','end','allDay','minutes','remainingMinutes','importance'])
export function projectReceiptFields(data:Record<string,unknown>):ReceiptFields{
  return Object.fromEntries(Object.entries(data).filter(([k,v])=>fields.has(k)&&(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=500))) as ReceiptFields
}
export function validActionReceipt(value:unknown):value is ActionReceipt{
  if(!obj(value)||Object.keys(value).sort().join(',')!=='expected,key,line,outcome,targets,verified,version'||value.version!==1||typeof value.key!=='string'||!/^\w[\w-]{15,79}$/.test(value.key)||!['complete','partial','failed','uncertain','question','read-only'].includes(String(value.outcome))||typeof value.line!=='string'||value.line.length>500||!Number.isInteger(value.verified)||Number(value.verified)<0||Number(value.verified)>4||value.expected!==null&&(!Number.isInteger(value.expected)||Number(value.expected)<1||Number(value.expected)>4)||!Array.isArray(value.targets)||value.targets.length>4)return false
  const validFields=(v:unknown)=>obj(v)&&Object.keys(v).length<=16&&Object.entries(v).every(([k,x])=>fields.has(k)&&(typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x)||typeof x==='string'&&x.length<=500))
  if(!value.targets.every(t=>obj(t)&&Object.keys(t).every(k=>['kind','id','action','title','date','state','verification','before','after'].includes(k))&&['kind','id','action','title','state','verification'].every(k=>typeof t[k]==='string'&&String(t[k]).length<=500)&&['verified','unavailable','snapshot_pending'].includes(String(t.verification))&&(t.date===undefined||typeof t.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date))&&(t.before===undefined||validFields(t.before))&&(t.after===undefined||validFields(t.after))))return false
  const distinct=new Set(value.targets.filter(t=>t.verification==='verified'&&t.state==='applied').map(t=>t.kind+'\0'+t.id)).size
  return value.verified===distinct&&(value.outcome!=='complete'||value.expected===distinct&&distinct>0&&value.targets.every(t=>t.state==='applied'&&t.verification==='verified'))
}
