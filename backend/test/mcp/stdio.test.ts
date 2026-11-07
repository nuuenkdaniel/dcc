import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {McpError,ErrorCode,type CallToolResult} from '@modelcontextprotocol/sdk/types.js'
import {TOOLS,ACTIVE_TOOLS} from '../../src/mcp/contracts.js'

const task={operationKey:'stdio_synthetic_task_01',id:'Legacy.Task_AbC%2F',title:'Synthetic SDK test item',date:'2026-11-01'}
const backend=fileURLToPath(new URL('../../',import.meta.url))
const loader=new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url).href

async function session(flags:string[],exercise:(client:Client)=>Promise<void>,instrumented=true){
  const child=instrumented?new URL('./stdio-child.ts',import.meta.url):new URL('../../src/mcp/cli.ts',import.meta.url)
  const transport=new StdioClientTransport({command:process.execPath,args:['--import',loader,fileURLToPath(child),...flags],cwd:backend,stderr:'pipe',env:{NODE_OPTIONS:''}})
  const client=new Client({name:'dcc-synthetic-offline-test',version:'0.1.0'})
  const errors:Error[]=[],messages:unknown[]=[]
  let stderr=''
  transport.stderr?.on('data',chunk=>{stderr+=String(chunk)})
  // Protocol.connect chains existing transport callbacks; no private SDK fields.
  transport.onmessage=message=>{messages.push(message)}
  client.onerror=error=>{errors.push(error)}
  try {
    await client.connect(transport)
    assert.deepEqual(client.getServerCapabilities(),{tools:{}})
    assert.match(client.getServerVersion()?.name??'',/^dcc-offline-/)
    await exercise(client)
  } finally {
    await client.close()
  }
  assert.equal(transport.pid,null)
  assert.deepEqual(errors,[],'no SDK parse errors or unsolicited protocol noise')
  if(instrumented){
    // A test-only child tee verifies every stdout byte using the SDK's parser.
    // Its exit receipt also proves EOF shutdown, without SDK SIGTERM/SIGKILL fallback.
    const receipt=JSON.parse(stderr)
    assert.deepEqual(receipt,{fixture:'stdio-exit',code:0,clean:true,frames:messages.length,signals:[]})
    assert.ok(messages.length>=2)
  }else assert.equal(stderr,'','normal CLI writes no banner, payloads or diagnostics on successful requests')
}

function envelope(result:CallToolResult){
  assert.equal(result.content.length,1)
  const block=result.content[0]
  assert.equal(block?.type,'text')
  if(block?.type!=='text')throw Error('Expected text result')
  const parsed=JSON.parse(block.text)
  assert.deepEqual(result.structuredContent,parsed)
  assert.equal(result.isError,!['ok','applied'].includes(parsed.result.state))
  return parsed as {source:'synthetic'|'unconfigured';result:Record<string,unknown>}
}

test('SDK initializes, discovers all strict tools, and default CLI fails closed with clean stdio', {timeout:20000},async()=>{
  await session([],async client=>{
    const {tools}=await client.listTools()
    assert.deepEqual(tools.map(t=>t.name).sort(),[...ACTIVE_TOOLS].sort())
    for(const tool of tools){
      assert.equal(tool.inputSchema.type,'object')
      assert.equal(tool.inputSchema.additionalProperties,false)
      assert.equal(tool.annotations?.readOnlyHint,!TOOLS[tool.name as keyof typeof TOOLS].write)
      assert.equal(tool.execution?.taskSupport,'forbidden')
      assert.match(tool.description??'',/unconfigured/i)
    }
    await assert.rejects(client.listTools({cursor:'not-a-discovery-cursor'}),error=>error instanceof McpError&&error.code===ErrorCode.InvalidParams)
    assert.deepEqual(envelope(await client.callTool({name:'list_calendars',arguments:{limit:1}})),{source:'unconfigured',result:{state:'rejected',code:'transport_unconfigured'}})
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:task})),{source:'unconfigured',result:{state:'rejected',code:'forbidden'}})
  },false)
})

