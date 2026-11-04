import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {ServicePool} from './service-pool.js'
import {ServiceTransport,COLLECTION} from '../../src/mcp/service-transport.js'
import {validServiceResult,serviceToolDefinitions} from '../../src/mcp/service-contracts.js'
import {RELAY_RESPONSE_BYTES} from '../../src/mcp/wire-budget.js'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {composeSdkServer} from '../../src/mcp/sdk-server.js'
import {Dispatcher} from '../../src/mcp/dispatcher.js'
import type {Result} from '../../src/mcp/contracts.js'

test('max escaped/multibyte task and project pages continue losslessly through SDK and production relay',async t=>{
  const pool=new ServicePool(),service=new ServiceTransport({pool:pool.pool,actorId:'synthetic-wire'})
  const dispatcher=new Dispatcher(service),client=new Client({name:'synthetic-wire',version:'1'})
  const server=composeSdkServer({name:'synthetic-wire',instructions:'Synthetic only',source:'dcc-service',tools:()=>serviceToolDefinitions().filter(t=>['list_tasks','list_projects'].includes(t.name)),dispatch:(tool,args)=>dispatcher.dispatch(tool,args,{purpose:'read',capabilities:['tasks:read','projects:read']})})
  const [clientWire,serverWire]=InMemoryTransport.createLinkedPair()
  t.after(async()=>{await client.close();await server.close()})
  await server.connect(serverWire);await client.connect(clientWire)
  const notes='\\"漢\n'.repeat(1000),frames:unknown[]=[]
  pool.seed({id:COLLECTION,kind:'manual-tasks',version:1,data:{tasks:Array.from({length:100},(_,i)=>({id:'task_'+String(i).padStart(3,'0'),title:'Task',date:'2026-11-02',notes,completed:false}))}})
  for(let i=0;i<100;i++){
    const id=`${String(i).padStart(8,'0')}-1234-4234-a234-123456789abc`
    pool.seed({id,kind:'project',version:1,data:{id,title:'Project',description:notes.repeat(3),progress:notes,deadline:'',category:'personal',importance:2,remainingMinutes:0,status:'active'}})
  }
  for(const tool of ['list_tasks','list_projects'] as const){
    const ids:string[]=[];let offset:number|null=0,pages=0
    do{
      const command={tool,args:{limit:100,offset,...(tool==='list_tasks'?{from:'2026-11-01',to:'2026-11-03'}:{})}}
      const reply=await client.callTool({name:tool,arguments:command.args})
      const result=reply.structuredContent?.result as Result
      assert.equal(result.state,'ok');assert.ok(validServiceResult(command,result))
      if(result.state!=='ok')throw Error('Read failed')
      const data=result.data as {items:{id:string}[];nextOffset:number|null}
      assert.ok(data.items.length>0);ids.push(...data.items.map(i=>i.id))
      const frame={jsonrpc:'2.0',id:'x'.repeat(60000),result:reply}
      assert.ok(Buffer.byteLength(JSON.stringify(frame))<=RELAY_RESPONSE_BYTES)
      frames.push(frame);offset=data.nextOffset;pages++
    }while(offset!==null)
    assert.equal(ids.length,100);assert.equal(new Set(ids).size,100);assert.ok(pages>1)
  }
  // No network: exercise the unchanged production Python relay with fake HTTP.
  const code=`import io,json,sys,types\nfrom unittest.mock import patch\nimport task_action_runtime as r\nfor frame in json.load(sys.stdin):\n body=json.dumps(frame,ensure_ascii=False,separators=(',',':')).encode()\n response=types.SimpleNamespace(status=200,read=io.BytesIO(body).read)\n connection=types.SimpleNamespace(request=lambda *a,**k:None,getresponse=lambda:response,close=lambda:None)\n output=io.StringIO()\n with patch.object(r.time,'time',return_value=1000):\n  r.relay('a'*64,1120000,io.StringIO(json.dumps({'jsonrpc':'2.0','id':frame['id'],'method':'tools/call'})+'\\n'),output,lambda:connection)\n assert json.loads(output.getvalue())==frame\n`
  const child=spawnSync('/usr/bin/python3',['-B','-c',code],{cwd:fileURLToPath(new URL('../../deploy/',import.meta.url)),input:JSON.stringify(frames),encoding:'utf8',timeout:20000})
  assert.equal(child.status,0,child.stderr)
})
