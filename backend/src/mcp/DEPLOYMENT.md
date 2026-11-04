# Product action source and deployment boundaries

## Live composition

`server.ts` constructs one `TaskActions` instance when the existing backend flag is
exactly `DCC_TASK_ACTIONS_ENABLED=1`. It injects the existing Pool, account actor,
curator bridge, cache snapshot and scoped guarded calendar writer when configured.
The bridge flag remains exactly `DAYMARK_TASK_ACTIONS_ENABLED=1`. No additional
listener, persistent credential, tunnel or distributed capability service is added.

The new `/api/v1/hermes/actions` route selects the 32-tool `product-v1` catalog.
`/api/v1/hermes/task-actions` retains its original three-tool policy. The callback
URL is unchanged. The bridge distinguishes `product-action` from `task-action` and
passes a fixed catalog selector privately to the adjacent runtime via stdin.
Browser/model fields cannot select actor, capabilities, catalog or callback URL.

All model final text is discarded. Intent receipts establish effects; sanitized
backend read projections can be displayed separately. UI refreshes affected task,
project or calendar domains only. Saved calendar results remain snapshot_pending.

## Durable execution and compatibility

SqlIntentStore retains the legacy receipt lock seed 817343 and atomically inserts
the MCP intent and legacy sentinel. One committed owner can start a runtime. Each
typed RPC ID is owner-hashed, payload-bound and reserved before service execution.
No connection is held during model work. Writes and local service receipts commit
atomically. Missing receipts never mean nonexecution or permission to restart.

Policy/catalog changes do not upgrade stored intents. Started/completed older
product catalogs reconcile receipts under their frozen policies, never restarting
with the new catalog. Old web storage without mode
is legacy; unresolved legacy/task submissions remain pinned. Fresh requests and
edits after settled receipts use the unified action route. Compatibility endpoints
remain available for Android/older browsers; they are not silently rerouted.

Deploy the API, bridge/runtime and frontend as a compatible set. An older bridge
does not implement product-action. The official launcher and adjacent runtime must
be present together. The previous task flags stay compatible but now also gate the
product route; enabling is not proof of calendar/provider health. One API process
must receive callbacks; process replacement loses capabilities and fails closed.
Deploy adjacent `read_context_runtime.py` too: all inference helpers now require
this official-SDK supplied-context boundary, independently of product-action flags.

## Route inventory

`product-coverage.ts` enumerates every current domain route. A source regression
checks app/manual-task/mail/paging/price route literals against this inventory.

| Domain | MCP mapping / boundary |
| --- | --- |
| Standalone checklist | list/create/edit/complete/reopen/tombstone removal; weekly template create/edit/pause/resume; deterministic occurrence create, complete/reopen/skip/removal |
| Projects/assignments | list/exact-id lookup/create/update/status/archive/restore; natural remove means archive; no hard delete or cascade |
| Calendar | bounded calendar/event cache reads; guarded create/update/cancel; explicit single/series scope and bounded RRULE creation/update |
| Planner generated/manual-project actions | Bounded reads, manual-project creation, versioned fields/completion/dismissal/feedback; generated dates/source/parent immutable |
| Study preparations/resources | Bounded plan/topic reads, creation with initial topic, versioned patches/event relinking/topic insertion/removal in the existing receipt transaction; history retained |
| Inbox | Cached summary search and Unicode-codepoint body pagination; no provider/HTML/attachment/configuration tools |
| Prices | Cached bounded item/offer summaries without URLs; configuration/integration scheduling stay UI-only |
| Local focus timer/device preferences | Device-local UI behavior, not server product tools |
| Auth/config/integrations/system administration | Explicitly excluded; never a generic dispatcher escape hatch |

## Hermes callsite inventory

- **Migrated:** fresh default `TellHermes` composer → actions → request-scoped SDK
  relay → product runtime. No manual Create/Task selector or keyword routing.
- **Compatibility only:** `/hermes/commands` → `tellHermes` parser remains for pinned
  legacy receipts/old clients. `/hermes/task-actions` retains the three-tool executor.
- **MCP supplied-context migrated at the common bridge:** Projects Ask Hermes
  `previewCustomProjectTasks`, study `extract`, legacy `tell-hermes` parsing,
  `runPlanner`, `planAssignments` and `mail-classify` invoke only read_context and
  submit_proposal. Existing host validators/persistence remain the sole executor;
  previews remain no-write. No product grant reaches these inference helpers.
- **No inference:** selected `session` reads excerpts; material decoding reads
  supplied uploads. Neither needs an inference loop or product capability.
- **Connector dispatch, not inference:** mail-sync/html/attachment and price-check
  retain their existing read-only integration boundaries, with no product tools.

