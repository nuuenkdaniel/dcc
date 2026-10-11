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
test('configuration defaults to the isolated development port', () => {
  assert.deepEqual(loadConfig({}), { host: '127.0.0.1', port: 5301, logLevel: 'info' })
})
test('configuration supports explicit PORT overrides', () => {
  for (const port of [3001, 5302, 65535]) {
    assert.equal(loadConfig({ PORT: String(port) }).port, port)
  }
})
test('configuration validates port and log level', () => {
  assert.throws(() => loadConfig({ PORT: 'invalid' }))
  assert.throws(() => loadConfig({ PORT: '0' }))
  assert.throws(() => loadConfig({ PORT: '65536' }))
  assert.throws(() => loadConfig({ PORT: '5301.5' }))
  assert.throws(() => loadConfig({ LOG_LEVEL: 'anything' }))
})
