import type { Pool } from 'pg'
import type { SessionStore } from './auth.js'
export async function migrate(pool:Pool) {
 const client=await pool.connect()
 try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(817331)')
  await client.query(`CREATE TABLE IF NOT EXISTS app_sessions (
   token_hash text PRIMARY KEY, identity text NOT NULL, expires_at timestamptz NOT NULL
  ); CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS calendar_mutations (id uuid PRIMARY KEY,payload_hash text NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS calendar_sync_state (
   id integer PRIMARY KEY CHECK(id=1), next_run timestamptz NOT NULL DEFAULT now(),
   last_attempt timestamptz, last_success timestamptz, error text, failures integer NOT NULL DEFAULT 0,
   snapshot jsonb NOT NULL DEFAULT '{"calendars":[]}', source_hash text
  ); INSERT INTO calendar_sync_state(id) VALUES(1) ON CONFLICT DO NOTHING;`)
  await client.query('COMMIT')
 } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
export function sessionStore(pool:Pool):SessionStore {
 return {
  async put(id,identity,expires) { await pool.query('INSERT INTO app_sessions VALUES($1,$2,$3) ON CONFLICT(token_hash) DO UPDATE SET identity=$2, expires_at=$3',[id,identity,new Date(expires)]) },
  async has(id,identity) { return (await pool.query('SELECT 1 FROM app_sessions WHERE token_hash=$1 AND identity=$2 AND expires_at>now()',[id,identity])).rowCount===1 },
  async remove(id) { await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[id]) },
 }
}
