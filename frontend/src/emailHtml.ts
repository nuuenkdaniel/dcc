import DOMPurify from 'dompurify'
import {readableEmailUrl} from './emailLinks'

const tags=['a','abbr','b','blockquote','br','caption','code','col','colgroup','del','div','em','h1','h2','h3','h4','hr','i','img','li','ol','p','pre','s','small','span','strong','sub','sup','table','tbody','td','tfoot','th','thead','tr','u','ul']
const attrs=['align','alt','bgcolor','colspan','height','href','rowspan','style','text','title','valign','width']
const sizes=String.raw`(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))`
const color=String.raw`(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.% ,+-]+\)|[a-z]+)`
const borderStyle=String.raw`(?:none|solid|dashed|dotted|double)`
const patterns:Record<string,RegExp>={
 color:new RegExp(`^${color}$`,'i'),
 'background-color':new RegExp(`^${color}$`,'i'),
 'font-family':/^(?:[- a-z\d]+|"[- a-z\d]+"|'[- a-z\d]+')(?:\s*,\s*(?:[- a-z\d]+|"[- a-z\d]+"|'[- a-z\d]+'))*$/i,
 'font-size':new RegExp(`^(?:${sizes}|xx-small|x-small|small|medium|large|x-large|xx-large)$`,'i'),
 'font-weight':/^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
 'font-style':/^(?:normal|italic|oblique)$/i,
 'text-decoration':/^(?:none|underline|line-through)(?:\s+(?:underline|line-through))*$/i,
 'text-align':/^(?:left|right|center|justify|start|end)$/i,
 'vertical-align':/^(?:baseline|middle|top|bottom|text-top|text-bottom|sub|super)$/i,
 'white-space':/^(?:normal|nowrap|pre|pre-wrap|pre-line)$/i,
 'line-height':new RegExp(String.raw`^(?:normal|\d+(?:\.\d+)?|${sizes})$`,'i'),
 display:/^(?:inline|block|inline-block|table|table-row|table-cell)$/i,
 'border-collapse':/^(?:collapse|separate)$/i,
 'border-spacing':new RegExp(String.raw`^${sizes}(?:\s+${sizes})?$`,'i'),
 width:new RegExp(`^(?:${sizes}|auto)$`,'i'),
 'max-width':new RegExp(`^(?:${sizes}|none)$`,'i'),
 height:new RegExp(`^(?:${sizes}|auto)$`,'i'),
 padding:new RegExp(String.raw`^${sizes}(?:\s+${sizes}){0,3}$`,'i'),
 margin:new RegExp(String.raw`^(?:${sizes}|auto)(?:\s+(?:${sizes}|auto)){0,3}$`,'i'),
 'border-radius':new RegExp(String.raw`^${sizes}(?:\s+${sizes}){0,3}(?:\s*/\s*${sizes}(?:\s+${sizes}){0,3})?$`,'i'),
 border:new RegExp(String.raw`^(?:0|${sizes}\s+${borderStyle}\s+${color})$`,'i'),
 'border-color':new RegExp(String.raw`^${color}(?:\s+${color}){0,3}$`,'i'),
 'border-style':new RegExp(String.raw`^${borderStyle}(?:\s+${borderStyle}){0,3}$`,'i'),
 'border-width':new RegExp(String.raw`^(?:${sizes}|thin|medium|thick)(?:\s+(?:${sizes}|thin|medium|thick)){0,3}$`,'i'),
}
for(const side of ['top','right','bottom','left']){
 patterns[`margin-${side}`]=new RegExp(`^(?:${sizes}|auto)$`,'i')
 patterns[`padding-${side}`]=new RegExp(`^${sizes}$`,'i')
 patterns[`border-${side}-color`]=new RegExp(`^${color}$`,'i')
 patterns[`border-${side}-style`]=new RegExp(`^${borderStyle}$`,'i')
 patterns[`border-${side}-width`]=new RegExp(`^(?:${sizes}|thin|medium|thick)$`,'i')
}

