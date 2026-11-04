import type {ToolName} from './contracts.js'

type Coverage={tools:readonly ToolName[];boundary:string}
// Explicit product-route inventory, not routing or authorization. Empty tool lists
// are exclusions/remaining work, never permission to use a generic route executor.
export const PRODUCT_ROUTE_COVERAGE:Record<string,Coverage>={
  '/api/v1/hermes/actions':{tools:[],boundary:'Unified authenticated action admission; server-owned catalog only.'},
  '/api/v1/hermes/task-actions':{tools:[],boundary:'Compatibility admission with the original three-tool policy.'},
  '/api/v1/hermes/commands':{tools:[],boundary:'Legacy receipt executor retained for old callers and pinned submissions.'},
  '/api/v1/hermes/capabilities':{tools:[],boundary:'Authenticated configuration discovery, not an action tool.'},
  '/api/v1/hermes/action-capabilities':{tools:[],boundary:'Product action discovery; the original task discovery response shape stays unchanged.'},
  '/api/v1/hermes/mcp-task-callback':{tools:[],boundary:'Exact capability-authenticated relay, not a generic tool.'},
  '/api/v1/planner/manual-tasks':{tools:['list_tasks','create_task','update_task','set_task_completed','remove_task'],boundary:'Versioned collection; weekly templates and immutable occurrence sources; no whole-collection overwrite tool.'},
  '/api/v1/planner/snapshot':{tools:['list_projects','list_daily_actions','list_preparations'],boundary:'Bounded projects, daily actions and preparation projections; no internal journals.'},
  '/api/v1/planner/entity':{tools:['create_project','create_assignment','update_project','set_project_status','archive_project','restore_project','create_daily_action','update_daily_action','create_preparation','relink_preparation','insert_preparation_topic','remove_preparation_topic','update_preparation','update_preparation_topic'],boundary:'Versioned receipt-atomic patches preserve parent/source metadata and preparation topic history. Project remove is archive. Preparation creation links a cached event; relinking and topic insertion/removal are explicit typed operations.'},
  '/api/v1/planner/refresh':{tools:[],boundary:'Existing read-context planning remains separate; no model-selected rescheduling/worker trigger tool.'},
  '/api/v1/planner/custom-project-preview':{tools:[],boundary:'Supplied project context via read_context/submit_proposal MCP; host validates suggestions; no action grant.'},
  '/api/v1/planner/extract':{tools:[],boundary:'Supplied study material via read_context/submit_proposal MCP; host validates the outline before review.'},
  '/api/v1/planner/material':{tools:[],boundary:'Explicit uploaded material decoding, not model-selected filesystem access.'},
  '/api/v1/planner/session':{tools:[],boundary:'Explicit read-only session excerpt selection; not arbitrary model session access.'},
  '/api/v1/calendar/snapshot':{tools:['list_calendars','list_calendar_events','get_calendar_series'],boundary:'Cache occurrences plus guarded authoritative master details/ETag; no resource URL or credentials.'},
  '/api/v1/calendar/changes':{tools:['create_calendar_event','update_calendar_event','cancel_calendar_event'],boundary:'MCP uses the explicit scoped guarded writer; ordinary browser/Android writer defaults are preserved.'},
  '/api/v1/calendar/refresh':{tools:[],boundary:'Receipt-driven calendar UI refresh; not an arbitrary model integration trigger.'},
  '/api/v1/mail/snapshot':{tools:['search_inbox'],boundary:'Bounded cached inbox summaries only; no account configuration.'},
  '/api/v1/mail/page':{tools:['search_inbox'],boundary:'Bounded account/query/importance filters; no raw mailbox tool.'},
  '/api/v1/mail/message/:id':{tools:['get_inbox_message'],boundary:'Cached plain-text body with Unicode-codepoint pagination; no provider/HTML/attachment access.'},
  '/api/v1/mail/html/:id':{tools:[],boundary:'Sanitized UI HTML viewing only; no model HTML/network executor.'},
  '/api/v1/mail/attachment/:id/:part':{tools:[],boundary:'Explicit UI attachment download only; not model file access.'},
  '/api/v1/mail/refresh':{tools:[],boundary:'Mailbox integration scheduling excluded from action catalog.'},
  '/api/v1/mail/preferences':{tools:[],boundary:'Classification preferences/configuration excluded.'},
  '/api/v1/mail/feedback':{tools:[],boundary:'Local classification feedback remains UI-only; mail/provider mutations excluded.'},
  '/api/v1/prices/snapshot':{tools:['list_prices'],boundary:'Bounded cached items/offers/source summaries; URLs and integration configuration excluded.'},
  '/api/v1/prices/settings':{tools:[],boundary:'Tracker configuration remains UI-only.'},
  '/api/v1/prices/refresh':{tools:[],boundary:'External browser integration scheduling excluded.'},
  '/api/v1/status':{tools:[],boundary:'Public service status, not model authority.'},
}
