import { Client } from 'pg'
try { process.loadEnvFile('.env') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
try {
  await client.connect()
  const result = await client.query('SELECT current_database() AS database, current_user AS role, version() AS version')
  console.log(result.rows[0])
  await client.query('BEGIN')
  await client.query('CREATE TEMP TABLE connection_probe (value integer)')
  await client.query('INSERT INTO connection_probe VALUES (1)')
  const probe = await client.query('SELECT value FROM connection_probe')
  if (probe.rows[0]?.value !== 1) throw new Error('Read/write probe failed')
  await client.query('ROLLBACK')
  console.log('Authenticated connection and temporary read/write transaction passed; no application data changed.')
} catch {
  console.error('Database check failed. Check Docker health and backend/.env; credentials are not printed.')
  process.exitCode = 1
} finally { await client.end() }
