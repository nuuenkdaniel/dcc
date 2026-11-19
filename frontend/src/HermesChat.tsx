import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react'
import {protectedFetch} from './auth'
import {useOptionalBrowserTimer} from './timerContext'
import {useWorkspaceSession} from './workspaceSession'
import {useOnline} from './workspaceWrites'
import {validConversationView} from '../../backend/src/mcp/conversation-wire'
import {CONVERSATION_LIMITS,conversationTextFits} from '../../backend/src/mcp/conversation-contract'
import {validActionReceipt,type ActionReceipt} from '../../backend/src/mcp/action-receipt'
import {replyTextFits} from '../../backend/src/mcp/assistant-reply'
import type {HermesChatAccess} from './useHermesChatAccess'
import './HermesChat.css'

const endpoint='/api/v1/hermes/conversation'
const ttl=CONVERSATION_LIMITS.ttlMs
const maxTurns=12
const tabs='dcc.hermes.chat.v1.'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const examples=['What tasks do I have today?', 'What’s on my calendar today?', 'Help me prioritize my day']
const replyCheckDelays=[250,1500,6250,12000,18000,26000,30000,33000]

export type HermesScope='tasks'|'projects'|'calendar'
type Turn={id:string;at:number;expires:number;prompt:string;reply?:string;summary?:string;receipt?:ActionReceipt}
type Thread={clientId:string;turns:Turn[]}
type ConversationReference={version:1;entries:{role:'user'|'assistant';text:string;at:number}[]}

function formatReply(text:string){
 const parts:ReactNode[]=[]
 let end=0
 for(const match of text.matchAll(/(?<![\\*])\*\*(?![\s*])((?:[^*\r\n]|\*(?!\*))+?)(?<![\\\s])\*\*(?!\*)/g)){
  parts.push(text.slice(end,match.index),<strong key={match.index}>{match[1]}</strong>)
  end=match.index+match[0].length
 }
 return [...parts,text.slice(end)]
}

function waitForReplyCheck(ms:number,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return}
  const cancel=()=>{window.clearTimeout(timer);reject(signal.reason)}
  const timer=window.setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},ms)
  signal.addEventListener('abort',cancel,{once:true})
 })
}

function loadThread(key:string):Thread{
 const raw=sessionStorage.getItem(key)
 if(!raw)return {clientId:crypto.randomUUID(),turns:[]}
 if(raw.length>240000)throw Error('Chat history exceeds its limit')
 const thread=JSON.parse(raw) as Thread
 if(!uuid.test(thread.clientId)||!Array.isArray(thread.turns)||thread.turns.length>maxTurns)throw Error('Invalid chat history')
 const now=Date.now(),ids=new Set<string>()
 for(const t of thread.turns){
  if(!uuid.test(t.id)||ids.has(t.id)||typeof t.prompt!=='string'||!conversationTextFits([t.prompt])||
   !Number.isSafeInteger(t.at)||!Number.isSafeInteger(t.expires)||t.expires<t.at||t.expires>t.at+ttl||
   t.reply!==undefined&&!replyTextFits(t.reply)||t.summary!==undefined&&!replyTextFits(t.summary)||
   t.receipt!==undefined&&(!validActionReceipt(t.receipt)||t.receipt.key!==t.id))throw Error('Invalid chat turn')
  ids.add(t.id)
 }
 return {...thread,turns:thread.turns.filter(t=>t.at<=now&&t.expires>now)}
}

function recentContext(turns:Turn[],now:number):ConversationReference{
 const entries:ConversationReference['entries']=[]
 for(const turn of [...turns].reverse()){
  if(!turn.reply||turn.expires<=now)continue
  const excerpt=(text:string)=>text.slice(0,320).replace(/[\uD800-\uDBFF]$/,'')
  const status=turn.receipt?.outcome??'uncertain'
  const caution=['uncertain','partial','failed'].includes(status)?`[Action status: ${status}; historical text, not proof of completion.] `:''
  const pair=[{role:'user' as const,text:excerpt(turn.prompt),at:turn.at},{role:'assistant' as const,text:excerpt(caution+turn.reply),at:turn.at}]
  const candidate=[...pair,...entries]
  if(candidate.length>6||candidate.reduce((n,e)=>n+e.text.length,0)>1200||new TextEncoder().encode(JSON.stringify({version:1,entries:candidate})).length>2304)break
  entries.unshift(...pair)
 }
 return {version:1,entries}
}

