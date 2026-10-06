import {useEffect,useState,useCallback,useId,useMemo} from 'react'
import {aggregatePriceHistory,type HistoryCondition,type HistoryPeriod,type PriceObservation} from './priceHistory'
type Offer={condition:string;cents:number;maxCents?:number;eligible:boolean;availability:string}
type Source={item_id:string;store:string;status:string;detail:string;last_attempt:string|null;next_run:string;last_good:null|{observedAt:string;url:string;offers:Offer[]}}
type Item={id:string;title:string;target_cents:number;paused:boolean}
type Snapshot={items:Item[];sources:Source[];history:PriceObservation[]}
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
 const [tab,setTab]=useState<HistoryCondition>('new'),[target,setTarget]=useState(String(item.target_cents/100)),[status,setStatus]=useState(''),[saving,setSaving]=useState(false)
 const update=async(paused:boolean)=>{const value=Math.round(Number(target)*100);if(!Number.isFinite(value)||value<1){setStatus('Enter a valid target price.');return}setSaving(true);try{await save(item,value,paused);setStatus('Saved.')}catch(e){setStatus(e instanceof Error?e.message:'Save failed')}finally{setSaving(false)}}
 return <article className="card price-card">
<div className="price-item-header"><div><h2>{item.title.split(' · ')[0]}</h2><p className="price-specs">{item.title.split(' · ').slice(1).join(' · ')}</p></div><span className="price-watch-state">{item.paused?'Paused':'Watching'}</span></div>
<div className="price-target-line"><span>Target</span><strong>Below {money(item.target_cents)}</strong><span>USD · before tax</span></div>
<div className="filter-tabs" aria-label="Item condition">
<button aria-pressed={tab==='new'} onClick={()=>setTab('new')}>New</button>
 <button aria-pressed={tab==='open-box'} onClick={()=>setTab('open-box')}>Open-box</button>
