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
