import {expect,it,vi} from 'vitest'
import {EMAIL_HTML_CACHE_MAX_BYTES,EMAIL_HTML_CACHE_MAX_ENTRIES,EMAIL_HTML_FETCH_TIMEOUT_MS,EmailHtmlCache} from './EmailHtmlCache'

const response=(html:string|null)=>({ok:true,json:async()=>({html})} as Response)

it('deduplicates in-flight HTML retrieval and caches HTML and no-HTML results',async()=>{
 let resolveRequest!:(value:Response)=>void
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{resolveRequest=resolve})),cache=new EmailHtmlCache(fetcher)
 const first=cache.load('same'),duplicate=cache.load('same')
 expect(first).toBe(duplicate);expect(fetcher).toHaveBeenCalledTimes(1)
 resolveRequest(response('<p>Hello</p>'))
 expect((await first).kind).toBe('html')
 await cache.load('same');expect(fetcher).toHaveBeenCalledTimes(1)

 const noHtml=await new EmailHtmlCache(vi.fn(async()=>response(null))).load('none')
 expect(noHtml.kind).toBe('no-html')
})

it('does not cache timeout failures and retries them',async()=>{
 vi.useFakeTimers()
 try{
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(()=>{})).mockResolvedValueOnce(response('<p>Retry worked</p>'))
   const cache=new EmailHtmlCache(fetcher),failed=cache.load('retry'),rejection=expect(failed).rejects.toThrow('timed out')
   await vi.advanceTimersByTimeAsync(EMAIL_HTML_FETCH_TIMEOUT_MS)
   await rejection
  await expect(cache.load('retry')).resolves.toMatchObject({kind:'html'})
  expect(fetcher).toHaveBeenCalledTimes(2)
 }finally{vi.useRealTimers()}
})

it('evicts least-recently-used entries within count and byte bounds',async()=>{
 const cache=new EmailHtmlCache(async input=>response(`<p>${String(input)}</p>`))
 for(let index=0;index<EMAIL_HTML_CACHE_MAX_ENTRIES+2;index++)await cache.load(`message-${index}`)
 expect(cache.stats()).toMatchObject({entries:EMAIL_HTML_CACHE_MAX_ENTRIES})
 expect(cache.get('message-0')).toBeUndefined()
 expect(cache.stats().htmlBytes).toBeLessThanOrEqual(EMAIL_HTML_CACHE_MAX_BYTES)

 const byteCache=new EmailHtmlCache(async()=>response(`<p>${'x'.repeat(256*1024)}</p>`))
 for(let index=0;index<18;index++)await byteCache.load(`large-${index}`)
 expect(byteCache.stats().entries).toBeLessThan(18)
 expect(byteCache.stats().htmlBytes).toBeLessThanOrEqual(EMAIL_HTML_CACHE_MAX_BYTES)
})
