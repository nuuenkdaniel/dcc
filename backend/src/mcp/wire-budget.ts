import type {Result} from './contracts.js'

export const RELAY_RESPONSE_BYTES=524288
// The relay accepts at most 65536 input bytes, so even the entire input as an
// encoded id fits this reservation. Include whitespace/SDK framing headroom.
const ID_AND_FRAME_BYTES=65536+4096
export function toolResponse(result:Result,source:string){
  const envelope={source,result}
  return {content:[{type:'text' as const,text:JSON.stringify(envelope)}],structuredContent:envelope,isError:!['ok','applied','saved'].includes(result.state)}
}
export function fitsRelay(result:Result,source='dcc-service'){
  return Buffer.byteLength(JSON.stringify(toolResponse(result,source)),'utf8')+ID_AND_FRAME_BYTES<=RELAY_RESPONSE_BYTES
}
// Slice BEFORE returning from the source adapter. Offset advances only by rows
// actually returned; an oversized row is never silently skipped or truncated.
export function boundedPage(items:unknown[],limit:number,offset:number,extra:Record<string,unknown>={}):Extract<Result,{state:'ok'}>{
  let count=Math.min(items.length,limit)
  const result=():Extract<Result,{state:'ok'}>=>({state:'ok',data:{items:items.slice(0,count),nextOffset:items.length>count?offset+count:null,...extra}})
  while(count>0&&!fitsRelay(result()))count--
  if(items.length>0&&count===0)throw Error('A projected row exceeds relay budget')
  if(items.length>count&&offset+count>10000)throw Error('Page boundary exhausted')
  return result()
}
