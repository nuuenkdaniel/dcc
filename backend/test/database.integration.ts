import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { migrate, sessionStore } from '../src/database.js'
process.loadEnvFile('.env')
test('migration is repeatable and sessions persist with expiry and revocation', async () => {
 const pool=new Pool({connectionString:process.env.DATABASE_URL})
 const id=randomBytes(32).toString('hex')
 try {
  await migrate(pool); await migrate(pool)
  const store=sessionStore(pool)
  await store.put(id,'test-identity',Date.now()+60000)
  assert.equal(await store.has(id,'test-identity'),true)
  assert.equal(await store.has(id,'wrong'),false)
  await store.put(id,'test-identity',Date.now()-1)
  assert.equal(await store.has(id,'test-identity'),false)
  await store.remove(id)
  assert.equal(await store.has(id,'test-identity'),false)
 } finally { await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[id]).catch(()=>{}); await pool.end() }
})
