import DOMPurify from 'dompurify'
import {readableEmailUrl} from './emailLinks'

const tags=['a','abbr','b','blockquote','br','caption','code','col','colgroup','del','div','em','h1','h2','h3','h4','hr','i','img','li','ol','p','pre','s','small','span','strong','sub','sup','table','tbody','td','tfoot','th','thead','tr','u','ul']
const attrs=['align','alt','colspan','height','href','rowspan','style','title','valign','width']
const sizes=String.raw`(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))`
const patterns:Record<string,RegExp>={
 color:/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.% ,+-]+\)|[a-z]+)$/i,
 'background-color':/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.% ,+-]+\)|[a-z]+)$/i,
 'font-family':/^(?:[- a-z\d]+|"[- a-z\d]+"|'[- a-z\d]+')(?:\s*,\s*(?:[- a-z\d]+|"[- a-z\d]+"|'[- a-z\d]+'))*$/i,
 'font-size':new RegExp(`^(?:${sizes}|xx-small|x-small|small|medium|large|x-large|xx-large)$`,'i'),
 'font-weight':/^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
 'font-style':/^(?:normal|italic|oblique)$/i,
 'text-decoration':/^(?:none|underline|line-through)(?:\s+(?:underline|line-through))*$/i,
 'text-align':/^(?:left|right|center|justify|start|end)$/i,
 'vertical-align':/^(?:baseline|middle|top|bottom|text-top|text-bottom|sub|super)$/i,
 'white-space':/^(?:normal|nowrap|pre|pre-wrap|pre-line)$/i,
 'border-collapse':/^(?:collapse|separate)$/i,
 'border-spacing':new RegExp(String.raw`^${sizes}(?:\s+${sizes})?$`,'i'),
 width:new RegExp(`^(?:${sizes}|auto)$`,'i'),
 'max-width':new RegExp(`^(?:${sizes}|none)$`,'i'),
 height:new RegExp(`^(?:${sizes}|auto)$`,'i'),
 padding:new RegExp(String.raw`^${sizes}(?:\s+${sizes}){0,3}$`,'i'),
 margin:new RegExp(String.raw`^(?:${sizes}|auto)(?:\s+(?:${sizes}|auto)){0,3}$`,'i'),
 border:/^(?:0|\d+(?:\.\d+)?px\s+(?:none|solid|dashed|dotted|double)\s+(?:#[\da-f]{3,8}|[a-z]+))$/i,
}

export function safeEmailStyle(value:string){
 return value.split(';').map(part=>part.trim()).filter(Boolean).flatMap(part=>{
  const colon=part.indexOf(':');if(colon<1)return []
  const property=part.slice(0,colon).trim().toLowerCase(),candidate=part.slice(colon+1).trim()
  if(/url\s*\(|@import|expression\s*\(|var\s*\(|--|[{}\\]/i.test(part))return []
  return patterns[property]?.test(candidate)?[`${property}:${candidate}`]:[]
 }).join(';')
}

function hostLabel(href:string){try{return new URL(href).hostname}catch{return ''}}

export function sanitizeEmailHtml(raw:string,loadImages=false){
 const template=document.createElement('template'),root=document.createElement('div'),imageSources=new WeakMap<Element,string>()
 template.content.append(root);root.innerHTML=raw
 for(const element of root.querySelectorAll('*')){
  if(element.tagName==='IMG')imageSources.set(element,element.getAttribute('src')||'')
  for(const resource of ['src','srcset','poster','background','data','action','formaction','ping'])element.removeAttribute(resource)
  if(element.tagName==='LINK')element.removeAttribute('href')
 }
 DOMPurify.sanitize(root,{IN_PLACE:true,ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,FORBID_TAGS:['base','form','frame','iframe','link','math','meta','object','script','style','svg','template']})
 for(const element of root.querySelectorAll<HTMLElement>('*')){
  const style=safeEmailStyle(element.getAttribute('style')||'');if(style)element.setAttribute('style',style);else element.removeAttribute('style')
  for(const attr of [...element.attributes])if(attr.name.startsWith('on')||['srcset','ping','download','formaction'].includes(attr.name))element.removeAttribute(attr.name)
  if(element.tagName==='IMG'){
   const source=imageSources.get(element)||'',readable=readableEmailUrl(source)
   if(readable){element.setAttribute('data-email-image',readable.target);if(loadImages)element.setAttribute('src',readable.target)}
   else if(source.toLowerCase().startsWith('cid:'))element.setAttribute('alt',element.getAttribute('alt')||'[Embedded image unavailable]')
  }
 }
 for(const anchor of root.querySelectorAll('a')){
  const readable=readableEmailUrl(anchor.getAttribute('href')||'')
  if(!readable){anchor.removeAttribute('href');anchor.removeAttribute('target');continue}
  anchor.href=readable.target;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.referrerPolicy='no-referrer'
  const destination=document.createElement('small');destination.className='email-link-host';destination.textContent=` [${hostLabel(readable.target)}]`;anchor.append(destination)
 }
 root.replaceWith(...root.childNodes)
 const csp=loadImages?"default-src 'none'; style-src 'unsafe-inline'; img-src http: https:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'":"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"></head><body style="margin:12px;font-family:system-ui,sans-serif;font-size:14px">${template.innerHTML}</body></html>`
}
