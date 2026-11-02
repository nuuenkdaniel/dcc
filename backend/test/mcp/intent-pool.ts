import type {Pool} from 'pg'
import {ServicePool} from './service-pool.js'

// Deterministic lock-wait/query-contract fake, NOT PostgreSQL/MVCC. Transactions
// take their snapshot only AFTER acquiring the advisory lock. Unlike ServicePool
// alone this models two intent adapters waiting on the same legacy lock.
export class IntentPool extends ServicePool {
  private tails=new Map<string,Promise<void>>()
  insertCount=0
  zeroInsertAt?:number
  override get pool(){return this as unknown as Pool}
  override async connect(){
    const client=await super.connect()
    const unlocks:(()=>void)[]=[],held=new Set<string>()
    let begun=false
    const releaseLock=()=>{for(const unlock of unlocks.splice(0))unlock();held.clear()}
    return {query:async(sql:string,args:unknown[]=[])=>{
      if(sql==='BEGIN'){begun=true;return {rows:[],rowCount:0}}
      if(sql.startsWith('SELECT pg_advisory_xact_lock')){
        if(!begun)throw Error('Lock order violation')
        const key=sql+JSON.stringify(args),prior=this.tails.get(key)??Promise.resolve()
        if(held.has(key))throw Error('Repeated fake lock')
        let resolve!:()=>void
        const latch=new Promise<void>(r=>{resolve=r})
        this.tails.set(key,latch)
        await prior
        if(unlocks.length===0)await client.query('BEGIN')
        unlocks.push(resolve);held.add(key)
        return client.query(sql,args)
      }
      if(sql.startsWith('INSERT INTO planner_entities')){
        this.insertCount++
        if(this.insertCount===this.zeroInsertAt)return {rows:[],rowCount:0}
      }
      const result=await client.query(sql,args)
      if(sql==='COMMIT'||sql==='ROLLBACK')releaseLock()
      return result
    },release:()=>{releaseLock();client.release()}}
  }
}
