# DCC MCP product actions

The API composes the official SDK relay, durable intent store and service adapter.
Fresh web composer requests use `/api/v1/hermes/actions`. The fixed HTTPS callback
and bootstrapped Hermes launcher are described in [TASK-ACTIONS.md](TASK-ACTIONS.md).
This is implemented source wiring, not a claim of deployment or live acceptance.

## Exact active product catalog (35 tools)

- `request_clarification` (bounded typed questions, no effects)

- `list_tasks`, `create_task`, `update_task`, `set_task_completed`, `remove_task`
- `list_projects`, `create_project`, `create_assignment`, `update_project`,
  `set_project_status`, `archive_project`, `restore_project`
- `list_calendars`, `list_calendar_events`, `create_calendar_event`,
  `update_calendar_event`, `cancel_calendar_event`
- `get_operation_status`
- `list_daily_actions`, `create_daily_action`, `update_daily_action`
- `list_preparations`, `update_preparation`, `update_preparation_topic`
- `create_preparation`, `relink_preparation`, `insert_preparation_topic`,
  `remove_preparation_topic`
- `search_inbox`, `get_inbox_message`, `get_calendar_series`
- `get_focus_timer`, `control_focus_timer`, `edit_focus_queue`

Price tracking is retired, including UI, scheduling and provider activation.
`list_prices` metadata is retained solely for strict historical journal decoding;
it is not an advertised schema or an accepted new invocation. Old journals recover
nonprice receipts without a new model run; archived price reads are omitted.
Old authenticated price routes return HTTP410 without SQL, preserving stored rows.

All DCC inference and QA constructors share the source-owned adjacent
`backend/deploy/dcc_model_policy.py`: exact `gpt-6-luna`, no fallback. This is not
an OpenCode worker-model change. Installed provider acceptance is a parent gate.

Timer tools rendezvous with the authenticated originating browser tab through
`/api/v1/hermes/timer-bridge`. The request persists its tab binding; browser nonce
ACKs, not model assertions, establish effects. Local timer state and replay receipts
share one sessionStorage document; Web Locks exclude cloned-tab receivers. Backend
restarts/lost rendezvous remain uncertain, never auto-replay. See
[../../RELIABILITY.md](../../RELIABILITY.md) for pending acceptance and limits.

Node and Python select exact catalogs and check invocation-local schema stability.
No generic route, shell, SQL, HTTP, credential or provider-administration tool exists.
Actor identity, policy, creation IDs and mutation operation keys are backend-owned.
The read-only `get_operation_status` schema alone accepts an operation key. The task
account is shared; receipt actor binding is not multi-tenant data isolation.

Tasks use collection versions, retained unknown metadata and deletion tombstones.
Complete/reopen is `set_task_completed` with true/false. Weekly templates use flat
typed `recurrenceFrequency`, `recurrenceWeekday`, `recurrenceStartDate` and
`recurrencePaused` fields. Occurrences created using `templateId`/`sourceDate` have
deterministic `occ.<template>.<date>` IDs. Existing occurrence source metadata is
immutable; completion and skip/removal do not alter the parent template.

`list_projects` optionally selects one exact `id`. Assignments share project
storage. Removal maps to archive, never hard delete/cascade. Project mutations can
queue existing planning; schemas disclose that side effect. Resources and unknown
stored metadata survive patches.

Calendar MCP writes use a source-injected scoped guarded writer. Scope is required:
`single` never means an entire series; `series` is explicit. Recurring single edits
require the exact cached `recurrenceId`. UTC timed/all-day series creation accepts a
bounded RRULE grammar. Existing VTIMEZONE, UID, RDATE/EXDATE and exception components
are preserved unless an explicit typed list replacement/clear is requested;
conditional ETags gate provider changes. Recurring DATE↔DATE-TIME conversion rejects
before PUT. Existing exceptions retain their own DTSTART/DTEND zones independently
of the master recurrence identity. New named-zone creation uses `timezone` plus an
existing `timezoneSourceEventId` in the same calendar containing that VTIMEZONE;
the trusted definition is frozen in the writer reservation, never model-authored.
`rdates`/`exdates` replace complete lists (empty clears); timed entries are UTC
instants converted to the recurrence zone, all-day entries are dates.
`clearRecurrence` rejects existing exceptions unless `exceptionPolicy: discard`
explicitly authorizes removing their components. Saved receipts disclose
snapshot_pending rather than inventing refreshed event IDs. Ordinary browser and
Android calendar writer behavior is unchanged.

## Offline entrypoints

`cli.ts` remains isolated and unconfigured by default. Only explicit
`--synthetic-read`, `--synthetic-action-test`, `--synthetic-parser`,
`--synthetic-planner`, `--synthetic-extraction` flags use the in-memory fake.
These flags never activate production services. `demo.ts` is a finite demonstration,
not a stdio server. Synthetic contracts intentionally differ from service contracts.

## Read-only inference helpers

All bridge inference modes now use either product MCP or the separate official-SDK
stdio catalog `read_context`, `submit_proposal`. The latter reads only supplied
context and records one bounded proposal, not product effects. Backend validators
remain responsible for preview/extraction/parser/planning outcomes. Model final
text is discarded. Request-local temporary files are removed after MCP shutdown;
this is not a persistent credential/permission store. Deploy the adjacent
`read_context_runtime.py`, including when product-action flags are disabled.

## Coverage and remaining work

See [DEPLOYMENT.md](DEPLOYMENT.md) and the source inventory
`product-coverage.ts`. Preparation creation, event relinking and topic insertion/removal
now have typed operations in the existing receipt transaction, not generic entity
replacement. Creation includes one initial topic; insertion owns its topic identity;
removal preserves action history and cannot remove the last topic. Calendar linkage,
version CAS and planning requests share the existing lock/commit. Daily action and
preparation reads/field patches, cached inbox/prices and MCP preview/extraction
transport remain wired. Generated action dates cannot be
changed; action completion/reopen never completes its parent. No write capability
is added to inference helpers.

## Checks

The bounded web/native clarification/checklist/receipt contract is documented in
[CLARIFICATION-RECEIPTS.md](CLARIFICATION-RECEIPTS.md), including honest unsupported
scope, text expiry, compatibility and parent-only acceptance gates.

New cache reads have small explicit page limits: daily actions ten, inbox search
twenty-five, preparation/price pages one. Topic notes are 512-character slices with
nextNotesOffset; later slices require exact plan/topic IDs. Cached message offsets
count Unicode codepoints. Large UI read summaries explicitly disclose omissions;
write receipts remain authoritative independently of read-summary size.
All source pages are also bounded by the encoded duplicate MCP envelope, UTF-8,
escaping and a worst-case request-ID reservation within the unchanged 512 KiB relay
cap. Continuation advances only by returned rows; no row or field is truncated.
Production and installed product probes share catalog/schema validation. Helper
stdio uses the installed request-handler API, not unavailable tool decorators.
New regressions require parent execution; these source repairs are not acceptance
or deployment proof. Installed helper read→proposal, all 35-tool discovery, repaired
task/project readback, named-zone/recurrence and preparation journeys remain gates.

```sh
npm run check:backend
npm --prefix frontend run check
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_task_action_launcher.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_hermes_mcp_probe.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_read_context_runtime.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_product_mcp_probe.py'
git diff --check
```

Tests use synthetic SQL/provider/runtime seams. They do not prove PostgreSQL locking,
proxy logging/routing, installed Hermes behavior or actual calendar-provider writes.
