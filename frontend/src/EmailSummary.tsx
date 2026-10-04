import {useEffect,useState} from 'react'
import {accountLabel,isImportant,receivedToday,type MailState} from './useMail'
export function EmailSummary({mail}:{mail:MailState}) {
 const rows=mail.snapshot.messages.filter(m=>receivedToday(m)&&isImportant(m))
 const pending=mail.snapshot.messages.filter(m=>receivedToday(m)&&!m.analysis&&m.override===null).length
 return <section className="card daily-email" aria-label="Daily email briefing">
  <div className="section-heading"><div><p className="eyebrow">Daily briefing · Today</p><h2>Important emails <span className="brief-count">{rows.length}</span></h2></div><a className="brief-inbox-link" href="/inbox">Open inbox →</a></div>
  {rows.length===0?<p className="local-note">No important emails identified for today yet.</p>:<div className="brief-list">{rows.map(m=><article key={m.data.id} className="email-brief">
   <div className="brief-meta"><span className="email-account">{accountLabel(m.data.account)}</span><time dateTime={m.data.receivedAt}>{new Date(m.data.receivedAt).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})}</time></div>
   <h3><a href={'/inbox?message='+m.data.id}>{m.data.subject}</a></h3>
   <p>{m.analysis?.summary??'Marked important by you.'}</p>
   {m.analysis?.reason&&<details className="brief-reason"><summary>Why it matters</summary><p>{m.analysis.reason}</p></details>}
  </article>)}</div>}
  <footer className="brief-footer">Today’s mail · Eastern time{pending>0&&<span role="status">{pending} awaiting review</span>}</footer>
 </section>
}
export function EmailSettings(){const [rules,setRules]=useState(''),[status,setStatus]=useState('Loading email rules…'),[loaded,setLoaded]=useState(false)
 useEffect(()=>{let active=true;void fetch('/api/v1/mail/preferences').then(async r=>{if(!r.ok)throw Error();const v=await r.json();if(active){setRules(v.rules);setLoaded(true);setStatus('')}}).catch(()=>{if(active)setStatus('Sign in and connect to edit email rules.')});return()=>{active=false}},[])
 return <section className="card project-editor"><h2>Email importance</h2><p className="local-note">Default: direct requests, deadlines/schedule changes, significant school/work/club updates. Usually exclude newsletters and promotions. Explicit Important / Not important choices take priority.</p><label>Additional importance rules<textarea disabled={!loaded} maxLength={4000} value={rules} onChange={e=>setRules(e.target.value)}/></label><button className="secondary-action" disabled={!loaded} onClick={async()=>{setStatus('Saving…');try{const r=await fetch('/api/v1/mail/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules})});if(!r.ok)throw Error();const v=await (await fetch('/api/v1/mail/preferences')).json();if(v.rules!==rules)throw Error();setStatus('Saved. Today’s automatic classifications will be reconsidered; your explicit choices stay protected.')}catch{setStatus('Could not save rules. Reconnect and retry.')}}}>Save email rules</button><p role="status">{status}</p></section>
}
