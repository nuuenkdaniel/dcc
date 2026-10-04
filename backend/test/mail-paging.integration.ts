import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {migrateMail} from '../src/mail.js'
import {mailPageRoutes} from '../src/mail-paging.js'
process.loadEnvFile('.env')
test('mobile mail pagination, metadata-only results, body and search',async()=>{
 const root=new Pool({connectionString:process.env.DATABASE_URL});const schema='mail_page_test_'+randomUUID().replaceAll('-','');await root.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});const app=Fastify()
 try{
  await migrateMail(pool)
  await pool.query(`INSERT INTO mail_messages(id,account,data,override) SELECT lpad(n::text,64,'0'),'school',jsonb_build_object('id',lpad(n::text,64,'0'),'account','school','subject','Fixture '||n,'sender','fixture@example.test','body','Fixture body','receivedAt',to_char('2026-10-01'::timestamp+n*interval '1 minute','YYYY-MM-DD"T"HH24:MI:SS"Z"')),true FROM generate_series(1,205) n`)
  mailPageRoutes(app,pool)
  const ids:string[]=[];let cursor:string|null=null
  do{const r=await app.inject('/api/v1/mail/page'+(cursor?'?cursor='+encodeURIComponent(cursor):''));assert.equal(r.statusCode,200);const p=r.json();assert.equal(p.total,205);assert.ok(p.messages.length<=100);for(const m of p.messages){assert.equal('body' in m.data,false);ids.push(m.data.id)}cursor=p.nextCursor}while(cursor)
  assert.equal(ids.length,205);assert.equal(new Set(ids).size,205)
  const body=await app.inject('/api/v1/mail/message/'+ids[0]);assert.equal(body.json().body,'Fixture body')
  assert.equal((await app.inject('/api/v1/mail/page?q=Fixture%20205')).json().total,1)
  assert.equal((await app.inject('/api/v1/mail/page?account=work')).json().total,0)
  assert.equal((await app.inject('/api/v1/mail/page?cursor=bad')).statusCode,400)
 }finally{await app.close();await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end()}
})
