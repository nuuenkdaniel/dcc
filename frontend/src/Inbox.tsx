import {useEffect,useState} from 'react'
import type {Dispatch,SetStateAction} from 'react'
import {EmailBody} from './EmailBody'
import {EmailHtmlCacheProvider} from './EmailHtmlCacheProvider'
import {accountLabel,isImportant,type MailMessage,type MailState} from './useMail'

export function Inbox(props:{mail:MailState}){return <EmailHtmlCacheProvider><InboxContent {...props}/></EmailHtmlCacheProvider>}
function InboxContent({mail}:{mail:MailState}){
 const selected=new URLSearchParams(location.search).get('message')
 const [account,setAccount]=useState('all'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[opened,setOpened]=useState<Set<string>>(()=>new Set(selected?[selected]:[])),[showCachedOlder,setShowCachedOlder]=useState(false)
 useEffect(()=>{const timer=window.setTimeout(()=>void mail.setFilters({account,search,important:filter==='important'}),search?250:0);return()=>window.clearTimeout(timer)},[account,filter,mail.setFilters,search])
 const query=search.trim().toLowerCase()
 const rows=mail.snapshot.messages.filter(m=>(account==='all'||m.data.account===account)&&(filter==='all'||filter==='unread'&&m.data.unread||filter==='important'&&isImportant(m))&&(!query||`${m.data.subject} ${m.data.sender}`.toLowerCase().includes(query)))
 const cachedRows=mail.cachedOlderMessages.filter(m=>filter!=='unread'||m.data.unread)
 return <section className="content inbox-view">
  <header className="topbar"><div><p className="eyebrow">Your messages</p><h1>Inbox</h1></div><button className="secondary-action" disabled={mail.busy} onClick={()=>void mail.refresh(true)}>{mail.busy?'Requesting…':'Sync email'}</button></header>
  <p className="local-note" role="status">{mail.message}</p>
  <details><summary>Account sync status</summary>{mail.snapshot.accounts.map(a=><p key={a.account}>{accountLabel(a.account)} · {a.last_success?new Date(a.last_success).toLocaleString():'Initial import pending'}{a.error?' · '+a.error:''}</p>)}</details>
    <div className="mail-controls"><label>Account<select aria-label="Account" value={account} onChange={e=>{setAccount(e.target.value);setShowCachedOlder(false)}}><option value="all">All accounts</option>{['personal','school','work'].map(a=><option key={a} value={a}>{accountLabel(a)}</option>)}</select></label><label>Show<select value={filter} onChange={e=>{setFilter(e.target.value);setShowCachedOlder(false)}}><option value="all">All messages</option><option value="unread">Unread</option><option value="important">Important</option></select></label><input aria-label="Search emails" placeholder="Search emails" value={search} onChange={e=>{setSearch(e.target.value);setShowCachedOlder(false)}}/></div>
    <p className="local-note">{filter==='unread'?`${rows.length} loaded unread`:`${mail.total} current mailbox messages`} · Opening mail here does not mark it read in your mailbox.</p>
  {rows.length===0&&<div className="card empty-state"><p>No matching emails</p><small>Initial import includes the past 30 days of Inbox messages. Synced history is retained.</small></div>}
     {rows.map(m=><MessageCard key={m.data.id} mail={mail} message={m} opened={opened} setOpened={setOpened}/>)}
    {mail.snapshot.messages.length<mail.total&&<button className="secondary-action" disabled={mail.loadingMore} onClick={()=>void mail.loadMore()}>{mail.loadingMore?'Loading…':'Load more'}</button>}
    {cachedRows.length>0&&<section className="cached-mail" aria-label="Cached older mail"><button type="button" className="secondary-action" aria-expanded={showCachedOlder} onClick={()=>setShowCachedOlder(value=>!value)}>{showCachedOlder?'Hide':'Show'} cached older mail ({cachedRows.length})</button><p className="local-note">Saved on this device from the previous mailbox cache. These messages are separate from the current server count and may no longer be present online.</p>{showCachedOlder&&cachedRows.map(m=><MessageCard key={m.data.id} mail={mail} message={m} opened={opened} setOpened={setOpened}/>)}</section>}
   </section>
}

function MessageCard({mail,message:m,opened,setOpened}:{mail:MailState;message:MailMessage;opened:Set<string>;setOpened:Dispatch<SetStateAction<Set<string>>>}){const active=opened.has(m.data.id);return <details className="card email-card" open={active} onToggle={event=>{const open=event.currentTarget.open;setOpened(previous=>{const next=new Set(previous);if(open)next.add(m.data.id);else next.delete(m.data.id);return next})}}>
 <summary><span className="email-account">{accountLabel(m.data.account)}</span><strong>{m.data.subject||'(no subject)'}</strong><small>{m.data.unread?'Unread · ':''}{new Date(m.data.receivedAt).toLocaleString()}</small><span className="email-sender">{m.data.sender}</span></summary>
 {active&&<div className="email-details"><p><strong>From:</strong> {m.data.sender}<br/><strong>To:</strong> {m.data.to}</p>{m.analysis?.summary&&<p>{m.analysis.summary}</p>}<OnDemandBody mail={mail} message={m}/>{m.data.bodyNotice&&<p className="local-note">{m.data.bodyNotice}</p>}{!!m.data.attachments?.length&&<div><strong>Attachments</strong><ul>{m.data.attachments.map(a=><li key={a.part}><a href={`/api/v1/mail/attachment/${encodeURIComponent(m.data.id)}/${encodeURIComponent(a.part)}`}>{a.name}</a> <small>({Math.ceil(a.size/1024)} KB approximate)</small></li>)}</ul></div>}<div className="project-buttons" role="group" aria-label="Message importance"><button aria-pressed={m.override===true} onClick={()=>void mail.feedback(m.data.id,m.override===true?null:true)}>Important</button><button aria-pressed={m.override===false} onClick={()=>void mail.feedback(m.data.id,m.override===false?null:false)}>Not important</button></div></div>}
 </details>}

function OnDemandBody({mail,message}:{mail:MailState;message:MailState['snapshot']['messages'][number]}){
 const [attempt,setAttempt]=useState(0),body=message.data.body,state=mail.bodyStates[message.data.id]
 useEffect(()=>{if(body===undefined)void mail.loadBody(message.data.id,attempt>0).catch(()=>{})},[attempt,body,mail.loadBody,message.data.id])
 if(body!==undefined)return <EmailBody id={message.data.id} body={body} hasHtml={message.data.hasHtml} open/>
 if(state?.status==='error')return <div className="email-privacy-note"><span role="alert">{state.error}</span> <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry body</button></div>
 return <p className="email-privacy-note" role="status">Loading message body…</p>
}