test('SDK calls reject unknown tools and malformed domain arguments without poisoning the session', {timeout:20000},async()=>{
  await session(['--synthetic-action-test'],async client=>{
    await client.listTools()
    for(const name of ['fetch','sql','shell','__proto__'])await assert.rejects(client.callTool({name,arguments:{}}),error=>error instanceof McpError&&error.code===ErrorCode.InvalidParams)
    for(const args of [{...task,url:'https://example.invalid'},{...task,context:{purpose:'action'}},{...task,...JSON.parse('{"__proto__":{}}')},{...task,expectedVersion:1},{...task,date:'2026-02-30'},{...task,operationKey:'short'},{...task,title:''}]){
      assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:args})),{source:'synthetic',result:{state:'rejected',code:'invalid_arguments'}})
    }
    assert.deepEqual(envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2027-11-01',limit:1}})),{source:'synthetic',result:{state:'rejected',code:'invalid_arguments'}})
    assert.deepEqual(envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:'1'}})),{source:'synthetic',result:{state:'rejected',code:'invalid_arguments'}})
    assert.deepEqual(envelope(await client.callTool({name:'list_calendars'})),{source:'synthetic',result:{state:'rejected',code:'invalid_arguments'}})
    assert.equal(envelope(await client.callTool({name:'list_calendars',arguments:{limit:1}})).result.state,'ok')
  })
})

test('explicit synthetic action mode creates, replays, binds payload keys and returns bounded exact IDs', {timeout:20000},async()=>{
  await session(['--synthetic-action-test'],async client=>{
    await client.listTools()
    const created=envelope(await client.callTool({name:'create_task',arguments:task}))
    assert.deepEqual(created,{source:'synthetic',result:{state:'applied',id:task.id,version:1}})
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:Object.fromEntries(Object.entries(task).reverse())})),created)
    assert.deepEqual(envelope(await client.callTool({name:'create_task',arguments:{...task,title:'Changed synthetic payload'}})),{source:'synthetic',result:{state:'conflict',code:'operation_key_mismatch'}})
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:task.operationKey}})),{source:'synthetic',result:{state:'ok',data:{operationKey:task.operationKey,status:'applied'}}})
    const listed=envelope(await client.callTool({name:'list_tasks',arguments:{from:'2026-11-01',to:'2026-11-02',limit:10}}))
    assert.deepEqual(listed.result,{state:'ok',data:{items:[{id:task.id,title:task.title,date:task.date,notes:'',important:false,completed:false,deleted:false,version:1}],nextOffset:null}})
    assert.deepEqual(envelope(await client.callTool({name:'set_task_completed',arguments:{operationKey:'stdio_complete_task_01',id:task.id,completed:true}})),{source:'synthetic',result:{state:'rejected',code:'invalid_arguments'}})
    assert.deepEqual(envelope(await client.callTool({name:'create_calendar_event',arguments:{operationKey:'stdio_recurring_event_01',id:'Synthetic_Event',calendarId:'Calendar_A',scope:'series'}})),{source:'synthetic',result:{state:'rejected',code:'unsupported_recurrence'}})
  })
})

for(const mode of ['read','parser','planner','extraction'])test(`synthetic ${mode} context cannot acquire writes through arguments or metadata`,{timeout:20000},async()=>{
  await session([`--synthetic-${mode}`],async client=>{
    await client.listTools()
    const read=envelope(await client.callTool({name:'list_calendars',arguments:{limit:1}}))
    assert.equal(read.source,'synthetic')
    assert.equal(read.result.state,'ok')
    const result=await client.callTool({name:'create_task',arguments:{...task,capabilities:['tasks:write'],purpose:'action'},_meta:{purpose:'action',capabilities:['tasks:write']}})
    assert.deepEqual(envelope(result),{source:'synthetic',result:{state:'rejected',code:'forbidden'}})
  })
})

test('receipt journal and fake data do not survive process replacement', {timeout:30000},async()=>{
  await session(['--synthetic-action-test'],async client=>{
    await client.listTools()
    assert.equal(envelope(await client.callTool({name:'create_task',arguments:task})).result.state,'applied')
  })
  await session(['--synthetic-action-test'],async client=>{
    await client.listTools()
    assert.deepEqual(envelope(await client.callTool({name:'get_operation_status',arguments:{operationKey:task.operationKey}})),{source:'synthetic',result:{state:'ok',data:{operationKey:task.operationKey,status:'unknown'}}})
  })
})