export function safeEmailStyle(value:string){
 return value.split(';').map(part=>part.trim()).filter(Boolean).flatMap(part=>{
  const colon=part.indexOf(':');if(colon<1)return []
  const property=part.slice(0,colon).trim().toLowerCase(),candidate=part.slice(colon+1).trim()
  if(/url\s*\(|@import|expression\s*\(|var\s*\(|--|[{}\\]/i.test(part))return []
  return patterns[property]?.test(candidate)?[`${property}:${candidate}`]:[]
 }).join(';')
}

function openingAttributes(raw:string,tag:string){
 const match=new RegExp(`<\\s*${tag}\\b`,'i').exec(raw)
 if(!match)return null
 let quote='',end=match.index+match[0].length
 for(;end<raw.length;end++){
  const char=raw[end]
  if(quote){if(char===quote)quote='';continue}
  if(char==='"'||char==="'"){quote=char;continue}
  if(char==='>')break
 }
 if(end===raw.length)return null
 const template=document.createElement('template')
 template.innerHTML=`<div${raw.slice(match.index+match[0].length,end)}></div>`
 return template.content.firstElementChild as HTMLElement|null
}

function convertedStyle(element:Element|null,includeText=false){
 if(!element)return ''
 const legacy=[
  element.getAttribute('bgcolor')&&`background-color:${element.getAttribute('bgcolor')}`,
  includeText&&element.getAttribute('text')&&`color:${element.getAttribute('text')}`,
  element.getAttribute('align')&&`text-align:${element.getAttribute('align')}`,
 ].filter((value):value is string=>Boolean(value)).join(';')
 return safeEmailStyle(`${legacy};${element.getAttribute('style')||''}`)
}

function hostLabel(href:string){try{return new URL(href).hostname}catch{return ''}}

export function sanitizeEmailHtml(raw:string){
 const template=document.createElement('template'),root=document.createElement('div'),imageSources=new WeakMap<Element,string>(),anchorLabels=new WeakMap<Element,string>()
 template.content.append(root);root.innerHTML=raw
 const wrapperStyle=[convertedStyle(openingAttributes(raw,'html'),true),convertedStyle(openingAttributes(raw,'body'),true)].filter(Boolean).join(';')
 for(const element of root.querySelectorAll('*')){
  if(element.tagName==='IMG')imageSources.set(element,element.getAttribute('src')||'')
  if(element.tagName==='A')anchorLabels.set(element,element.textContent?.trim()||element.querySelector('img')?.getAttribute('alt')?.trim()||'Link')
  for(const resource of ['src','srcset','poster','background','data','action','formaction','ping'])element.removeAttribute(resource)
  if(element.tagName==='LINK')element.removeAttribute('href')
 }
 DOMPurify.sanitize(root,{IN_PLACE:true,ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,FORBID_TAGS:['base','form','frame','iframe','link','math','meta','object','script','style','svg','template']})
 for(const element of root.querySelectorAll<HTMLElement>('*')){
  const style=convertedStyle(element);if(style)element.setAttribute('style',style);else element.removeAttribute('style')
  element.removeAttribute('bgcolor');element.removeAttribute('text');element.removeAttribute('align')
  for(const attr of [...element.attributes])if(attr.name.startsWith('on')||['srcset','ping','download','formaction'].includes(attr.name))element.removeAttribute(attr.name)
  if(element.tagName==='IMG'){
   const source=imageSources.get(element)||'',readable=readableEmailUrl(source)
   if(readable){element.setAttribute('data-email-image',readable.target);element.setAttribute('src',readable.target)}
   else if(source.toLowerCase().startsWith('cid:'))element.setAttribute('alt',element.getAttribute('alt')||'[Embedded image unavailable]')
  }
 }
 for(const anchor of root.querySelectorAll('a')){
  const readable=readableEmailUrl(anchor.getAttribute('href')||'')
  if(!readable){for(const attr of ['href','target','rel','referrerpolicy','title','aria-label'])anchor.removeAttribute(attr);continue}
  anchor.href=readable.target;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.referrerPolicy='no-referrer'
  anchor.title=readable.target;anchor.setAttribute('aria-label',`${anchorLabels.get(anchor)||'Link'} (${hostLabel(readable.target)})`)
 }
 root.className='email-content'
 root.setAttribute('style',`min-height:calc(100vh - 24px);box-sizing:border-box;${wrapperStyle}`)
 const csp="default-src 'none'; style-src 'unsafe-inline'; img-src http: https:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"></head><body style="margin:12px;font-family:system-ui,sans-serif;font-size:14px">${template.innerHTML}</body></html>`
}
