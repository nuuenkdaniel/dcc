import {useState} from 'react'
import {EmailBody} from './EmailBody'
import {EmailHtmlCacheProvider} from './EmailHtmlCacheProvider'
import {accountLabel,isImportant,type MailState} from './useMail'

export function Inbox(props:{mail:MailState}){return <EmailHtmlCacheProvider><InboxContent {...props}/></EmailHtmlCacheProvider>}
function InboxContent({mail}:{mail:MailState}){
 const selected=new URLSearchParams(location.search).get('message')
 const [account,setAccount]=useState('all'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(50),[opened,setOpened]=useState<Set<string>>(()=>new Set(selected?[selected]:[]))
 const rows=mail.snapshot.messages.filter(m=>(account==='all'||m.data.account===account)&&(filter==='all'||filter==='unread'&&m.data.unread||filter==='important'&&isImportant(m))&&[m.data.subject,m.data.sender,m.data.body].join(' ').toLowerCase().includes(search.toLowerCase()))
 const visible=rows.slice(0,Math.max(limit,rows.findIndex(m=>m.data.id===selected)+1))
 return <section className="content inbox-view">
  <header className="topbar"><div><p className="eyebrow">Your messages</p><h1>Inbox</h1></div><button className="secondary-action" disabled={mail.busy} onClick={()=>void mail.refresh(true)}>{mail.busy?'Requesting…':'Sync email'}</button></header>
  <p className="local-note" role="status">{mail.message}</p>
  <details><summary>Account sync status</summary>{mail.snapshot.accounts.map(a=><p key={a.account}>{accountLabel(a.account)} · {a.last_success?new Date(a.last_success).toLocaleString():'Initial import pending'}{a.error?' · '+a.error:''}</p>)}</details>
  <div className="mail-controls"><label>Account<select aria-label="Account" value={account} onChange={e=>{setAccount(e.target.value);setLimit(50)}}><option value="all">All accounts</option>{['personal','school','work'].map(a=><option key={a} value={a}>{accountLabel(a)}</option>)}</select></label><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All messages</option><option value="unread">Unread</option><option value="important">Important</option></select></label><input aria-label="Search emails" placeholder="Search emails" value={search} onChange={e=>{setSearch(e.target.value);setLimit(50)}}/></div>
  <p className="local-note">{rows.length} messages · Opening mail here does not mark it read in your mailbox.</p>
  {rows.length===0&&<div className="card empty-state"><p>No matching emails</p><small>Initial import includes the past 30 days of Inbox messages. Synced history is retained.</small></div>}
   {visible.map(m=>{const active=opened.has(m.data.id);return <details key={m.data.id} className="card email-card" open={active} onToggle={event=>{const open=event.currentTarget.open;setOpened(previous=>{const next=new Set(previous);if(open)next.add(m.data.id);else next.delete(m.data.id);return next})}}>
   <summary><span className="email-account">{accountLabel(m.data.account)}</span><strong>{m.data.subject||'(no subject)'}</strong><small>{m.data.unread?'Unread · ':''}{new Date(m.data.receivedAt).toLocaleString()}</small><span className="email-sender">{m.data.sender}</span></summary>
   {active&&<div className="email-details">
    <p><strong>From:</strong> {m.data.sender}<br/><strong>To:</strong> {m.data.to}</p>
    {m.analysis?.summary&&<p>{m.analysis.summary}</p>}
     <EmailBody key={m.data.id} id={m.data.id} body={m.data.body||''} hasHtml={m.data.hasHtml} open={active}/>
    {m.data.bodyNotice&&<p className="local-note">{m.data.bodyNotice}</p>}
    {!!m.data.attachments?.length&&<div><strong>Attachments</strong><ul>{m.data.attachments.map(a=><li key={a.part}><a href={`/api/v1/mail/attachment/${encodeURIComponent(m.data.id)}/${encodeURIComponent(a.part)}`}>{a.name}</a> <small>({Math.ceil(a.size/1024)} KB approximate)</small></li>)}</ul></div>}
    <div className="project-buttons" role="group" aria-label="Message importance"><button aria-pressed={m.override===true} onClick={()=>void mail.feedback(m.data.id,m.override===true?null:true)}>Important</button><button aria-pressed={m.override===false} onClick={()=>void mail.feedback(m.data.id,m.override===false?null:false)}>Not important</button></div>
   </div>}
  </details>})}
  {rows.length>limit&&<button className="secondary-action" onClick={()=>setLimit(value=>value+50)}>Show more</button>}
 </section>
}
