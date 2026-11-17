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

test('chat retries only a bounded explicit pre-launch busy rejection',async()=>{
  const environment=process.env,fetcher=globalThis.fetch
  process.env={HERMES_CURATOR_URL:'https://synthetic.invalid/curate',HERMES_CURATOR_TOKEN:'synthetic-only'}
  const input={mode:'product-action',chatVersion:1}
  const bodies:unknown[]=[]
  try{
    globalThis.fetch=async(_url,options)=>{
      bodies.push(JSON.parse(String(options?.body)))
      return bodies.length===1?Response.json({error:'Curator busy'},{status:429}):Response.json({status:'finished'})
    }
    assert.deepEqual(await callCurator(input,{waitForActionSlot:true,timeoutMs:2000}),{status:'finished'})
    assert.deepEqual(bodies,[input,input])
    for(const [status,error] of [[502,'Curator busy'],[429,'Unknown rate limit']] as const){
      let attempts=0
      globalThis.fetch=async()=>{attempts++;return Response.json({error},{status})}
      await assert.rejects(callCurator(input,{waitForActionSlot:true}),/unavailable/)
      assert.equal(attempts,1)
    }
  }finally{globalThis.fetch=fetcher;process.env=environment}
})
