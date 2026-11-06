// Inert deterministic source campaign: no browser globals, network or model calls.
import {applyTimerCommand,freshTimer,validTimerDocument,type TimerDocument} from './timerState'
import {advanceFocusTimer,canReorderFocusTimers} from './focusTimer'

export function runTimerCampaign(seed:number){
  let random=seed>>>0,now=1000,d=freshTimer(now),assertions=0
  const actions:Record<string,number>={}
  const check=(ok:boolean)=>{assertions++;if(!ok)throw Error('timer_campaign_invariant')}
  const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random}
  const id=(i:number)=>`${(seed+i).toString(16).padStart(8,'0')}-1234-4234-a234-123456789abc`
  let first:unknown
  for(let i=0;i<256;i++){
    const elapsed=next()%10000;now+=elapsed
    d={...d,timer:advanceFocusTimer(d.timer,elapsed,d.focusMinutes*60000,d.breakMinutes*60000),updatedAt:now}
    const choice=(next()>>>16)%8
    let tool='control_focus_timer',fields:Record<string,unknown>={action:['start','pause','resume','reset'][choice%4]}
    if(choice===4)fields={action:'configure',focusMinutes:1+next()%5,breakMinutes:1+next()%3}
    if(choice===5){tool='edit_focus_queue';fields=d.timer.miniTimers.length<10?{action:'add',name:'Synthetic step '+i,minutes:1+next()%3}:{action:'remove',miniId:d.timer.miniTimers[0].id}}
    if(choice===6&&d.timer.miniTimers.length>1&&canReorderFocusTimers(d.timer)){tool='edit_focus_queue';fields={action:'move',miniId:d.timer.miniTimers[1].id,beforeId:d.timer.miniTimers[0].id}}
    if(choice===7&&d.timer.miniTimers.length){tool='edit_focus_queue';fields={action:'remove',miniId:d.timer.miniTimers.at(-1)!.id}}
    const command={tool,args:{id:id(i),operationKey:'dcc_op_'+id(i),expectedVersion:d.version,...fields}}
    if(i===0)first=structuredClone(command)
    const applied=applyTimerCommand(d,command,now)
    check(applied.result.state==='applied');d=applied.document
    const action=tool+'.'+String(fields.action);actions[action]=(actions[action]??0)+1
    const progressed:TimerDocument={...d,timer:advanceFocusTimer(d.timer,1234,d.focusMinutes*60000,d.breakMinutes*60000),updatedAt:now+1234}
    const replay=applyTimerCommand(JSON.parse(JSON.stringify(progressed)),command,now+1234)
    check(JSON.stringify(replay.document)===JSON.stringify(progressed));check(JSON.stringify(replay.result)===JSON.stringify(applied.result))
    const recovery=applyTimerCommand(progressed,command,now+1234,true)
    check(recovery.document===progressed);check(recovery.result.state==='applied')
    check(validTimerDocument(progressed));check(Object.keys(progressed.receipts).length<=128)
    d=progressed;now+=1234
  }
  check((d.receiptFloorVersion??0)>0)
  const retired=applyTimerCommand(d,first,now)
  check(retired.result.state==='uncertain');check(retired.document===d)
  const absent={tool:'control_focus_timer',args:{id:id(999),operationKey:'dcc_op_'+id(999),expectedVersion:d.version,action:'reset'}}
  check(applyTimerCommand(d,absent,now,true).result.state==='uncertain')
  check(applyTimerCommand(d,absent,now,true).document===d)
  const boundary={...freshTimer(0).timer,running:true,sessionRemainingMs:1000}
  const rest=advanceFocusTimer(boundary,1000,60000,300000)
  check(rest.phase==='break'&&rest.sessionRemainingMs===300000)
  const finished=advanceFocusTimer(rest,300000,60000,300000)
  check(!finished.running&&finished.phase==='focus')
  return {seed,operations:256,assertions,actions,retainedReceipts:Object.keys(d.receipts).length,receiptFloorVersion:d.receiptFloorVersion,evidence:'pure-browser-timer-state' as const}
}
