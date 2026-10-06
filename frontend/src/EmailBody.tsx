import {emailBodyParts} from './emailLinks'

export function EmailBody({body}:{body:string}){
 return <pre className="email-body">{emailBodyParts(body).map((part,index)=>part.kind==='text'?part.text:<a key={index} href={part.target} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={part.target} aria-label={part.target}>{part.label}</a>)}</pre>
}
