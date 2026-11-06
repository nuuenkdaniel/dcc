import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import {advanceFocusTimer} from './focusTimer'
import {TimerContext,type TimerPort} from './timerContext'
import {applyTimerCommand,freshTimer,restoreTimerDocument,validTimerDocument,TIMER_STORAGE,TIMER_TAB,type TimerDocument,type Reply} from './timerState'

export function BrowserTimerProvider({children}:{children:ReactNode}){
  // Read without elapsed reconciliation: ownership is not established at render.
  const [initial]=useState(()=>{try{const raw=sessionStorage.getItem(TIMER_STORAGE),document:unknown=raw?JSON.parse(raw):freshTimer(Date.now());if(!validTimerDocument(document))throw Error();return {document,blocked:false}}catch{return {document:freshTimer(Date.now()),blocked:true}}})
  const [document,setDocument]=useState(initial.document),ref=useRef(initial.document)
  const [warning,setWarning]=useState(()=>initial.blocked?'Stored timer is unreadable; preserved without overwriting. Timer controls unavailable.':!navigator.locks?'Web Locks unavailable; timer quarantined. Use a browser with Web Locks, then retry ownership.':'Checking timer tab ownership; timer controls are paused.')
  const [tabId,setTabId]=useState<string>(),[attempt,setAttempt]=useState(0)
  const ownership=useRef(false),lastTick=useRef(0),pendingTick=useRef(0)
  const acquisition=useRef<Promise<void>|undefined>(undefined)
  const commit=useCallback((next:TimerDocument)=>{
    if(!ownership.current||initial.blocked||!validTimerDocument(next))throw Error('Timer is quarantined')
    sessionStorage.setItem(TIMER_STORAGE,JSON.stringify(next));ref.current=next;lastTick.current=pendingTick.current;setDocument(next)
  },[initial.blocked])
  const sync=useCallback(()=>{
    const d=ref.current,elapsed=Math.max(0,Math.floor(performance.now()-lastTick.current));pendingTick.current=lastTick.current+elapsed
    return {...d,timer:advanceFocusTimer(d.timer,elapsed,d.focusMinutes*60000,d.breakMinutes*60000),updatedAt:Date.now()}
  },[])
  const mutate=(fn:(d:TimerDocument)=>TimerDocument)=>{
    if(!ownership.current)return false
    try{const current=sync(),next=fn(current);if(next===current||next.timer===current.timer&&next.focusMinutes===current.focusMinutes&&next.breakMinutes===current.breakMinutes)return false;next.version++;commit(next);return true}catch{setWarning('Timer storage unavailable; no confirmed timer change.');return false}
  }
  useEffect(()=>{
    let active=true,release=()=>{}
    const dispose=()=>{active=false;ownership.current=false;release()}
    ownership.current=false
    if(initial.blocked)return dispose
    if(!navigator.locks){queueMicrotask(()=>{if(active)setWarning('Web Locks unavailable; timer quarantined. Use a browser with Web Locks, then retry ownership.')});return dispose}
    const previous=acquisition.current
    const acquire=async()=>{
      // StrictMode cleanup can precede the browser's first lock callback. Wait
      // for that request AND its release to finish before submitting another
      // ifAvailable request for this provider. Other tabs still fail closed.
      if(previous)await previous
      if(!active)return
      let id=sessionStorage.getItem(TIMER_TAB)
      if(!id||!/^[a-f0-9-]{36}$/.test(id)){id=crypto.randomUUID();sessionStorage.setItem(TIMER_TAB,id)}
      const ownerId=id
      await navigator.locks.request('dcc-timer-tab:'+ownerId,{ifAvailable:true},async lock=>{
        if(!active)return
        if(!lock){setWarning('Another tab owns this timer. This copy is quarantined; return to the original tab, or close it and retry ownership. Reclaiming uses this copy’s saved clock and receipts, not later changes from the original tab. No timer change was made.');return}
        try{
          const restored=restoreTimerDocument(ref.current,Date.now())
          ref.current=restored.document;setDocument(restored.document)
          lastTick.current=performance.now();pendingTick.current=lastTick.current;ownership.current=true
          setTabId(ownerId);setWarning(restored.warning)
          await new Promise<void>(resolve=>{release=resolve})
        }finally{if(active)ownership.current=false}
      })
    }
    // Async acquisition converts synchronous storage/request failures into a
    // rejection too. Notify only while this effect still owns the attempt.
    acquisition.current=acquire().catch(()=>{if(active)setWarning('Timer ownership or storage unavailable; preserved without changes. Retry ownership.')})
    return dispose
  },[initial.blocked,attempt])
  useEffect(()=>{
    const timer=setInterval(()=>{if(!ownership.current||!ref.current.timer.running)return;try{commit(sync())}catch{setWarning('Timer progress cannot be persisted.')}},200)
    return()=>clearInterval(timer)
  },[commit,sync])
  const process=(command:unknown,recoverOnly=false):Reply=>{
    const key=command&&typeof command==='object'&&'args' in command&&command.args&&typeof command.args==='object'&&'operationKey' in command.args?String(command.args.operationKey):''
    const uncertain:Reply={state:'uncertain',operationKey:key}
    if(!ownership.current||!tabId||initial.blocked)return recoverOnly?uncertain:{state:'rejected',code:'forbidden'}
    try{
      if(recoverOnly){const proof=applyTimerCommand(ref.current,command,Date.now(),true).result;return proof.state==='applied'||proof.state==='uncertain'?proof:uncertain}
      const applied=applyTimerCommand(sync(),command,Date.now());commit(applied.document);return applied.result
    }catch{return recoverOnly?uncertain:{state:'rejected',code:'operation_capacity'}}
  }
  // A quarantined copy is displayed paused, but its persisted document/receipts
  // remain untouched. Reacquisition reconciles elapsed time exactly once.
  const visible=tabId?document:{...document,timer:{...document.timer,running:false}}
  const port:TimerPort={
    document:visible,
    ...(tabId?{tabId}:{}),
    owned:!!tabId,
    warning,
    retryOwnership:()=>{
      if(!tabId&&!initial.blocked){
        setWarning('Checking timer tab ownership; timer controls are paused.')
        setAttempt(n=>n+1)
      }
    },
    process,
    setTimer:update=>mutate(d=>{
      const timer=typeof update==='function'?update(d.timer):update
      return timer===d.timer?d:{...d,timer}
    }),
    setFocusMinutes:n=>{
      mutate(d=>({...d,focusMinutes:n}))
    },
    setBreakMinutes:n=>{
      mutate(d=>({...d,breakMinutes:n}))
    },
  }
  return (
    <TimerContext.Provider value={port}>
      {children}
    </TimerContext.Provider>
  )
}
