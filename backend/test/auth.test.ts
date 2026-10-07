import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'

test('unconfigured authentication fails closed', async () => {
 const app = buildApp()
 try {
  const r = await app.inject('/api/v1/auth/session')
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { authenticated: false, configured: false })
  const write = await app.inject({ method:'POST', url:'/api/v1/auth/login', payload:{username:'test',password:randomBytes(24).toString('hex')} })
  assert.equal(write.statusCode, 503)
 } finally { await app.close() }
})

test('buildApp protects future root API routes and keeps only exact public routes public',async()=>{
 const sessions=new Set<string>()
 const app=buildApp({auth:{username:'test',password:'test-only',origin:'https://daymark.invalid',store:{async put(id){sessions.add(id)},async has(id){return sessions.has(id)},async remove(id){sessions.delete(id)}}}})
 app.get('/api/v1/future-sensitive',async()=>({secret:true}))
 try {
   assert.equal((await app.inject('/api/v1/future-sensitive')).statusCode,401)
   assert.equal((await app.inject('/health')).statusCode,200)
   assert.equal((await app.inject('/api/v1/status')).statusCode,200)
   assert.equal((await app.inject('/api/v1/auth/session')).statusCode,200)
   assert.equal((await app.inject('/api/v1/status/extra')).statusCode,401)
   assert.equal((await app.inject('/api/v1/auth/session-extra')).statusCode,401)
   assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{origin:'https://daymark.invalid'}})).statusCode,200)
   const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://daymark.invalid'},payload:{username:'test',password:'test-only'}})
   assert.equal(login.statusCode,200)
   const cookie=login.cookies.find(item=>item.name==='daymark_session')
   assert.ok(cookie)
   assert.equal((await app.inject({url:'/api/v1/future-sensitive',cookies:{daymark_session:cookie.value}})).statusCode,200)
 } finally {await app.close()}
})
