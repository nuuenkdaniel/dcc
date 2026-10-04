import {migratePrices} from './prices.js'
import {migrateMail} from './mail.js'
import {migratePlanner} from './planner.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import {Pool} from 'pg'
import {migrate,sessionStore} from './database.js'
import {readCalendarConfig} from './caldav.js'
import {sourceHash,runSync,fetchSnapshot} from './sync.js'
import {applyChange} from './calendar-write.js'

try { process.loadEnvFile('.env') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const config = loadConfig()
const pool=process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,max:5}):null
if(pool) {await migrate(pool);await migratePlanner(pool);await migrateMail(pool);await migratePrices(pool)}
const calendar=readCalendarConfig()
const username=process.env.DAYMARK_USERNAME,password=process.env.DAYMARK_PASSWORD,origin=process.env.APP_ORIGIN
if(origin && new URL(origin).origin!==origin) throw new Error('APP_ORIGIN must be an exact origin')
const auth=pool && username && password && origin ? {username,password,origin,store:sessionStore(pool)}:undefined
const app = buildApp({ ...(pool?{plannerPool:pool}:{}), logger: { level: config.logLevel }, ...(auth?{auth}:{}), ...(pool && calendar?{calendarRefresh:()=>runSync(pool,calendar.interval,sourceHash(calendar),()=>fetchSnapshot(calendar),true,30),calendarChange:(change)=>applyChange(pool,calendar,change),calendarSnapshot:async()=>{
 const row=(await pool.query('SELECT snapshot,last_success,error,source_hash FROM calendar_sync_state WHERE id=1')).rows[0]
 if(row.source_hash!==sourceHash(calendar)) return {calendars:[],events:[],lastSuccess:null,error:'Awaiting first sync'}
 return {...row.snapshot,lastSuccess:row.last_success,error:row.error}
}}:{}) })
app.addHook('onClose',async()=>{await pool?.end()})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(error => { app.log.error(error); process.exitCode = 1 })
  })
}
try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
