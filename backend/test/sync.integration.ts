import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {migrate} from '../src/database.js'
import {runSync} from '../src/sync.js'
process.loadEnvFile('.env')
test('worker lock prevents overlap and a failed fetch preserves snapshot',async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL})
 const lock=await pool.connect()
 try {
  await migrate(pool)
  await lock.query('SELECT pg_advisory_lock(817332)')
  let called=false
  assert.equal(await runSync(pool,600,'test-source',async()=>{called=true;return {calendars:[],events:[]}},true),'busy')
  assert.equal(called,false)
  await lock.query('SELECT pg_advisory_unlock(817332)')
  const before=(await pool.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0].snapshot
  assert.equal(await runSync(pool,600,'test-source',async()=>{throw new Error('fixture failure')},true),'failed')
  assert.deepEqual((await pool.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0].snapshot,before)
 } finally {await lock.query('SELECT pg_advisory_unlock_all()');lock.release();await pool.end()}
})