</div>
 <div className="price-offers">{sources.map(s=>{const offers=s.last_good?.offers.filter(o=>o.condition===tab)??[];const stale=s.status!=='verified'||!s.last_good||now-Date.parse(s.last_good.observedAt)>7*3600000;return <section className="price-offer" key={s.store}>
<div className="price-offer-heading">
<h3>{names[s.store]??s.store}</h3>
<a href={s.last_good?.url??links[s.store]} target="_blank" rel="noreferrer">View store ↗</a>
</div>{offers.map(o=>
<div key={o.condition}>
<strong className="price-value">{money(o.cents)}{o.maxCents&&o.maxCents!==o.cents?` – ${money(o.maxCents)}`:''}</strong>{!stale&&!item.paused&&o.eligible&&o.cents<item.target_cents&&<span className="price-target">Below target · verify delivery</span>}<p>{o.availability}</p>
 </div>)}{!offers.length&&<p>No verified {tab==='new'?'new':'open-box'} offer.</p>}<div className="price-freshness">{stale&&s.last_good?'Stale price':s.status==='verified'?'Configuration verified':s.status==='unmatched'?'No matching listing':s.status==='pending'?'Awaiting check':'Needs verification'}</div>
{s.last_good&&<small>Observed {new Date(s.last_good.observedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>}
<details className="price-verification"><summary>Verification details</summary><p>{s.detail??'Awaiting first check'}</p>{s.last_attempt&&<small>Last attempt {new Date(s.last_attempt).toLocaleString()}</small>}</details></section>})}</div>
 <details>
 <summary>Price history</summary><PriceHistory history={history} condition={tab} targetCents={item.target_cents}/></details>
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

const chartColors=['#9c8de8','#62b6cb','#e9a66f','#83c6a5','#d982a8','#c5b96d']
function PriceHistory({history,condition,targetCents}:{history:PriceObservation[];condition:HistoryCondition;targetCents:number}){
 const [period,setPeriod]=useState<HistoryPeriod>('daily'),titleId=useId(),descriptionId=useId()
 const series=useMemo(()=>aggregatePriceHistory(history,period).filter(value=>value.condition===condition),[history,period,condition])
 const points=series.flatMap(value=>value.points),timestamps=points.map(point=>point.timestamp),prices=points.map(point=>point.cents)
 const minTime=Math.min(...timestamps),maxTime=Math.max(...timestamps),observedMin=Math.min(...prices),observedMax=Math.max(...prices)
 const targetMeaningful=Number.isInteger(targetCents)&&targetCents>0&&prices.length>0&&targetCents>=observedMin*.5&&targetCents<=observedMax*1.5
 const domainPrices=targetMeaningful?[...prices,targetCents]:prices
 let low=Math.min(...domainPrices),high=Math.max(...domainPrices)
 const padding=Number.isFinite(low)?Math.max((high-low)*.12,Math.max(high,1)*.025):0
 low-=padding;high+=padding
 const x=(timestamp:number)=>minTime===maxTime?320:44+(timestamp-minTime)/(maxTime-minTime)*572
 const y=(cents:number)=>high===low?102:18+(high-cents)/(high-low)*154
 const rows=series.flatMap(value=>value.points.map(point=>({...point,store:value.store,condition:value.condition}))).sort((a,b)=>b.timestamp-a.timestamp||a.store.localeCompare(b.store))
 const dateLabel=(timestamp:number,short=false)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:short?'short':'long',day:period==='daily'?'numeric':undefined,year:'numeric'}).format(timestamp)
 const conditionName=condition==='new'?'new':'open-box'
 return <div className="price-history">
  <div className="price-history-toolbar"><div className="history-period" aria-label="Price history interval"><button aria-pressed={period==='daily'} onClick={()=>setPeriod('daily')}>Daily</button><button aria-pressed={period==='monthly'} onClick={()=>setPeriod('monthly')}>Monthly</button></div><small>Eastern Time</small></div>
  <p className="price-history-note">Each point is the lowest verified observed {conditionName} price for that retailer in the {period==='daily'?'day':'month'}.</p>
  {!points.length?<p className="price-history-empty">No verified {conditionName} price history yet.</p>:<>
   <div className="price-chart-wrap"><svg className="price-chart" viewBox="0 0 640 210" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
    <title id={titleId}>{period==='daily'?'Daily':'Monthly'} {conditionName} price history</title>
    <desc id={descriptionId}>{points.length===1?'One verified observation; no trend line is inferred.':`${points.length} minimum price points from ${dateLabel(minTime)} through ${dateLabel(maxTime)}, spaced by actual bucket date.`}</desc>
    <line className="price-chart-grid" x1="44" x2="616" y1="18" y2="18"/><line className="price-chart-grid" x1="44" x2="616" y1="172" y2="172"/>
    <text className="price-chart-label" x="40" y="22" textAnchor="end">{money(high)}</text><text className="price-chart-label" x="40" y="176" textAnchor="end">{money(low)}</text>
    {targetMeaningful&&<><line data-testid="price-target-line" className="price-chart-target" x1="44" x2="616" y1={y(targetCents)} y2={y(targetCents)}/><text className="price-chart-label" x="612" y={y(targetCents)-5} textAnchor="end">Target {money(targetCents)}</text></>}
    {series.map((value,index)=>{const path=value.points.map((point,pointIndex)=>`${pointIndex?'L':'M'} ${x(point.timestamp)} ${y(point.cents)}`).join(' '),color=chartColors[index%chartColors.length];return <g key={`${value.store}-${value.condition}`} data-series={`${value.store}-${value.condition}`}>{value.points.length>1&&<path className="price-chart-series" d={path} stroke={color}/>} {value.points.map(point=><circle key={point.bucket} cx={x(point.timestamp)} cy={y(point.cents)} r="4" fill={color}><title>{names[value.store]??value.store}: {money(point.cents)} on {dateLabel(point.timestamp)}</title></circle>)}</g>})}
    <text className="price-chart-label" x={minTime===maxTime?320:44} y="198" textAnchor={minTime===maxTime?'middle':'start'}>{dateLabel(minTime,true)}</text>{minTime!==maxTime&&<text className="price-chart-label" x="616" y="198" textAnchor="end">{dateLabel(maxTime,true)}</text>}
   </svg></div>
   {points.length===1&&<p className="price-history-single">One verified point only; a trend needs another observation.</p>}
   <div className="price-history-legend">{series.map((value,index)=><span key={value.store}><i style={{background:chartColors[index%chartColors.length]}}/>{names[value.store]??value.store} · {conditionName}</span>)}{targetMeaningful&&<span><i className="target-key"/>Target</span>}</div>
   <details className="price-history-values"><summary>History values</summary><div className="price-history-table-wrap"><table><caption className="sr-only">Price history values in Eastern calendar buckets</caption><thead><tr><th scope="col">Date</th><th scope="col">Retailer</th><th scope="col">Condition</th><th scope="col">Minimum</th></tr></thead><tbody>{rows.map(row=><tr key={`${row.store}-${row.bucket}`}><td>{dateLabel(row.timestamp)}</td><td>{names[row.store]??row.store}</td><td>{row.condition==='new'?'New':'Open-box'}</td><td>{money(row.cents)}</td></tr>)}</tbody></table></div></details>
  </>}
 </div>
}