All bridge inference paths now use either product MCP or supplied-context MCP.
This is source wiring, not installed-runtime acceptance. The catalog does not
establish full product coverage or live storage correctness by itself.

The supplied-context server now registers `tools/list` and `tools/call` through
the installed SDK `add_request_handler` API with typed params/results; it does not
depend on unavailable `list_tools`/`call_tool` decorators. The API-shaped offline
test is not proof of installed stdio interoperability: parent must run the real
helper read→submit journey with the official bootstrap before activation.

## Recurrence limits requiring further iteration

New series use UTC instants or all-day dates. Named-zone creation additionally
selects a cached same-calendar source event containing the requested VTIMEZONE;
the trusted definition is frozen in the prepared writer ledger for retries. Missing
definitions reject; arbitrary model-authored timezone components are never accepted.
Existing TZID-based resources retain VTIMEZONE and selected exception DTSTART/DTEND
zones independently; local DST guesses and recurring date-type conversions reject.
Typed RDATE/EXDATE lists replace complete lists with matching dates/UTC instants.
Explicit recurrence clearing rejects existing exceptions by default; only explicit
exceptionPolicy=discard removes them. get_calendar_series
now supplies authoritative master details, timezone/rules/selectors and a live ETag
without the resource URL. Existing RDATE/EXDATE values survive.
Expanded first occurrences without a recurrence-id freeze their selected source
start in the immutable payload, so single edits cannot silently mutate a master.
Single-occurrence membership expansion is bounded to 10,000 source occurrences.
Unsupported/ambiguous cases reject before PUT, never fall back to series mutation.

Task/project and other page adapters budget the actual duplicated MCP envelope,
UTF-8/JSON escaping and a worst-case encoded request ID within the existing 512 KiB
HTTP relay cap. Pages can return fewer rows than requested; nextOffset advances by
returned rows only. The relay preserves UTF-8 instead of expanding Unicode escapes.

Completion proof, exact serialized payload hash, provider markers and conditional
requests share the existing immutable ledger. An ambiguous dispatch stays uncertain.
Receipt reconciliation never issues a new write or starts another model. Cancellation
revokes callbacks but is not rollback and need not immediately kill remote children.

## Verification

Run the commands in README.md plus the focused source regressions:

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/task-actions.test.ts backend/test/mcp/product-recurrence.test.ts backend/test/mcp/product-coverage.test.ts backend/test/mcp/product-operations.test.ts
```

Installed Hermes synthetic acceptance must exercise the product runtime's exact
catalog and stable schemas, not only the older three-tool offline probe. Provider
and PostgreSQL verification require isolated synthetic resources. Metadata preflight
validates only the official launcher shape/executable, not model/provider execution.

`backend/deploy/product_mcp_probe.py` supports discovery-only by default and explicit
synthetic-model phases `tasks-projects`, `calendar`, `cached-reads`. Each invocation
selects the exact 32-tool service catalog and verifies schema stability and observed
SDK receipts, never model prose. Product inference permits eight native iterations,
but the existing twelve-call/four-write/90-second budgets still apply. Larger natural
requests can remain incomplete; no arbitrary multi-action fulfillment is asserted.

The probe fixture is `backend/test/mcp/product-stdio-fixture.ts`, using only fake SQL,
synthetic calendar resources and cache rows. It never imports API startup or falls
through to real providers. The fixture is intentionally outside production builds.
Supply a reviewed argv JSON, for example with an existing reviewed SSH destination:

```sh
/usr/bin/python3 /REVIEWED_DEPLOY/task_action_launcher.py --product-probe --fixture-argv-json '["/usr/bin/ssh","-T","REVIEWED_HOST","/usr/bin/node","--import","/REVIEWED_REPO/backend/node_modules/tsx/dist/loader.mjs","/REVIEWED_REPO/backend/test/mcp/product-stdio-fixture.ts"]' --phase cached-reads
```

After discovery, explicit `--run-synthetic-model` runs the selected synthetic phase.
The probe shares the production schema validator, including the sole read-status
operationKey exception. A typed revision_mismatch is recoverable only after a fresh
authoritative read and matching successful retry; final completed task/project
readback is still mandatory. Malformed/unauthorized/unrecovered results fail.
Failures expose only bounded stage/code/tool diagnostics, never supplied text,
arguments, receipts, environment values or raw provider exceptions. Do not blind-retry
model journeys to hide a failure; repair the diagnosed stage first.
The fixed launcher probe mode bootstraps Hermes before loading the adjacent
product_mcp_probe.py; plain system Python runs only the stdlib launcher. These
placeholder paths are not executable deployment instructions. Calendar acceptance
requires a saved/snapshot_pending service receipt; synthetic provider behavior still
does not prove live PostgreSQL or CalDAV semantics. Keep the legacy three-tool probe
as compatibility coverage, not evidence of complete-catalog acceptance.
