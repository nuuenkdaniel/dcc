import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {requestTools} from '../../src/mcp/request-controller.js'
import {TOOLS,type ToolName} from '../../src/mcp/contracts.js'

test('production Python run_action accepts real controller schemas and rejects model mutation keys',()=>{
  const schemas=requestTools({allowedTools:Object.keys(TOOLS) as ToolName[]}).map(t=>({type:'function',function:{name:'mcp__dcc_task__'+t.name,parameters:t.inputSchema}}))
  const child=spawnSync('/usr/bin/python3',['-B','-c','import json,sys; import test_task_action_runtime as t; t.exercise_product_schemas(json.load(sys.stdin))'],{
    cwd:fileURLToPath(new URL('../../deploy/',import.meta.url)),input:JSON.stringify(schemas),encoding:'utf8',timeout:10000,
  })
  assert.equal(child.status,0,child.stderr)
})
