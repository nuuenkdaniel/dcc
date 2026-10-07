import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildApp} from '../src/app.js'
import {validatePriceResult} from '../src/prices.js'
test('price data and settings require authentication',async()=>{const app=buildApp({auth:{username:'test',password:'test-only',origin:'https://daymark.invalid',store:{async put(){},async has(){return false},async remove(){}}},plannerPool:{query(){throw Error('Unauthenticated request reached database')}} as unknown as import('pg').Pool});try{for(const url of ['/api/v1/prices/snapshot'])assert.equal((await app.inject(url)).statusCode,401);for(const url of ['/api/v1/prices/refresh','/api/v1/prices/settings'])assert.equal((await app.inject({method:'POST',url,headers:{origin:'https://daymark.invalid'},payload:{}})).statusCode,401)}finally{await app.close()}})
test('price connector validation accepts current new/open-box output and rejects unsafe links',()=>{
 const valid={store:'bestbuy',url:'https://www.bestbuy.com/product/example',status:'verified',detail:'Exact configuration verified.',offers:[{condition:'new',cents:299999,currency:'USD',eligible:true,availability:'Shipping listed',sku:'6686092'},{condition:'open-box',cents:240000,maxCents:270000,currency:'USD',eligible:false,availability:'Advertised range only',sku:'6686092'}]}
 assert.deepEqual(validatePriceResult('bestbuy',valid),valid)
 assert.throws(()=>validatePriceResult('bestbuy',{...valid,url:'javascript:alert(1)'}))
 assert.throws(()=>validatePriceResult('bestbuy',{...valid,url:'https://evil.invalid/product'}))
 assert.throws(()=>validatePriceResult('bestbuy',{...valid,offers:[{...valid.offers[1],maxCents:200000}]}))
})
test('price validation accepts each connector static output shape and bounds collections',()=>{
 const outputs=[
  ['bestbuy',{store:'bestbuy',url:'https://www.bestbuy.com/product/dell-xps-14-3k-oled-touchscreen-laptop-intel-core-ultra-x7-series-3-358h-2026-32gb-memory-1tb-storage-copilot-pc-graphite/J3K4L6Q675',status:'verified',detail:'Exact configuration verified.',offers:[{condition:'new',cents:279999,currency:'USD',eligible:true,availability:'Shipping listed',sku:'6686092'},{condition:'open-box',cents:269999,maxCents:279999,currency:'USD',eligible:false,availability:'Advertised range only.',sku:'6686092'}]}],
  ['dell',{store:'dell',url:'https://www.dell.com/en-us/shop/laptop-computers/spd/xps14da14260/da14260_reg_01',status:'verified',detail:'Selected configuration verified.',offers:[{condition:'new',cents:314999,currency:'USD',eligible:true,availability:'Shipping listed; confirm delivery. Free Shipping advertised.',sku:'da14260_reg_01'}]}],
  ['microcenter',{store:'microcenter',url:'https://www.microcenter.com/search/search_results.aspx?Ntt=Dell%20XPS%2014',status:'unmatched',detail:'No verified matching listing.',offers:[]}],
 ] as const
 for(const [store,output] of outputs)assert.deepEqual(validatePriceResult(store,output),output)
 const base=outputs[0][1]
 assert.throws(()=>validatePriceResult('bestbuy',{...base,url:'https://www.bestbuy.com/'+ 'x'.repeat(5000)}))
 assert.throws(()=>validatePriceResult('bestbuy',{...base,offers:Array.from({length:21},()=>base.offers[0])}))
})
