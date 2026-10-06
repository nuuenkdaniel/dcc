export type EmailBodyPart =
  | {kind:'text';text:string}
  | {kind:'link';target:string;label:string}

const urlStart=/https?:\/\/[^\s<>"']+/giu
const hidden=/[\p{Cc}\p{Default_Ignorable_Code_Point}]/u
const nonAmpEntity=/&(?!amp;|#0*38;|#x0*26;)(?:[a-z][a-z\d]+|#(?:\d+|x[\da-f]+));/iu
const terminalPunctuation=/[.,!?;:]$/u

function decodeQueryAmpersands(value:string){
 const query=value.indexOf('?')
 if(query<0)return value
 const hash=value.indexOf('#',query)
 const end=hash<0?value.length:hash
 return value.slice(0,query+1)+value.slice(query+1,end).replace(/&(amp|#0*38|#x0*26);/giu,'&')+value.slice(end)
}

function trimCandidate(value:string){
 const entity=value.search(nonAmpEntity)
 const query=value.indexOf('?')
 const hash=query<0?-1:value.indexOf('#',query)
 const closingMarkup=entity>=0&&/^&lt;\/a&gt;/iu.test(value.slice(entity))
 if(terminalPunctuation.test(value)&&(query>=0||value.includes('#'))&&!closingMarkup)return {url:value,suffix:'',reject:true}
 if(entity>query&&query>=0&&(hash<0||entity<hash)&&!closingMarkup)return {url:value,suffix:'',reject:true}
 let url=entity<0?value:value.slice(0,entity)
 let suffix=entity<0?'':value.slice(entity)
 const balance:Record<string,number>={'(':0,'[':0,'{':0}
 const opener:Record<string,string>={')':'(',']':'[','}':'{'}
 for(let index=0;index<url.length;index++){
  const char=url[index]
  if(char in balance)balance[char]++
  else if(char in opener){
   const open=opener[char]
    if(balance[open]===0){
     const rest=url.slice(index+1)
     if(char===')'&&rest&&!/^[.,!;:](?:\p{Lu}|$)/u.test(rest))continue
     suffix=url.slice(index)+suffix;url=url.slice(0,index);break
    }
    balance[open]--
   }
 }
 if(terminalPunctuation.test(url)){
  if(/[?#]/u.test(url))return {url:value,suffix:'',reject:true}
  const pathStart=url.indexOf('/',url.indexOf('://')+3)
  if(pathStart>=0)while(terminalPunctuation.test(url)){suffix=url.slice(-1)+suffix;url=url.slice(0,-1)}
 }
 return {url,suffix,reject:false}
}

function decodePunycode(input:string){
 const output:string[]=[]
 const split=input.lastIndexOf('-')
 let index=0,n=128,bias=72,delta=0
 if(split>=0){for(const char of input.slice(0,split))output.push(char);index=split+1}
 const adapt=(delta:number,count:number,first:boolean)=>{delta=first?Math.floor(delta/700):delta>>1;delta+=Math.floor(delta/count);let k=0;while(delta>455){delta=Math.floor(delta/35);k+=36}return k+Math.floor(36*delta/(delta+38))}
 while(index<input.length){
  const old=delta;let weight=1
  for(let k=36;;k+=36){
   if(index>=input.length)return null
   const code=input.charCodeAt(index++),digit=code>=48&&code<=57?code-22:code>=65&&code<=90?code-65:code>=97&&code<=122?code-97:36
   if(digit>=36)return null
   if(digit*weight>Number.MAX_SAFE_INTEGER-delta)return null
   delta+=digit*weight
   const threshold=k<=bias?1:k>=bias+26?26:k-bias
   if(digit<threshold)break
   if(weight>Number.MAX_SAFE_INTEGER/(36-threshold))return null
   weight*=36-threshold
  }
  const count=output.length+1
  bias=adapt(delta-old,count,old===0)
  n+=Math.floor(delta/count)
  if(n>0x10ffff)return null
  delta%=count
  output.splice(delta,0,String.fromCodePoint(n))
  delta++
 }
 return output.join('')
}

function hasMixedSpoofingScript(hostname:string){
 return hostname.split('.').some(raw=>{
  const label=raw.toLowerCase().startsWith('xn--')?decodePunycode(raw.slice(4)):raw
  if(label===null)return true
  const scripts=[/\p{Script=Latin}/u,/\p{Script=Cyrillic}/u,/\p{Script=Greek}/u]
  return scripts.filter(script=>script.test(label)).length>1
 })
}

function isReservedIpv4(hostname:string){
 if(!/^\d+(?:\.\d+){3}$/.test(hostname))return false
 const [a,b,c]=hostname.split('.').map(Number)
 return a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&c===0||b===0&&c===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113
}

function isReservedIpv6(hostname:string){
 const host=hostname.replace(/^\[|\]$/g,'').toLowerCase()
 if(!host.includes(':'))return false
 if(host.startsWith('::ffff:'))return true
 const second=Number.parseInt(host.split(':')[1]||'0',16)
 if(host==='::'||host==='::1'||host.startsWith('fc')||host.startsWith('fd')||/^fe[89ab]/.test(host)||host.startsWith('ff')||host.startsWith('2001:db8:')||host.startsWith('2001:')&&second<=0x1ff||host.startsWith('2002:')||host.startsWith('3fff:'))return true
 const mapped=host.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)
 return mapped?isReservedIpv4(mapped[1]):!/^[23]/.test(host)
}

export function readableEmailUrl(raw:string){
 const target=decodeQueryAmpersands(raw)
 if(hidden.test(target))return null
 let parsed:URL
 try{parsed=new URL(target)}catch{return null}
 if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return null
 if(parsed.username||parsed.password)return null
 const hostname=parsed.hostname.replace(/\.$/,'').toLowerCase()
 const reservedAddress=isReservedIpv4(hostname)||isReservedIpv6(hostname)
 const internal=hostname==='localhost'||hostname==='home.arpa'||['.localhost','.local','.internal','.lan','.home','.localdomain','.home.arpa'].some(suffix=>hostname.endsWith(suffix))
 if(!hostname||internal||reservedAddress||!hostname.includes('.')&&!hostname.includes(':'))return null
 let decoded:string
 try{decoded=decodeURIComponent(parsed.pathname+parsed.search+parsed.hash)}catch{return null}
 if(hidden.test(decoded)||hasMixedSpoofingScript(hostname))return null
 if([...target].length<=72)return {target,label:target}
 let path:string
 try{path=decodeURIComponent(parsed.pathname)}catch{path=parsed.pathname}
 const pieces=path.split('/').filter(Boolean).slice(0,2)
 let shortPath=pieces.length?'/'+pieces.join('/'):'/'
 if([...shortPath].length>38)shortPath=[...shortPath].slice(0,35).join('')+'…'
 const omitted=parsed.search||parsed.hash||path!==shortPath&&path!=='/'
 return {target,label:parsed.host+shortPath+(omitted&&!shortPath.endsWith('…')?'…':'')}
}

export function emailBodyParts(body:string):EmailBodyPart[]{
 const parts:EmailBodyPart[]=[]
 let cursor=0
 for(const match of body.matchAll(urlStart)){
  const start=match.index
  if(start>cursor)parts.push({kind:'text',text:body.slice(cursor,start)})
  const {url,suffix,reject}=trimCandidate(match[0])
  if(reject){parts.push({kind:'text',text:match[0]});cursor=start+match[0].length;continue}
  const readable=readableEmailUrl(url)
  if(readable)parts.push({kind:'link',...readable})
  else parts.push({kind:'text',text:url})
  if(suffix)parts.push({kind:'text',text:suffix})
  cursor=start+match[0].length
 }
 if(cursor<body.length)parts.push({kind:'text',text:body.slice(cursor)})
 return parts
}
