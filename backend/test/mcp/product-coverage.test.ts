import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PRODUCT_ROUTE_COVERAGE} from '../../src/mcp/product-coverage.js'
import {isActiveTool as isTool,TOOLS,ACTIVE_TOOLS} from '../../src/mcp/contracts.js'

test('every literal domain route has explicit typed coverage or a documented exclusion',async()=>{
  for(const file of ['app.ts','manual-tasks.ts','mail.ts','mail-paging.ts','prices.ts']){
    const source=await readFile(new URL('../../src/'+file,import.meta.url),'utf8')
    for(const match of source.matchAll(/['"](\/api\/v1\/[^'"\s]+)['"]/g)){
      const coverage=PRODUCT_ROUTE_COVERAGE[match[1]]
      assert.ok(coverage,`Unmapped product route ${match[1]} in ${file}`)
      assert.ok(coverage.boundary.length>20)
      assert.ok(coverage.tools.every(isTool))
    }
  }
})

test('Node product policy and Python runtime select the exact same complete catalog',async()=>{
  const source=await readFile(new URL('../../deploy/task_action_runtime.py',import.meta.url),'utf8')
  const constants=source.slice(source.indexOf('TOOLS ='),source.indexOf('def schema_snapshot'))
  const names=new Set([...constants.matchAll(/'([a-z_]+)'/g)].map(m=>m[1]))
  assert.deepEqual([...names].sort(),[...ACTIVE_TOOLS].sort())
})
