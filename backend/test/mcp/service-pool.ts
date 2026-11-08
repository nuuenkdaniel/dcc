// Query-contract fake, not PostgreSQL: no SQL parser, MVCC or advisory-lock proof.
import type {Pool} from 'pg'
export type Row={id:string;kind:string;version:number;data:Record<string,any>}
export class ServicePool {
  rows=new Map<string,Row>()
  statements:{sql:string;args:unknown[]}[]=[]
  requested=false
  fail:'receipt-update'|'entity-update'|'planning'|'commit-before'|'commit-after'|undefined
  zero:'entity-update'|'receipt-update'|'planning'|'insert'|undefined
  connections=0
  seed(row:Row){this.rows.set(row.id,structuredClone(row))}
  get pool(){return this as unknown as Pool}
  async query(sql:string,args:unknown[]=[]){const c=await this.connect();try{return await c.query(sql,args)}finally{c.release()}}
  async connect(){
    this.connections++
    let tx:Map<string,Row>|undefined,requested=this.requested
    const query=async(sql:string,args:unknown[]=[])=>{
      this.statements.push({sql,args:structuredClone(args)})
      const result=(rows:unknown[]=[],rowCount=rows.length)=>({rows,rowCount})
      if(sql==='BEGIN'){tx=structuredClone(this.rows);requested=this.requested;return result()}
      if(sql==='ROLLBACK'){tx=undefined;return result()}
      if(sql==='COMMIT'){
        if(this.fail==='commit-before'){this.fail=undefined;throw Error('private commit-before detail')}
        if(tx){this.rows=tx;this.requested=requested;tx=undefined}
        if(this.fail==='commit-after'){this.fail=undefined;throw Error('private commit-after detail')}
        return result()
      }
      if(sql.startsWith('SELECT pg_advisory_xact_lock'))return result([{}])
      const store=tx??this.rows
      if(sql.startsWith("UPDATE planner_entities SET data=(data-'original'")){
        let changed=0
        for(const row of store.values())if(row.kind===args[0]&&(args[1]===''||row.data.owner===args[1])&&row.data.expiresAt<=Number(args[2])&&['original','assistantReply','replyUnavailable'].some(k=>Object.hasOwn(row.data,k))){
          for(const k of ['original','prompt','guard','question','context','assistantReply','replyUnavailable'])delete row.data[k]
          row.data.answers=[];row.data.status='closed';row.version++;changed++
          if(row.data.receipt.outcome==='question'){row.data.receipt.outcome='failed';row.data.receipt.line='Clarification expired after 24 hours. Start a new request; nothing was resent.'}
        }
        return result([],changed)
      }
      if(sql.startsWith('SELECT id,kind,version,data FROM planner_entities WHERE id=$1')){
        const row=store.get(String(args[0]));return result(row?[structuredClone(row)]:[])
      }
      if(sql.startsWith("SELECT id,kind,version,data FROM planner_entities WHERE kind='project'")){
        return result([...store.values()].filter(row=>row.kind==='project').sort((a,b)=>a.id.localeCompare(b.id)).slice(Number(args[1]),Number(args[1])+Number(args[0])).map(row=>structuredClone(row)))
      }
      if(sql.startsWith('INSERT INTO planner_entities(id,kind,data)')){
        if(this.zero==='insert'){this.zero=undefined;return result()}
        const [id,kind,data]=args
        if(store.has(String(id))){
          if(!sql.includes('ON CONFLICT(id) DO UPDATE SET data=$3'))return result()
          const row=store.get(String(id))!;if(row.kind!==kind)throw Error('Wrong upsert kind')
          if(sql.includes('IS DISTINCT FROM')&&JSON.stringify(row.data)===JSON.stringify(data))return result()
          row.data=structuredClone(data) as Record<string,any>;row.version++;return result([{version:row.version}])
        }
        store.set(String(id),{id:String(id),kind:String(kind),version:1,data:structuredClone(data) as Record<string,any>})
        return result([{version:1}])
      }
      if(sql.startsWith('UPDATE planner_entities SET data=$2,version=version+1')){
        const [id,data,kind,version]=args,isReceipt=kind==='dcc-mcp-operation-v1'
        const point=isReceipt?'receipt-update':'entity-update'
        if(this.fail===point){this.fail=undefined;throw Error('private query detail')}
        if(this.zero===point){this.zero=undefined;return result()}
        const row=store.get(String(id))
        if(!row||row.kind!==kind||row.version!==version)return result()
        row.data=structuredClone(data) as Record<string,any>;row.version++
        return result([{version:row.version}])
      }
      if(sql==='UPDATE planner_runs SET requested=true,next_attempt=now() WHERE id=1'){
        if(this.fail==='planning'){this.fail=undefined;throw Error('private planning detail')}
        if(this.zero==='planning'){this.zero=undefined;return result()}
        if(tx)requested=true;else this.requested=true
        return result([],1)
      }
      throw Error(`Unrecognized synthetic query: ${sql}`)
    }
    return {query,release:()=>{this.connections--}}
  }
}