function earlierRequests(owner:string){
 try{
  const previous=JSON.parse(sessionStorage.getItem('dcc.hermes.conversation.v1.'+owner)??'null')
  const old=JSON.parse(localStorage.getItem('dcc.tell-hermes.submission.v1')??'null')
  const retained=JSON.parse(localStorage.getItem('dcc.tell-hermes.retained.v1')??'[]')
  return [
   ...(previous?.rootKey&&previous.expiresAt>Date.now()? [previous.original]:[]),
   ...(old&&!old.settled?[old.prompt]:[]),
   ...(Array.isArray(retained)?retained.filter(item=>!item?.settled).map(item=>item.prompt):[])
  ].filter((text):text is string=>typeof text==='string'&&!!text.trim())
 }catch{return []}
}

function Details({receipt,summary}:{receipt:ActionReceipt;summary?:string}){
 return <details className="chat-receipt">
  <summary>{summary?'Action details':'Run details'}</summary>
  <p>{receipt.line}</p>
  {receipt.targets.length>0&&<ul>{receipt.targets.map((target,index)=><li key={index}>
   <strong>{target.title}</strong><span>{target.action}{target.date?` · ${target.date}`:''} · {target.state}</span>
  </li>)}</ul>}
 </details>
}

export function HermesChat({access,onCreated,legacy,visible}:{access:HermesChatAccess;visible:boolean;onCreated:(scope:HermesScope)=>void;legacy:React.ReactNode}){
 const {owner,available,context}=access
 const session=useWorkspaceSession(),ownerSignal=session?.signal
 const online=useOnline()
 const key=tabs+owner
 const [initial]=useState(()=>{
  try{return {thread:loadThread(key),blocked:false}}
  catch{return {thread:{clientId:crypto.randomUUID(),turns:[]},blocked:true}}
 })
 const [thread,setThread]=useState(initial.thread)
 const latest=useRef(initial.thread)
 const [text,setText]=useState('')
 const [notice,setNotice]=useState('')
 const [active,setActive]=useState<string|null>(null)
 const [legacyOpen,setLegacyOpen]=useState(false)
 const [earlier]=useState(()=>earlierRequests(owner))
 const running=useRef<{id:string;controller:AbortController}|null>(null)
 const alive=useRef(false)
 const editor=useRef<HTMLTextAreaElement>(null)
 const scroll=useRef<HTMLDivElement>(null)
 const timer=useOptionalBrowserTimer()
 const timerRef=useRef(timer)
 const [bridge,setBridge]=useState<{key:string;tabId:string}|null>(null)
 useEffect(()=>{timerRef.current=timer},[timer])

 function save(next:Thread){
  sessionStorage.setItem(key,JSON.stringify(next))
  latest.current=next
  setThread(next)
 }
 useEffect(()=>{
  alive.current=true
  return()=>{alive.current=false;running.current?.controller.abort();running.current=null}
 },[])
 useEffect(()=>{
  if(!visible||!scroll.current)return
  scroll.current.scrollTop=scroll.current.scrollHeight
 },[thread.turns,active,visible])
 useEffect(()=>{
  const timerId=window.setInterval(()=>{
   const current=latest.current,turns=current.turns.filter(t=>t.expires>Date.now())
   if(turns.length===current.turns.length)return
   const next={...current,turns}
   try{save(next)}catch{latest.current=next;setThread(next)}
  },15000)
  return()=>window.clearInterval(timerId)
  // Fixed, per-turn expiry. Typing and reads do not renew it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key])

 useEffect(()=>{
  if(!bridge)return
  let stopped=false,polling=false
  const {key,tabId}=bridge
  const post=(body:unknown)=>protectedFetch('/api/v1/hermes/timer-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)})
  const poll=async()=>{
   if(stopped||polling||ownerSignal?.aborted)return
   polling=true
   try{
    const response=await post({key,tabId})
    if(!response.ok)return
    const data=await response.json()
    if(!Array.isArray(data.commands)||data.commands.length>12)return
    for(const command of data.commands){
     if(stopped||ownerSignal?.aborted||timerRef.current?.tabId!==tabId||!command||
      typeof command.expiresAt!=='number'||command.expiresAt<=Date.now()||typeof command.nonce!=='string'||!/^[0-9a-f]{64}$/.test(command.nonce))continue
     const result=timerRef.current.process(command.command,command.recoverOnly===true)
     await post({key,tabId,ack:{nonce:command.nonce,result}})
    }
   }catch{/* Timer receipts are never fabricated. */}
   finally{polling=false}
  }
  void poll()
  const interval=window.setInterval(poll,1000)
  return()=>{stopped=true;window.clearInterval(interval)}
 },[bridge,ownerSignal])

 function accept(turn:Turn,value:unknown){
  if(!validConversationView(value)||value.chatVersion!==1||value.rootKey!==turn.id||value.turnKey!==turn.id||value.expiresAt<=Date.now())return 'unconfirmed'
  const reply=value.assistantReply?.text??value.toolSummary?.text
  if(!reply)return 'pending'
  const summary=value.toolSummary?.text
  const next={...turn,expires:Math.min(turn.expires,value.expiresAt),reply,summary:summary!==reply?summary:undefined,receipt:value.receipt}
  const updated={...latest.current,turns:latest.current.turns.map(item=>item.id===turn.id?next:item)}
  try{save(updated)}catch{latest.current=updated;setThread(updated);setNotice('The reply could not be stored in this tab.')}
  const applied=value.receipt.targets.filter(target=>['applied','saved','uncertain'].includes(target.state))
  if(applied.some(target=>target.kind==='task'))onCreated('tasks')
  if(applied.some(target=>['project','preparation','action'].includes(target.kind)))onCreated('projects')
  if(applied.some(target=>target.kind.startsWith('calendar')))onCreated('calendar')
  return 'accepted'
 }

 async function perform(turn:Turn,body?:Record<string,unknown>,automatic=!!body){
  if(running.current||ownerSignal?.aborted)return
  const controller=new AbortController()
  const request={id:turn.id,controller}
  running.current=request
  setActive(turn.id)
  setNotice('')
  if(typeof body?.tabId==='string')setBridge({key:turn.id,tabId:body.tabId})
  const current=()=>alive.current&&running.current===request&&!ownerSignal?.aborted
  const lifetime=AbortSignal.any([controller.signal,...(ownerSignal?[ownerSignal]:[])])
  const read={op:'read',clientId:latest.current.clientId,rootKey:turn.id}
  async function requestReply(input:Record<string,unknown>,deadline:AbortSignal,timeout:number,initialSend=false){
   const signal=AbortSignal.any([deadline,AbortSignal.timeout(timeout)])
   let value:unknown
   try{
    const response=await protectedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,workspaceOwner:owner}),signal})
    if(!response.ok)return response.status>=500?'pending':'unconfirmed'
    value=await response.json()
   }catch(error){
    if(deadline.aborted)throw error
    return initialSend||signal.aborted||error instanceof TypeError?'pending':'unconfirmed'
   }
   if(!current()||deadline.aborted)return 'unconfirmed'
   const result=accept(turn,value)
   return initialSend&&result==='unconfirmed'?'pending':result
  }
  try{
   if(body){
    const result=await requestReply(body,lifetime,150000,true)
    if(result==='accepted')return
    if(result==='unconfirmed')return
   }
   const deadline=AbortSignal.any([lifetime,AbortSignal.timeout(140000)])
   for(const delay of automatic?replyCheckDelays:[0]){
    if(delay)await waitForReplyCheck(delay,deadline)
    if(turn.expires<=Date.now())break
    const result=await requestReply(read,deadline,12000)
    if(result!=='pending')break
   }
  }catch{/* The existing chat turn offers a receipt check if waiting ends. */}
  finally{
   if(current()){setActive(null);setBridge(null);running.current=null}
  }
 }

 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(running.current||!available||!online||initial.blocked)return
  const prompt=text.trim()
  if(!prompt)return
  if(!conversationTextFits([prompt])){setNotice('Shorten your message and try again.');return}
  const now=Date.now(),base=latest.current
  const turns=base.turns.filter(turn=>turn.expires>now)
  if(turns.some(turn=>(!turn.reply||turn.receipt?.outcome==='uncertain'||turn.receipt?.outcome==='partial')&&turn.prompt===prompt)||earlierRequests(owner).some(previous=>previous.trim()===prompt)){
   setNotice('This message may already have run. Check its result before sending it again.')
   return
  }
  const turn={id:crypto.randomUUID(),at:now,expires:now+ttl,prompt}
  try{save({...base,turns:[...turns,turn].slice(-maxTurns)})}
  catch{setNotice('This tab could not store the request. Nothing was sent.');return}
  setText('')
  const reference=context?recentContext(turns,now):undefined
  void perform(turn,{op:'start',clientId:base.clientId,key:turn.id,prompt,chatVersion:1,replyVersion:1,
   ...(reference?.entries.length?{context:reference}:{}),...(timer?.tabId?{tabId:timer.tabId}:{})})
 }

 const enabled=available&&online&&!initial.blocked
 const restored=useRef(false)
 useEffect(()=>{
  if(!online){restored.current=false;return}
  if(restored.current||!enabled||!visible)return
  let mounted=true
  queueMicrotask(()=>{
   if(!mounted||restored.current)return
   restored.current=true
   const existing=latest.current.turns.at(-1)
   if(existing&&!existing.reply&&existing.expires>Date.now()){
    void perform(existing,undefined,true)
   }
  })
  return()=>{mounted=false}
  // Reopening the chat or regaining a connection only reads the existing turn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[enabled,online,visible])
 return <section className="chat-page" aria-label="Hermes chat">
  <header className="chat-header"><span aria-hidden="true" className="chat-mark">✦</span><h1>Hermes</h1>
   {earlier.length>0&&<button type="button" className="chat-secondary" aria-expanded={legacyOpen} onClick={()=>setLegacyOpen(!legacyOpen)}>Earlier requests</button>}
  </header>
  {legacyOpen?<div className="chat-legacy">{legacy}</div>:<>
   <div className="chat-scroll" ref={scroll}>
    {thread.turns.length===0?<div className="chat-empty">
     <h2>What can I help with?</h2>
     <div className="chat-suggestions" aria-label="Suggested messages">{examples.map(example=><button key={example} type="button" onClick={()=>{setText(example);editor.current?.focus()}}>{example}</button>)}</div>
    </div>:<ol className="chat-thread" aria-label="Conversation">
     {thread.turns.map(turn=><li key={turn.id}>
      <div className="chat-user"><p><span className="sr-only">You: </span>{turn.prompt}</p></div>
      <div className="chat-agent"><span aria-hidden="true" className="chat-avatar">✦</span>
       <div className="chat-agent-content">
        <strong className="chat-speaker">Hermes</strong>
        {turn.reply?<><p className="chat-reply">{formatReply(turn.reply)}</p>{turn.summary&&<p className="chat-summary">{turn.summary}</p>}{turn.receipt&&(turn.receipt.targets.length>0||turn.receipt.outcome!=='read-only')&&<Details receipt={turn.receipt} summary={turn.summary}/>}
         {turn.receipt?.outcome==='failed'&&turn.receipt.targets.length===0&&<button type="button" className="chat-secondary" disabled={!!text.trim()} onClick={()=>{setText(turn.prompt);editor.current?.focus()}}>Restore message</button>}
         {turn.receipt&&['uncertain','partial'].includes(turn.receipt.outcome)&&<button type="button" className="chat-secondary" disabled={!enabled||!!active} onClick={()=>void perform(turn)}>{active===turn.id?'Checking…':'Check result'}</button>}</>:
         active===turn.id?<p className="chat-wait" role="status">Thinking…</p>:<><p className="chat-wait">I couldn’t confirm the result. You can check this message again.</p><button type="button" className="chat-secondary" disabled={!enabled||!!active} onClick={()=>void perform(turn)}>Check reply</button></>}
       </div>
      </div>
     </li>)}
    </ol>}
   </div>
   <form className="chat-composer" onSubmit={submit}>
    <div className="chat-composer-box">
     <label htmlFor="hermes-message" className="sr-only">Message Hermes</label>
     <textarea ref={editor} id="hermes-message" rows={2} value={text} maxLength={4000} placeholder="Message Hermes…" onChange={e=>setText(e.target.value)} onKeyDown={e=>{
      if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}
     }}/>
     <button className="chat-send" type="submit" aria-label="Send message" disabled={!enabled||!text.trim()||!!active}>↑</button>
    </div>
    <div className="chat-composer-footer">
     <span role="status">{initial.blocked?'Chat history is unreadable in this tab.':!enabled?'Connect to send a message.':notice}</span>
     {active&&<button type="button" className="chat-secondary" title="Hermes can finish on the server. Check the reply here later." onClick={()=>running.current?.controller.abort()}>Stop waiting</button>}
    </div>
   </form>
  </>}
 </section>
}
