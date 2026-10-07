import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

test('health responds without database or integrations', async () => {
  const app = buildApp()
  try {
    const response = await app.inject({ method: 'GET', url: '/health' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { status: 'ok', service: 'daymark-backend' })
  } finally { await app.close() }
})
test('capabilities explicitly report unavailable services', async () => {
  const app = buildApp()
  try {
    const response = await app.inject('/api/v1/status')
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().apiVersion, 'v1')
    assert.ok(Object.values(response.json().capabilities).every(value => value === false))
    assert.equal((await app.inject('/api/v1/daily-plan')).statusCode, 401)
  } finally { await app.close() }
})
test('configuration defaults and validation', () => {
  assert.deepEqual(loadConfig({}), { host: '127.0.0.1', port: 3001, logLevel: 'info' })
  assert.throws(() => loadConfig({ PORT: 'invalid' }))
  assert.throws(() => loadConfig({ PORT: '0' }))
  assert.throws(() => loadConfig({ LOG_LEVEL: 'anything' }))
})
