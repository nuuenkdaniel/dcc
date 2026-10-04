import {Pool} from 'pg'
import {setTimeout as wait} from 'node:timers/promises'
import {migrateMail,syncMail,classifyMail} from './mail.js'
process.loadEnvFile('.env')
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3}),controller=new AbortController()
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort())
try{await migrateMail(pool);do{try{await syncMail(pool);await classifyMail(pool)}catch{console.error('Email processing failed; cached messages retained')};if(process.argv.includes('--once'))break;await wait(30000,undefined,{signal:controller.signal}).catch(()=>{})}while(!controller.signal.aborted)}finally{await pool.end()}
