import {useEffect,useState,useCallback} from 'react'
type Offer={condition:string;cents:number;maxCents?:number;eligible:boolean;availability:string}
type Source={item_id:string;store:string;status:string;detail:string;last_attempt:string|null;next_run:string;last_good:null|{observedAt:string;url:string;offers:Offer[]}}
type Item={id:string;title:string;target_cents:number;paused:boolean}
type Snapshot={items:Item[];sources:Source[];history:{id:number;item_id:string;store:string;observed_at:string;data:{offers:Offer[]}}[]}
const key='daymark.prices.v1',money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100)
const names:Record<string,string>={bestbuy:'Best Buy',dell:'Dell',microcenter:'Micro Center'}
const links:Record<string,string>={bestbuy:'https://www.bestbuy.com/product/J3K4L6Q675',dell:'https://www.dell.com/en-us/shop/laptop-computers/spd/xps14da14260',microcenter:'https://www.microcenter.com/search/search_results.aspx?Ntt=Dell%20XPS%2014'}
export function Prices(){
 const [data,setData]=useState<Snapshot>(()=>{try{const v=JSON.parse(localStorage.getItem(key)||'null');if(v&&Array.isArray(v.items)&&Array.isArray(v.sources)&&Array.isArray(v.history))return v}catch{/* cache unavailable */}return {items:[],sources:[],history:[]}})
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const read=useCallback(async()=>{const r=await fetch('/api/v1/prices/snapshot',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(r.status===401?'Sign in to load prices.':'Price backend unavailable.');const v=await r.json();if(!Array.isArray(v.items)||!Array.isArray(v.sources)||!Array.isArray(v.history))throw Error('Invalid snapshot');setData(v);try{localStorage.setItem(key,JSON.stringify(v))}catch{setNotice('Device cache could not be saved.')}},[])
 useEffect(()=>{const refresh=()=>void read().catch(e=>setNotice(e.message+' Showing any cached prices.'));refresh();const t=setInterval(refresh,30000);return()=>clearInterval(t)},[read])
 const save=async(item:Item,target:number,paused:boolean)=>{const r=await fetch('/api/v1/prices/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,targetCents:target,paused})});if(!r.ok)throw Error('Could not save settings. Reconnect and retry.');await read();setNotice('Tracker settings saved.')}
 return <section className="content prices-view">
<header className="topbar">
<div>
<p className="eyebrow">Watchlist</p>
<h1>Price tracker</h1>
<p className="subtitle">Checks every 6 hours · No automatic purchases</p>
</div>
<button className="secondary-action" disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch('/api/v1/prices/refresh',{method:'POST'});if(!r.ok)throw Error('Could not request a check.');const v=await r.json();await read();setNotice(v.note)}catch(e){setNotice(e instanceof Error?e.message:'Check failed')}finally{setBusy(false)}}}>{busy?'Requesting…':'Check prices'}</button>
</header>{notice&&<p role="status" className="local-note">{notice}</p>}{!data.items.length&&<p className="local-note">No cached items available yet.</p>}{data.items.map(item=>
<PriceCard key={item.id} item={item} sources={data.sources.filter(s=>s.item_id===item.id)} history={data.history.filter(h=>h.item_id===item.id)} save={save}/>)}<details className="price-tracking-notes"><summary>Coverage & checking details</summary><p>Retailers checked every 6 hours while the worker and browser are running. This page refreshes saved results every 30 seconds. Manual checks have a 10-minute cooldown per store.</p><p>Local pickup scope: 10 miles around Stony Brook campus. Local inventory filtering is not yet implemented, so pickup eligibility remains unverified. Online shipping is considered separately; confirm delivery and charges before buying.</p><p>This version supports the XPS configuration above. Additional items need verified retailer connectors. No automatic purchases.</p></details>
</section>
}
function PriceCard({item,sources,history,save}:{item:Item;sources:Source[];history:Snapshot['history'];save:(i:Item,t:number,p:boolean)=>Promise<void>}){
 const [now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[])
 const [tab,setTab]=useState('new'),[target,setTarget]=useState(String(item.target_cents/100)),[status,setStatus]=useState(''),[saving,setSaving]=useState(false)
 const update=async(paused:boolean)=>{const value=Math.round(Number(target)*100);if(!Number.isFinite(value)||value<1){setStatus('Enter a valid target price.');return}setSaving(true);try{await save(item,value,paused);setStatus('Saved.')}catch(e){setStatus(e instanceof Error?e.message:'Save failed')}finally{setSaving(false)}}
 return <article className="card price-card">
<div className="price-item-header"><div><h2>{item.title.split(' · ')[0]}</h2><p className="price-specs">{item.title.split(' · ').slice(1).join(' · ')}</p></div><span className="price-watch-state">{item.paused?'Paused':'Watching'}</span></div>
<div className="price-target-line"><span>Target</span><strong>Below {money(item.target_cents)}</strong><span>USD · before tax</span></div>
<div className="filter-tabs" aria-label="Item condition">
<button aria-pressed={tab==='new'} onClick={()=>setTab('new')}>New</button>
<button aria-pressed={tab==='other'} onClick={()=>setTab('other')}>Open-box / Refurbished</button>
</div>
<div className="price-offers">{sources.map(s=>{const offers=s.last_good?.offers.filter(o=>tab==='new'?o.condition==='new':o.condition!=='new')??[];const stale=s.status!=='verified'||!s.last_good||now-Date.parse(s.last_good.observedAt)>7*3600000;return <section className="price-offer" key={s.store}>
<div className="price-offer-heading">
<h3>{names[s.store]??s.store}</h3>
<a href={s.last_good?.url??links[s.store]} target="_blank" rel="noreferrer">View store ↗</a>
</div>{offers.map(o=>
<div key={o.condition}>
<strong className="price-value">{money(o.cents)}{o.maxCents&&o.maxCents!==o.cents?` – ${money(o.maxCents)}`:''}</strong>{!stale&&!item.paused&&o.eligible&&o.cents<item.target_cents&&<span className="price-target">Below target · verify delivery</span>}<p>{o.availability}</p>
</div>)}{!offers.length&&<p>No verified {tab==='new'?'new':'open-box/refurbished'} offer.</p>}<div className="price-freshness">{stale&&s.last_good?'Stale price':s.status==='verified'?'Configuration verified':s.status==='unmatched'?'No matching listing':s.status==='pending'?'Awaiting check':'Needs verification'}</div>
{s.last_good&&<small>Observed {new Date(s.last_good.observedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>}
<details className="price-verification"><summary>Verification details</summary><p>{s.detail??'Awaiting first check'}</p>{s.last_attempt&&<small>Last attempt {new Date(s.last_attempt).toLocaleString()}</small>}</details></section>})}</div>
<details>
<summary>Price history</summary>{history.length?<div className="price-history">{history.slice(0,30).map(h=>
<p key={h.id}>{new Date(h.observed_at).toLocaleString()} · {names[h.store]} · {h.data.offers.filter(o=>tab==='new'?o.condition==='new':o.condition!=='new').map(o=>`${o.condition}: ${money(o.cents)}`).join(' / ')||'No offer for this condition'}</p>)}</div>:<p>No successful observations yet.</p>}</details>
<details>
<summary>Tracking settings</summary>
<form onSubmit={e=>{e.preventDefault();void update(item.paused)}}>
<label>Target price (USD)<input type="number" min="0.01" max="100000" step="0.01" value={target} onChange={e=>setTarget(e.target.value)}/>
</label>
<button disabled={saving}>Save target</button>
<button type="button" disabled={saving} onClick={()=>void update(!item.paused)}>{item.paused?'Resume':'Pause'} tracking</button>
</form>{status&&<p role="status">{status}</p>}</details>
</article>
}
