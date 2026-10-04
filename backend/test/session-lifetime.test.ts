import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import Fastify from 'fastify'
import {registerAuth,SESSION_SECONDS} from '../src/auth.js'
test('login cookie and server expiry use thirty days',async()=>{
 const app=Fastify();const password=randomBytes(24).toString('hex');let expiry=0
 await registerAuth(app,{username:'test',password,origin:'https://example.test',store:{put:async(_id,_identity,expires)=>{expiry=expires},has:async()=>true,remove:async()=>{}}})
 try{const before=Date.now();const r=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://example.test'},payload:{username:'test',password}})
 assert.equal(r.statusCode,200);assert.equal(SESSION_SECONDS,30*24*60*60);assert.match(String(r.headers['set-cookie']),new RegExp(`Max-Age=${SESSION_SECONDS}`));assert.ok(expiry>=before+SESSION_SECONDS*1000&&expiry<=Date.now()+SESSION_SECONDS*1000)
 }finally{await app.close()}
})
