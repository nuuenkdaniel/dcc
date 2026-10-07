import {useEffect,useId,useState} from 'react'
import {emailBodyParts} from './emailLinks'
import {readableEmailBody} from './readableEmailBody'
import {type EmailHtmlCache,type EmailHtmlResult} from './EmailHtmlCache'
import {useEmailHtmlCache} from './EmailHtmlCacheContext'
import {EmailHtmlCacheProvider} from './EmailHtmlCacheProvider'

type EmailBodyProps={body:string;id?:string;hasHtml?:boolean;open?:boolean}
export function EmailBody(props:EmailBodyProps){
 const cache=useEmailHtmlCache()
 return cache?<EmailBodyContent {...props} cache={cache}/>:<EmailHtmlCacheProvider><EmailBodyWithCache {...props}/></EmailHtmlCacheProvider>
}
function EmailBodyWithCache(props:EmailBodyProps){return <EmailBodyContent {...props} cache={useEmailHtmlCache()!}/>}
function EmailBodyContent({body,id,hasHtml,open=true,cache}:EmailBodyProps&{cache:EmailHtmlCache}){
 const eligible=Boolean(id&&open&&hasHtml!==false)
 const [result,setResult]=useState<EmailHtmlResult|undefined>(()=>eligible?cache.get(id!):undefined)
 const readable=readableEmailBody(body),[showOriginal,setShowOriginal]=useState(false),[view,setView]=useState<'formatted'|'text'>('formatted'),[expanded,setExpanded]=useState(false),[error,setError]=useState(''),frameId=useId()
 useEffect(()=>{if(!eligible||!id||result)return;let active=true;cache.load(id).then(value=>{if(active)setResult(value)}).catch(()=>{if(active)setError('Formatted view unavailable; showing cached text.')});return()=>{active=false}},[cache,eligible,id,result])
 const displayed=showOriginal?body:readable
 if(result?.kind==='html'&&view==='formatted')return <>
   <div className="email-view-toggle" role="group" aria-label="Email view"><button type="button" aria-pressed="true">Formatted</button><button type="button" aria-pressed="false" onClick={()=>setView('text')}>Text</button></div>
   <details className="email-privacy-details"><summary>Privacy details</summary><p>Remote images load directly from your browser without a proxy and can reveal your IP. Basic URL checks do not verify reputation, DNS results, or redirects. Embedded CID images remain unavailable.</p></details>
   <div className="email-frame-controls"><button type="button" aria-controls={frameId} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Reduce view':'Expand view'}</button></div>
   <iframe id={frameId} className={`email-html-frame${expanded?' email-html-frame-expanded':''}`} title="Formatted email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={result.srcDoc}/>
  </>
 const loading=eligible&&!result&&!error
 return <>
    {result?.kind==='html'&&<div className="email-view-toggle" role="group" aria-label="Email view"><button type="button" aria-pressed="false" onClick={()=>setView('formatted')}>Formatted</button><button type="button" aria-pressed="true">Text</button></div>}
    {loading&&view==='formatted'&&<div className="email-privacy-note"><span role="status">Loading formatted view…</span> <button type="button" onClick={()=>setView('text')}>Show text now</button></div>}
    {loading&&view==='text'&&<p className="email-privacy-note" role="status">Loading formatted view…</p>}
    {error&&<p className="email-privacy-note" role="status">{error}</p>}
   {(!loading||view==='text')&&<>
   {readable!==body&&<div className="email-spacing-toggle" role="group" aria-label="Email text spacing">
   <button type="button" aria-pressed={!showOriginal} onClick={()=>setShowOriginal(false)}>Readable spacing</button>
   <button type="button" aria-pressed={showOriginal} onClick={()=>setShowOriginal(true)}>Original text</button>
   </div>}
   <pre className="email-body">{emailBodyParts(displayed).map((part,index)=>part.kind==='text'?part.text:<a key={index} href={part.target} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={part.target} aria-label={part.target}>{part.label}</a>)}</pre>
   </>}
  </>
}
