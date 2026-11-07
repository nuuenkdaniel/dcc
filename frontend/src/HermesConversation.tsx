import {useEffect,useRef,useState} from 'react'
import {protectedFetch} from './auth'
import {useOptionalBrowserTimer} from './timerContext'
import {validConversationView,type ConversationView} from '../../backend/src/mcp/conversation-wire'
import {CONVERSATION_LIMITS,conversationTextFits} from '../../backend/src/mcp/conversation-contract'
import {validActionReceipt,type ActionReceipt} from '../../backend/src/mcp/action-receipt'

type Draft={clientId:string;rootKey?:string;original:string;answer:string;usedChars:number;usedBytes:number;expiresAt:number;editedAfterSubmit?:boolean;view?:ConversationView;attempt?:{key:string;parentKey?:string;questionId?:string}}
const prefix='dcc.hermes.conversation.v1.'
function load(owner:string):Draft{
  // Per-tab storage prevents another tab's late reply from replacing this draft.
  // Reload survives; closing the tab abandons text (server TTL still applies).
  const raw=sessionStorage.getItem(prefix+owner)
  if(raw){
    if(raw.length>40000)throw Error('Saved conversation exceeds its bound')
    const d=JSON.parse(raw) as Draft
    if(!/^[a-f0-9-]{36}$/.test(d.clientId)||typeof d.original!=='string'||typeof d.answer!=='string'||!conversationTextFits([d.original,d.answer])||!Number.isInteger(d.usedChars)||d.usedChars<0||d.usedChars>4000||!Number.isInteger(d.usedBytes)||d.usedBytes<0||d.usedBytes>8192||!Number.isSafeInteger(d.expiresAt)||d.view!==undefined&&!validConversationView(d.view))throw Error('Saved conversation is unreadable')
    if(d.expiresAt>Date.now())return d
    return {clientId:d.clientId,original:'',answer:'',usedChars:0,usedBytes:0,expiresAt:Date.now()+CONVERSATION_LIMITS.ttlMs}
  }
  return {clientId:crypto.randomUUID(),original:'',answer:'',usedChars:0,usedBytes:0,expiresAt:Date.now()+CONVERSATION_LIMITS.ttlMs}
}
export function HermesConversation({owner,onCreated,initialText,focusEditor=false,available=true}:{owner:string;onCreated:(scope?:'tasks'|'projects'|'calendar')=>void;initialText?:string;focusEditor?:boolean;available?:boolean}){
  const timer=useOptionalBrowserTimer(),timerRef=useRef(timer);timerRef.current=timer
  const [initial]=useState(()=>{try{
    const draft=load(owner)
    if(initialText!==undefined){
      if(!conversationTextFits([initialText]))throw Error('Transferred draft exceeds the shared bound')
      if(draft.rootKey&&(!draft.view?.question||draft.attempt))draft.editedAfterSubmit=true
      if(draft.view?.question)draft.answer=initialText;else draft.original=initialText
    }
    return {draft,error:''}
  }catch{return {draft:null,error:'Saved conversation is unreadable and preserved. Sending is paused; the box remains editable.'}}})
  const [draft,setDraft]=useState<Draft>(initial.draft??{clientId:crypto.randomUUID(),original:'',answer:'',usedChars:0,usedBytes:0,expiresAt:Date.now()+CONVERSATION_LIMITS.ttlMs})
  const current=useRef(draft),generation=useRef(0),alive=useRef(true),abort=useRef<AbortController|null>(null),inFlight=useRef(false)
  const editor=useRef<HTMLInputElement>(null)
  useEffect(()=>{if(focusEditor)editor.current?.focus()},[focusEditor])
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(initial.error),[expanded,setExpanded]=useState(!!draft.view?.question)
  const [flight,setFlight]=useState<{key:string;tabId?:string}|null>(null)
  const [latest,setLatest]=useState<ActionReceipt|null>(()=>{try{const r:unknown=JSON.parse(sessionStorage.getItem(prefix+owner+'.receipt')??'null');return validActionReceipt(r)?r:null}catch{return null}})
  const [confirmRepeat,setConfirmRepeat]=useState<string|null>(null)
  const commit=(next:Draft)=>{sessionStorage.setItem(prefix+owner,JSON.stringify(next));current.current=next;setDraft(next)}
  useEffect(()=>{
    if(initialText!==undefined&&!initial.error){try{commit(current.current)}catch{setNotice('Transferred draft could not be saved. Text remains editable; nothing was sent.')}}
    // Transfer only at the confirmed capability upgrade, never on later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  const isCurrent=(g:number)=>alive.current&&generation.current===g
  useEffect(()=>{
    const timer=setTimeout(()=>{
      generation.current++;abort.current?.abort();setBusy(false);setFlight(null)
      const base=current.current
      const expired={...base,original:'',answer:'',view:undefined,usedChars:0,usedBytes:0}
      try{commit(expired)}catch{current.current=expired;setDraft(expired)}
      setNotice('Pending text expired after 24 hours and was cleared. Receipts are unchanged. Start a new request; nothing was resent.')
    },Math.max(0,draft.expiresAt-Date.now()))
    return()=>clearTimeout(timer)
    // A deadline is fixed, not renewed by typing or opening the disclosure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[draft.expiresAt])
  useEffect(()=>{
    alive.current=true
    const invalid=()=>{generation.current++;abort.current?.abort();setNotice('Sign-in changed. No automatic resend.');setBusy(false)}
    window.addEventListener('dcc-auth-required',invalid);window.addEventListener('dcc-auth-changed',invalid)
    return()=>{alive.current=false;generation.current++;abort.current?.abort();window.removeEventListener('dcc-auth-required',invalid);window.removeEventListener('dcc-auth-changed',invalid)}
  },[])
  useEffect(()=>{
    if(!flight?.tabId)return
    const {key,tabId}=flight;let stopped=false,working=false
    const poll=async()=>{
      if(stopped||working)return;working=true
      try{
        const response=await protectedFetch('/api/v1/hermes/timer-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,tabId}),signal:AbortSignal.timeout(5000)})
        const body=await response.json() as {commands?:{nonce:string;expiresAt:number;command:unknown;recoverOnly?:boolean}[]}
        if(!response.ok||!Array.isArray(body.commands)||body.commands.length>12)return
        for(const c of body.commands){
          if(stopped||c.expiresAt<=Date.now()||!timerRef.current||timerRef.current.tabId!==tabId||!/^[a-f0-9]{64}$/.test(c.nonce))continue
          const result=timerRef.current.process(c.command,c.recoverOnly===true)
          await protectedFetch('/api/v1/hermes/timer-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,tabId,ack:{nonce:c.nonce,result}}),signal:AbortSignal.timeout(5000)})
        }
      }catch{/* No fabricated acknowledgment. */}finally{working=false}
    }
    void poll();const interval=setInterval(()=>void poll(),1000)
    return()=>{stopped=true;clearInterval(interval)}
  },[flight])
  async function call(body:Record<string,unknown>,signal?:AbortSignal){
    if(!available)throw Error('Conversation unavailable; no fallback')
    const r=await protectedFetch('/api/v1/hermes/conversation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,workspaceOwner:owner}),...(signal?{signal}:{})})
    const v:unknown=await r.json()
    if(!r.ok||!validConversationView(v))throw Error('Unconfirmed conversation')
    return v
  }
  function accept(v:ConversationView,base:Draft){
    const r=v.receipt
    // Latest receipt is structured only; no completed prompt/transcript copy.
    sessionStorage.setItem(prefix+owner+'.receipt',JSON.stringify(r));setLatest(r)
    if(r.outcome!=='complete'&&r.outcome!=='question'&&r.outcome!=='read-only'){
      const name=prefix+owner+'.retained',prior:unknown=JSON.parse(sessionStorage.getItem(name)??'[]')
      if(!Array.isArray(prior)||prior.length>20)throw Error('Retained receipt history unreadable')
      const retained=prior.filter(x=>validActionReceipt(x)&&x.key!==r.key).slice(-19)
      sessionStorage.setItem(name,JSON.stringify([...retained,r]))
    }
    const question=!!v.question
    if(r.outcome==='complete'||r.outcome==='read-only'){
      const preserve=base.editedAfterSubmit||base.view?.question&&base.answer.trim()&&!base.attempt
      commit({clientId:base.clientId,original:r.outcome==='read-only'?base.original:preserve?(base.view?.question?base.answer:base.original):'',answer:'',usedChars:0,usedBytes:0,expiresAt:Date.now()+CONVERSATION_LIMITS.ttlMs})
    }else commit({...base,rootKey:v.rootKey,expiresAt:v.expiresAt,view:v,original:question?v.original??base.original:base.original,answer:question?(base.view?.question?.id===v.question?.id?base.answer:''):base.answer,usedChars:base.usedChars,usedBytes:base.usedBytes,attempt:base.attempt&&base.attempt.key!==v.turnKey?base.attempt:undefined})
    setExpanded(question);setNotice('')
    if(r.targets.some(t=>t.kind==='task'&&t.state==='applied'))onCreated('tasks')
    if(r.targets.some(t=>t.kind==='project'||t.kind==='preparation'||t.kind==='action'))onCreated('projects')
    if(r.targets.some(t=>t.kind.startsWith('calendar')))onCreated('calendar')
  }
  // Reload is receipt-only. A claimed turn is never automatically resubmitted.
  useEffect(()=>{
    if(initialText!==undefined||!initial.draft?.rootKey||initial.draft.expiresAt<=Date.now())return
    const base=initial.draft,g=generation.current,controller=new AbortController()
    void call({op:'read',clientId:base.clientId,rootKey:base.rootKey},controller.signal).then(v=>{if(v.rootKey!==base.rootKey)throw Error('Wrong conversation');if(isCurrent(g))accept(v,base)}).catch(()=>{if(isCurrent(g))setNotice('Saved request is not confirmed. No automatic resend; you can edit or clear.')})
    return()=>controller.abort()
    // Only the mount snapshot can trigger a receipt-only read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  async function send(explicitRepeat=false){
    if(inFlight.current||initial.error||!available)return
    const base=current.current,answering=!!base.view?.question,text=answering?base.answer:base.original
    if(!text.trim())return
    if(base.attempt){setNotice('This turn was already submitted and is not confirmed. No resend. Check its receipt or start a new request.');return}
    if(base.expiresAt<=Date.now()){setNotice('Conversation expired. Start a new request; nothing is resent.');return}
    const chars=answering?base.usedChars+text.length:text.length,bytes=answering?base.usedBytes+new TextEncoder().encode(text).length:new TextEncoder().encode(text).length
    if(chars>4000||bytes>8192||!conversationTextFits([text])){setNotice('Original plus all answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.');return}
    if(base.rootKey&&!answering){setNotice('This request may already have effects. Choose New request before sending again.');return}
    if(!answering){
      // Preserve the old executor/unpin history, including its original keys.
      // Never silently migrate or replay an unresolved pre-conversation request.
      try{
        const old:unknown=JSON.parse(localStorage.getItem('dcc.tell-hermes.submission.v1')??'null'),history:unknown=JSON.parse(localStorage.getItem('dcc.tell-hermes.retained.v1')??'[]')
        if(!Array.isArray(history))throw Error('Unreadable legacy history')
        const matches=[old,...history].some(v=>v&&typeof v==='object'&&'prompt' in v&&v.prompt===text)
        if(matches&&!(explicitRepeat&&confirmRepeat===text)){setConfirmRepeat(text);setNotice('This matches a previous request and may duplicate effects. Check current records before deliberately sending as new.');return}
      }catch{setNotice('Previous request history is unreadable and preserved. Sending is paused; text remains editable.');return}
    }
    const key=crypto.randomUUID(),controller=new AbortController()
    const attempt=answering?{key,parentKey:base.view!.turnKey,questionId:base.view!.question!.id}:{key}
    const next={...base,rootKey:base.rootKey??key,usedChars:chars,usedBytes:bytes,editedAfterSubmit:false,attempt}
    try{commit(next)}catch{setNotice('Draft could not be saved. Nothing was sent.');return}
    // A restored answer may be submitted without an edit. Fence older receipt
    // reads before this new turn starts, including their failure callbacks.
    const g=++generation.current
    inFlight.current=true;setBusy(true);abort.current=controller;setFlight({key,...(timer?.tabId?{tabId:timer.tabId}:{})});setNotice('Checking DCC…')
    try{
      const body=answering?{op:'answer',clientId:base.clientId,rootKey:base.rootKey,...attempt,answer:text}:{op:'start',clientId:base.clientId,key,prompt:text,...(timer?.tabId?{tabId:timer.tabId}:{})}
      const v=await call(body,AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]))
      if(v.rootKey!==next.rootKey||v.turnKey!==key)throw Error('Wrong conversation turn')
      if(isCurrent(g))accept(v,next)
    }catch{if(isCurrent(g))setNotice('Action not confirmed; effects may have saved. Text remains editable. No automatic resend. Choose New request rather than repeating saved work.')}
    finally{if(isCurrent(g)){setBusy(false);setFlight(null)}inFlight.current=false;abort.current=null}
  }
  async function newRequest(){
    const base=current.current,g=++generation.current;abort.current?.abort()
    try{
      if(base.rootKey)await call({op:'cancel',clientId:base.clientId,rootKey:base.rootKey},AbortSignal.timeout(10000))
      if(!isCurrent(g))return
      commit({clientId:base.clientId,original:'',answer:'',usedChars:0,usedBytes:0,expiresAt:Date.now()+86400000});setExpanded(false);setNotice('Previous execution was not rolled back. Check its receipt before repeating.');setBusy(false);setFlight(null)
    }catch{if(isCurrent(g))setNotice('Could not close the server request. Text is editable; no new request was sent.')}
  }
  const question=draft.view?.question,value=question?draft.answer:draft.original
  const status=available?notice:'Hermes is unavailable. You can edit or clear; no request will be sent.'
  return <form className="tell-hermes hermes-conversation" aria-busy={busy} onSubmit={e=>{e.preventDefault();void send()}}>
    {question&&<section className="hermes-question-panel" aria-label="Details Hermes needs">
      <div className="hermes-question-heading"><p className="hermes-question-meta">Question {draft.view!.questions} of 3</p><button className="hermes-disclosure" type="button" aria-expanded={expanded} aria-controls="hermes-question-details" onClick={()=>setExpanded(!expanded)}>{expanded?'Close details':'Show question'}</button></div>
      {expanded&&<div id="hermes-question-details"><p className="hermes-question-text">{question.question}</p><details className="hermes-original-request"><summary>Your request</summary><p>Original request: {draft.original}</p></details></div>}
    </section>}
    <label className="sr-only" htmlFor="hermes-conversation-input">Ask Hermes about tasks, projects, or calendar</label>
    <input ref={editor} id="hermes-conversation-input" type="text" placeholder={question?'Answer Hermes':'Hermes'} value={value} maxLength={4000} required aria-describedby="hermes-conversation-status" onFocus={()=>{if(question)setExpanded(true)}} onChange={e=>{
      const text=e.target.value;generation.current++;abort.current?.abort();setBusy(false);setFlight(null)
      setConfirmRepeat(null)
      if(!conversationTextFits([text])||(question&&(current.current.usedChars+text.length>4000||current.current.usedBytes+new TextEncoder().encode(text).length>8192))){setNotice('Original plus all answers must fit 4,000 UTF-16 characters and 8 KiB UTF-8.');return}
      const base=current.current
      const next={...base,editedAfterSubmit:base.editedAfterSubmit||!!base.rootKey&&(!question||!!base.attempt),...(question?{answer:text}:{original:text})};try{commit(next)}catch{current.current=next;setDraft(next);setNotice('Draft not saved; sending paused until storage recovers.')}
    }}/>
    {(question||draft.rootKey||busy||confirmRepeat===draft.original)&&<div className="hermes-actions">
      {question&&expanded&&<button className="hermes-primary" type="submit" disabled={busy||!draft.answer.trim()}>Send answer</button>}
      {draft.rootKey&&<button type="button" aria-label="New request / cancel" title="Close this request and start fresh. Earlier saved effects are not rolled back." onClick={()=>void newRequest()}>New request</button>}
      {draft.rootKey&&!busy&&(draft.attempt||draft.view?.receipt.outcome==='uncertain'||draft.view?.receipt.outcome==='partial')&&<button type="button" onClick={()=>{
        const base=current.current,g=generation.current
        void call({op:'read',clientId:base.clientId,rootKey:base.rootKey},AbortSignal.timeout(10000)).then(v=>{if(v.rootKey!==base.rootKey)throw Error('Wrong conversation');if(isCurrent(g))accept(v,base)}).catch(()=>{if(isCurrent(g))setNotice('Receipt not available. No resend; text remains editable.')})
      }}>Check receipt</button>}
      {confirmRepeat===draft.original&&<button type="button" disabled={busy} onClick={()=>void send(true)}>Send as new request — may duplicate effects</button>}
      {busy&&<button type="button" title="Stop waiting for this reply; this does not undo saved or in-flight effects." onClick={()=>abort.current?.abort()}>Stop waiting</button>}
    </div>}
    {status&&<p className="hermes-status" id="hermes-conversation-status" role="status">{status}</p>}
    {!status&&<span id="hermes-conversation-status" role="status" className="sr-only">{busy?'Checking DCC':'Hermes ready'}</span>}
    {latest&&latest.outcome!=='question'&&<div className="hermes-receipt" data-outcome={latest.outcome}><p title={latest.line}>{latest.line}</p><details><summary>View</summary><p>Outcome: {latest.outcome}. Verified distinct records: {latest.verified}; expected: {latest.expected??'unresolved'}. Saved effects are not rolled back; do not repeat them.</p><ul>{latest.targets.map((t,i)=><li key={i}><strong>{t.action}: {t.title}</strong>{t.date&&` · ${t.date}`}<p>{t.kind} · {t.id} · {t.state} · {t.verification}</p>{t.before&&t.after&&<dl>{[...new Set([...Object.keys(t.before),...Object.keys(t.after)])].map(field=><div key={field}><dt>{field}</dt><dd>{String(t.before?.[field]??'—')} → {String(t.after?.[field]??'—')}</dd></div>)}</dl>}</li>)}</ul>{latest.targets.length===0&&<p>No verified record targets.</p>}</details><button type="button" onClick={()=>{sessionStorage.removeItem(prefix+owner+'.receipt');setLatest(null)}}>Dismiss</button></div>}
  </form>
}
