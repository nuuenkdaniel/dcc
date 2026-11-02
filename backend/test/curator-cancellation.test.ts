import {test} from 'node:test'
import assert from 'node:assert/strict'
import {callCurator} from '../src/planner.js'

test('curator default behavior remains JSON/no redirects; explicit deadline and cancellation reach fetch',async()=>{
  const environment=process.env,fetcher=globalThis.fetch
  process.env={HERMES_CURATOR_URL:'https://synthetic.invalid/curate',HERMES_CURATOR_TOKEN:'synthetic-only'}
  try{
    let signal:AbortSignal|undefined
    globalThis.fetch=async(_url,init)=>{
      assert.equal(init?.redirect,'error');signal=init?.signal as AbortSignal
      return new Response('{"status":"finished"}')
    }
    assert.deepEqual(await callCurator({mode:'synthetic'}),{status:'finished'})
    assert.equal(signal?.aborted,false)
    await callCurator({mode:'synthetic'},{timeoutMs:5})
    await new Promise(resolve=>setTimeout(resolve,15))
    assert.equal(signal?.aborted,true)
    const abort=new AbortController();let entered!:()=>void
    const ready=new Promise<void>(resolve=>{entered=resolve})
    globalThis.fetch=async(_url,init)=>new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener('abort',()=>reject(Error('synthetic abort')),{once:true});entered()
    })
    const pending=callCurator({mode:'task-action'},{signal:abort.signal,timeoutMs:105000})
    await ready;abort.abort()
    await assert.rejects(pending,/synthetic abort/)
    await assert.rejects(callCurator({},{timeoutMs:150001}),/Invalid curator timeout/)
  }finally{globalThis.fetch=fetcher;process.env=environment}
})
