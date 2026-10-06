import {useState} from 'react'
import {emailBodyParts} from './emailLinks'
import {readableEmailBody} from './readableEmailBody'

export function EmailBody({body}:{body:string}){
 const readable=readableEmailBody(body),[showOriginal,setShowOriginal]=useState(false)
 const displayed=showOriginal?body:readable
 return <>
  {readable!==body&&<div className="email-spacing-toggle" role="group" aria-label="Email text spacing">
   <button type="button" aria-pressed={!showOriginal} onClick={()=>setShowOriginal(false)}>Readable spacing</button>
   <button type="button" aria-pressed={showOriginal} onClick={()=>setShowOriginal(true)}>Original text</button>
  </div>}
  <pre className="email-body">{emailBodyParts(displayed).map((part,index)=>part.kind==='text'?part.text:<a key={index} href={part.target} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={part.target} aria-label={part.target}>{part.label}</a>)}</pre>
 </>
}
