const origins:Record<string,string>={bestbuy:'https://www.bestbuy.com',dell:'https://www.dell.com',microcenter:'https://www.microcenter.com'}
export function safeRetailerUrl(store:string,candidate:string|undefined){
 try{if(!candidate||candidate.length>4096)return null;const url=new URL(candidate);return url.protocol==='https:'&&!url.username&&!url.password&&url.origin===origins[store]?url.href:null}catch{return null}
}
