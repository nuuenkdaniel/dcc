// Standalone synthetic-only installed-runtime fixture. No application imports,
// environment loader, real Pool, listener or provider fallback is permitted.
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'
import {TOOLS,ACTIVE_TOOLS,plainRecord,type ToolName} from '../../src/mcp/contracts.js'
import {SqlIntentStore} from '../../src/mcp/intent-store.js'
import {RequestController} from '../../src/mcp/request-controller.js'
import {ServiceTransport} from '../../src/mcp/service-transport.js'
import {createScopedCalendarWriter} from '../../src/calendar-write.js'
import {ProductPool} from './product-pool.js'
import {config} from './calendar-harness.js'

const pool=new ProductPool(),actorId='synthetic-product-probe'
const controller=new RequestController({store:new SqlIntentStore(pool.pool,actorId),
  transport:new ServiceTransport({pool:pool.pool,actorId,calendarSnapshot:async()=>pool.snapshot,guardedCalendarWriter:createScopedCalendarWriter(pool.pool,config,pool.fetch)}),
  nativeRunner:async run=>{
    const inner=new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:65536})
    let resolve!:()=>void
    const done=new Promise<void>(r=>{resolve=r})
    let messages=0
    const wire:Transport={start:async()=>{
      inner.onmessage=message=>{
        if(++messages>64||run.signal.aborted){void wire.close();return}
        if('method' in message&&message.method==='tools/call'&&'id' in message&&plainRecord(message.params))message.params={...message.params,_meta:{hostCallId:run.correlate(message.id)}}
        wire.onmessage?.(message)
      }
      inner.onclose=()=>{wire.onclose?.();resolve()}
      await inner.start()
    },send:message=>inner.send(message),close:async()=>{await inner.close();resolve()}}
    const stop=()=>{void wire.close()}
    process.stdin.once('end',stop);run.signal.addEventListener('abort',stop,{once:true})
    try{await run.server.connect(wire);await done}finally{process.stdin.off('end',stop);run.signal.removeEventListener('abort',stop);await wire.close()}
  }})
try{
  const summary=await controller.run({key:'synthetic_product_probe_01',prompt:'Isolated synthetic product probe'}, {executor:'mcp-action-v1',allowedTools:ACTIVE_TOOLS})
  process.stderr.write(JSON.stringify({status:'synthetic_fixture_closed',phase:summary.phase,writes:summary.effects.length,syntheticProviderPuts:pool.puts})+'\n')
}catch{process.stderr.write('Synthetic product fixture unavailable.\n');process.exitCode=1}
