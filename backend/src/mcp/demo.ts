// A finite stdout-only domain demonstration, NOT an MCP stdio server.
// No stdin commands, credentials, environment loading or runtime imports.
import {Dispatcher,type Context} from './dispatcher.js'
import {FakeTransport} from './fake-transport.js'

const dispatcher=new Dispatcher(new FakeTransport())
const context:Context={purpose:'action',capabilities:['tasks:write','tasks:read','operations:read']}
const task={operationKey:'offline_demo_task_01',id:'Synthetic.Task_A',title:'Synthetic offline checklist item',date:'2026-11-01'}
for(const [label,result] of [
  ['default-deny',await dispatcher.dispatch('create_task',task)],
  ['parser-deny',await dispatcher.dispatch('create_task',task,{...context,purpose:'parser'})],
  ['create',await dispatcher.dispatch('create_task',task,context)],
  ['same-key-retry',await dispatcher.dispatch('create_task',task,context)],
  ['changed-payload',await dispatcher.dispatch('create_task',{...task,title:'Different synthetic item'},context)],
  ['operation',await dispatcher.dispatch('get_operation_status',{operationKey:task.operationKey},context)],
  ['list',await dispatcher.dispatch('list_tasks',{from:'2026-11-01',to:'2026-11-02',limit:10},context)],
] as const)console.log(JSON.stringify({label,result}))
