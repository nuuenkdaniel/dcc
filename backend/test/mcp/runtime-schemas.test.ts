import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {requestTools} from '../../src/mcp/request-controller.js'
import {TOOLS,ACTIVE_TOOLS,type ToolName} from '../../src/mcp/contracts.js'
import {serviceToolDefinitions} from '../../src/mcp/service-contracts.js'

test('actual product catalog explains exact daily action ID without changing fields, permissions or allowlist',()=>{
  const allowedTools=[...ACTIVE_TOOLS],names=[...allowedTools].sort()
  const tools=requestTools({allowedTools}),daily=tools.find(t=>t.name==='list_daily_actions')!
  assert.equal(tools.length,35);assert.deepEqual(tools.map(t=>t.name).sort(),names)
  assert.equal(names.includes('list_prices'),false)
  assert.match(daily.description??'',/exact ACTION ID, never a parent\/project ID/)
  const schemaDescription=daily.inputSchema.description
  assert.ok(typeof schemaDescription==='string');assert.match(schemaDescription,/omit id and match returned projectId/)
  const id=daily.inputSchema.properties?.id as {type?:string;description?:string}
  assert.equal(id.type,'string');assert.match(id.description??'',/NOT its parent\/project ID/)
  assert.deepEqual(Object.keys(daily.inputSchema.properties??{}).sort(),['from','id','limit','offset','to'])
  assert.deepEqual([...(daily.inputSchema.required??[])].sort(),['from','limit','to'])
  assert.equal(daily.inputSchema.additionalProperties,false)
  assert.equal(daily.annotations?.readOnlyHint,true);assert.equal(TOOLS.list_daily_actions.capability,'planner:read')
  const original=structuredClone(daily)
  daily.description='tampered';id.description='tampered';daily.inputSchema.description='tampered'
  assert.deepEqual(requestTools({allowedTools}).find(t=>t.name==='list_daily_actions'),original)
  assert.deepEqual(serviceToolDefinitions().find(t=>t.name==='list_daily_actions'),original)
  assert.deepEqual(allowedTools.sort(),names)
  assert.deepEqual(requestTools({allowedTools:['list_tasks','create_task','set_task_completed']}).map(t=>t.name).sort(),['create_task','list_tasks','set_task_completed'])
})

test('production Python run_action accepts real controller schemas and rejects model mutation keys',()=>{
  const schemas=requestTools({allowedTools:ACTIVE_TOOLS}).map(t=>({type:'function',function:{name:'mcp__dcc_task__'+t.name,parameters:t.inputSchema}}))
  const child=spawnSync('/usr/bin/python3',['-B','-c','import json,sys; import test_task_action_runtime as t; t.exercise_product_schemas(json.load(sys.stdin))'],{
    cwd:fileURLToPath(new URL('../../deploy/',import.meta.url)),input:JSON.stringify(schemas),encoding:'utf8',timeout:10000,
  })
  assert.equal(child.status,0,child.stderr)
})
