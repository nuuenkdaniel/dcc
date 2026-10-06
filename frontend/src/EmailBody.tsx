import {useEffect,useMemo,useState} from 'react'
import {emailBodyParts} from './emailLinks'
import {readableEmailBody} from './readableEmailBody'
import {sanitizeEmailHtml} from './emailHtml'

type EmailBodyProps={body:string;id?:string;hasHtml?:boolean;open?:boolean}
export function EmailBody(props:EmailBodyProps){return <EmailBodyContent key={`${props.id??'text'}:${props.open!==false}`} {...props}/>}
function EmailBodyContent({body,id,hasHtml,open=true}:EmailBodyProps){
 const readable=readableEmailBody(body),[showOriginal,setShowOriginal]=useState(false),[html,setHtml]=useState<string|null>(),[view,setView]=useState<'formatted'|'text'>('formatted'),[loadImages,setLoadImages]=useState(false),[error,setError]=useState('')
 useEffect(()=>{if(!id||!open||hasHtml===false)return;let active=true,timedOut=false;const controller=new AbortController(),timer=setTimeout(()=>{timedOut=true;controller.abort()},15000);fetch(`/api/v1/mail/html/${encodeURIComponent(id)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();return response.json()}).then(data=>{if(active)setHtml(typeof data.html==='string'?data.html:null)}).catch(reason=>{if(active&&(timedOut||reason?.name!=='AbortError'))setError('Formatted view unavailable; showing cached text.')}).finally(()=>clearTimeout(timer));return()=>{active=false;clearTimeout(timer);controller.abort()}},[id,hasHtml,open])
 const srcDoc=useMemo(()=>typeof html==='string'?sanitizeEmailHtml(html,loadImages):'',[html,loadImages])
 const displayed=showOriginal?body:readable
 if(typeof html==='string'&&view==='formatted')return <>
  <div className="email-view-toggle" role="group" aria-label="Email view"><button type="button" aria-pressed="true">Formatted</button><button type="button" aria-pressed="false" onClick={()=>setView('text')}>Text</button></div>
  <p className="email-privacy-note">Remote images are blocked for privacy.</p>
  <details className="email-privacy-details"><summary>Privacy details</summary><p>Loading images sends requests directly from your browser without a proxy and can reveal your IP. URL checks do not verify DNS results or redirects. Embedded CID images remain unavailable.</p></details>
  {!loadImages&&<button type="button" className="secondary-action email-load-images" onClick={()=>setLoadImages(true)}>Load images</button>}
  <iframe className="email-html-frame" title="Formatted email" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc}/>
 </>
 return <>
   {typeof html==='string'&&<div className="email-view-toggle" role="group" aria-label="Email view"><button type="button" aria-pressed="false" onClick={()=>setView('formatted')}>Formatted</button><button type="button" aria-pressed="true">Text</button></div>}
   {id&&html===undefined&&!error&&hasHtml!==false&&<p className="email-privacy-note" role="status">Loading safe formatted view…</p>}
   {error&&<p className="email-privacy-note" role="status">{error}</p>}
  {readable!==body&&<div className="email-spacing-toggle" role="group" aria-label="Email text spacing">
   <button type="button" aria-pressed={!showOriginal} onClick={()=>setShowOriginal(false)}>Readable spacing</button>
   <button type="button" aria-pressed={showOriginal} onClick={()=>setShowOriginal(true)}>Original text</button>
  </div>}
  <pre className="email-body">{emailBodyParts(displayed).map((part,index)=>part.kind==='text'?part.text:<a key={index} href={part.target} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={part.target} aria-label={part.target}>{part.label}</a>)}</pre>
 </>
}
