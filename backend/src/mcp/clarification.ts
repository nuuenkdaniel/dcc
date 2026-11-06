// Bounded user questions, not effect receipts or arbitrary model prose. Pure so
// the browser can validate the exact same public projection.
export const CLARIFICATION_QUESTIONS={
  missing_calendar:'Which calendar should I use?',
  missing_duration:'How many minutes should this take?',
  missing_event_time:'What date and start time should the event use?',
  ambiguous_project:'Which project or assignment do you mean? Please give its exact name or ID.',
  ambiguous_calendar:'Which calendar do you mean? Please give its exact name or ID.',
  ambiguous_relative_date:'What exact date (including year) do you mean?',
  dst_gap:'That local time does not exist because the clocks move forward. What valid local time should I use?',
  dst_fold:'That local time occurs twice when the clocks move back. Which UTC offset or occurrence do you mean?',
} as const
export type ClarificationReason=keyof typeof CLARIFICATION_QUESTIONS
export type Clarification={reason:ClarificationReason;question:string}
export function isClarificationReason(value:unknown):value is ClarificationReason{return typeof value==='string'&&Object.hasOwn(CLARIFICATION_QUESTIONS,value)}
export function clarification(reason:ClarificationReason):Clarification{return {reason,question:CLARIFICATION_QUESTIONS[reason]}}
export function validClarification(value:unknown):value is Clarification{
  if(!value||typeof value!=='object'||Array.isArray(value))return false
  const prototype=Object.getPrototypeOf(value)
  if(prototype!==Object.prototype&&prototype!==null||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!Object.getOwnPropertyDescriptor(value,key)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value')))return false
  const v=value as Record<string,unknown>
  return Object.keys(v).sort().join(',')==='question,reason'&&isClarificationReason(v.reason)&&v.question===CLARIFICATION_QUESTIONS[v.reason]
}
