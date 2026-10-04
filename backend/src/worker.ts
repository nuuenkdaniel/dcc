import {migratePrices,checkPrices} from './prices.js'
import {rollover} from './rollover.js'
import {planAssignments} from './assignment-plan.js'
import {migratePlanner,runPlanner} from './planner.js'
import {Pool} from 'pg'
import {setTimeout as wait} from 'node:timers/promises'
import {migrate} from './database.js'
import {readCalendarConfig} from './caldav.js'
import {runSync,fetchSnapshot,sourceHash} from './sync.js'
try {process.loadEnvFile('.env')} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
const config=readCalendarConfig()

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required')
const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,max:3})
const controller=new AbortController()
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort())
try {
 await migrate(pool)
 await migratePlanner(pool)
 await migratePrices(pool)
 do {
  try {if(config)console.log('Calendar sync:',await runSync(pool,config.interval,sourceHash(config),()=>fetchSnapshot(config),process.argv.includes('--once')))}
  catch {console.error('Calendar worker database failure; retrying without discarding cache')}
  await checkPrices(pool).catch(()=>console.error('Price checks unavailable'))
  await rollover(pool).catch(()=>console.error('Rollover unavailable; existing work preserved'))
  if(process.env.HERMES_CURATOR_URL)await planAssignments(pool).catch(()=>console.error('Assignment planner unavailable'))
  if(process.env.HERMES_CURATOR_URL)console.log('Daily planner:',await runPlanner(pool))
  if(process.argv.includes('--once'))break
  await wait(30000,undefined,{signal:controller.signal}).catch(()=>{})
 } while(!controller.signal.aborted)
} finally {await pool.end()}
