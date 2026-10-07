import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Pool} from 'pg'
import {migratePrices,checkPrices} from '../src/prices.js'
process.loadEnvFile('.env')
test('price failure retains history; pause and six-hour schedule suppress checks',async()=>{
 const schema='price_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.DATABASE_URL})
 await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 const original=globalThis.fetch;let calls=0,fail=false
 globalThis.fetch=async()=>{calls++;if(fail)throw Error('Test failure');return new Response(JSON.stringify({store:'bestbuy',url:'https://www.bestbuy.com/product/test-fixture',status:'verified',detail:'Test only',offers:[{condition:'new',cents:279999,currency:'USD',eligible:true,availability:'Fixture shipping availability'}]}),{status:200})}
 try{
  await migratePrices(pool);await pool.query("UPDATE price_sources SET next_run=now()+interval '1 day' WHERE store<>'bestbuy'")
  await checkPrices(pool);assert.equal(calls,1);await checkPrices(pool);assert.equal(calls,1)
  const before=(await pool.query("SELECT last_good FROM price_sources WHERE store='bestbuy'")).rows[0].last_good
  fail=true;await pool.query("UPDATE price_sources SET next_run=now() WHERE store='bestbuy'");await checkPrices(pool)
  const after=(await pool.query("SELECT last_good,status FROM price_sources WHERE store='bestbuy'")).rows[0];assert.deepEqual(after.last_good,before);assert.equal(after.status,'failed');assert.equal((await pool.query('SELECT count(*)::int n FROM price_observations')).rows[0].n,1)
  await pool.query('UPDATE price_items SET paused=true');await pool.query('UPDATE price_sources SET next_run=now()');await checkPrices(pool);assert.equal(calls,2)
 }finally{globalThis.fetch=original;await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
