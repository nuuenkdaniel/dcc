import type {Server} from '@modelcontextprotocol/sdk/server/index.js'
import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import {TOOLS,type ToolName} from './contracts.js'
import {Dispatcher,type Context} from './dispatcher.js'
import {FakeTransport} from './fake-transport.js'
import {inputSchema} from './schemas.js'
import {composeSdkServer} from './sdk-server.js'

export const MODES=['unconfigured','synthetic-read','synthetic-action-test','synthetic-parser','synthetic-planner','synthetic-extraction'] as const
export type Mode=typeof MODES[number]
const reads=['tasks:read','projects:read','calendars:read','operations:read'] as const
const writes=['tasks:write','projects:write','calendars:write'] as const
const descriptions:Record<ToolName,string>={
  list_calendars:'List bounded calendar summaries; never calendar URLs or credentials.',
  list_calendar_events:'List one calendar within a <=31 day UTC interval (exclusive end), bounded page.',
  list_tasks:'List dated checklist tasks including tombstones, within a <=93 day date interval (exclusive end). Not calendar events.',
  list_projects:'List bounded project/assignment summaries, including archived records.',
  get_operation_status:'Read an operation receipt. Unknown is not proof of nonexecution. Receipts are process-local.',
  create_task:'Create one independent dated checklist item with an exact ID and stable operation key. Never complete its parent.',
  update_task:'Patch task title/date/notes/importance with an explicit expected version and stable operation key.',
  set_task_completed:'Set checklist completion only, with expected version and stable operation key. No parent propagation.',
  remove_task:'Soft-remove a task by retaining a tombstone. Requires expected version and stable operation key.',
  create_project:'Create one project without generating or executing actions. Requires exact ID and stable operation key.',
  create_assignment:'Create one assignment with a deadline, without generating actions. Requires exact ID and stable operation key.',
  update_project:'Patch project/assignment title/description/deadline with expected version and stable operation key.',
  set_project_status:'Set project status active/complete explicitly, without completing child tasks. Requires version and operation key.',
  archive_project:'Archive, never delete, a project/assignment with expected version and stable operation key.',
  restore_project:'Restore an archived project/assignment, preserving status. Requires expected version and stable operation key.',
  create_calendar_event:'Create one nonrecurring calendar event, distinct from a checklist task. Requires exact ID, operation key, explicit single scope and <=31 day interval.',
  update_calendar_event:'Edit one nonrecurring event with explicit single scope, strong expected ETag, operation key and full <=31 day interval. Recurring sources reject.',
  cancel_calendar_event:'Cancel one nonrecurring event with explicit single scope, strong expected ETag and operation key. Recurring sources reject.',
  list_daily_actions:'Bounded daily planner actions; service composition only.',
  create_daily_action:'Create a manual project action; never a generated action. Service composition only.',
  update_daily_action:'Versioned daily action patch, preserving parent/source identity. Service composition only.',
  list_preparations:'Bounded preparation plans; service composition only.',
  update_preparation:'Versioned preparation fields; service composition only.',
  update_preparation_topic:'Versioned existing preparation topic patch; service composition only.',
  create_preparation:'Create a linked preparation with one initial topic; service composition only.',
  relink_preparation:'Relink a preparation to an existing cached event, retaining topics/history; service composition only.',
  insert_preparation_topic:'Insert one topic with a backend-owned identity; service composition only.',
  remove_preparation_topic:'Remove one topic without deleting action history; at least one topic must remain. Service composition only.',
  search_inbox:'Bounded cached inbox search, no provider access. Service composition only.',
  get_inbox_message:'Bounded cached plain-text body slice. Service composition only.',
  list_prices:'Bounded cached price summaries without URLs. Service composition only.',
  get_calendar_series:'Guarded authoritative series details. Service composition only.',
}

// A trusted process launch selects context; no tool argument, _meta field, client
// identity or initialize capability can select it or enable a production transport.
export function createMcpServer(mode:Mode='unconfigured'):Server {
  if(!MODES.includes(mode))throw Error('Unsupported offline mode')
  const source=mode==='unconfigured'?'unconfigured':'synthetic'
  const dispatcher=mode==='unconfigured'?new Dispatcher():new Dispatcher(new FakeTransport())
  const purpose:Context['purpose']=mode==='synthetic-action-test'?'action':mode==='synthetic-parser'?'parser':mode==='synthetic-planner'?'planner':mode==='synthetic-extraction'?'extraction':'read'
  const context:Context={purpose,capabilities:purpose==='action'?[...reads,...writes]:[...reads]}
  const tools:Tool[]=(Object.keys(TOOLS) as ToolName[]).map(name=>({
    name,description:`${source==='synthetic'?'SYNTHETIC ONLY':'UNCONFIGURED'}. ${descriptions[name]}`,
    inputSchema:inputSchema(name),execution:{taskSupport:'forbidden'},
    annotations:{readOnlyHint:!TOOLS[name].write,destructiveHint:TOOLS[name].write,openWorldHint:false},
  }))
  return composeSdkServer({
    name:`dcc-offline-${source}`,source,
    instructions:source==='synthetic'?'SYNTHETIC OFFLINE FIXTURE ONLY. No real DCC data, authentication or integration. Receipts and data disappear on exit. Never use as a second executor for parser/planner output.':'UNCONFIGURED OFFLINE FOUNDATION. No backend transport or real data. All writes denied. Reads fail closed. Tool availability is not authorization.',
    tools:()=>tools,dispatch:(tool,args)=>dispatcher.dispatch(tool,args,context),
  })
}
