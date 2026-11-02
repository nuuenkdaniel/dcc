# SDK-backed MCP: offline CLI and injected DCC service composition

This directory is isolated from the application runtime. The stdio entrypoint uses
official `@modelcontextprotocol/sdk` **1.32.2** for initialization, framing, requests,
responses and transport lifecycle. It exposes `tools/list` and `tools/call` over the
strict domain dispatcher. The CLI is an offline prototype, not a certification
claim or authenticated execution service. Separate injected service transport and
SDK composition are available below, but no production runtime launcher, auth
gateway, HTTP endpoint or startup environment loader is provided.

From the repository root, using existing dependencies only:

```sh
npm --prefix backend run test:mcp
npm --prefix backend run test:mcp:stdio
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/production-server.test.ts
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/request-intent.test.ts
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/intent-store.test.ts backend/test/mcp/request-controller.test.ts
npm --prefix backend run demo:mcp
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run build
npm run check:backend
git diff --check
```

`demo:mcp` remains a finite synthetic domain demonstration, **not** the MCP server.
After building, `node backend/dist/mcp/demo.js` runs that demonstration.

## MCP launch and synthetic opt-in

An MCP client should launch the compiled server directly (no npm stdout banners):

```sh
node backend/dist/mcp/cli.js
```

Without flags, discovery and initialization work, but **there is no transport**:
reads return `transport_unconfigured` and writes return `forbidden`. No fake data
is silently substituted. For a source launch from the backend directory, use
`node --import tsx src/mcp/cli.ts`. For manual use from the root, npm must be silent:

```sh
npm --silent --prefix backend run mcp:stdio
npm --silent --prefix backend run mcp:stdio -- --synthetic-read
npm --silent --prefix backend run mcp:stdio -- --synthetic-action-test
```

Only one exact synthetic flag may be supplied. `--synthetic-read` uses in-memory
fake reads and denies writes. `--synthetic-action-test` is the **only** launch mode
that grants fake action/write capabilities. `--synthetic-parser`,
`--synthetic-planner`, and `--synthetic-extraction` are read-only synthetic contexts
for safety testing. None can connect to a real backend. Launch flags are a trusted
operator/test choice, not model arguments, client initialization capabilities,
client names or `_meta`. There is no production/action flag or environment switch.

Synthetic mode is named in initialization instructions, server identity, tool
descriptions, and every result. Tool results contain identical text JSON and
`structuredContent` envelopes: `{source: 'synthetic' | 'unconfigured', result: ...}`.
Rejected, conflict and uncertain results set MCP `isError: true`; uncertain must
never be interpreted as a successful write. Unknown tools produce a sanitized
SDK InvalidParams error. Neither output path returns raw backend exceptions.

The server uses the SDK's low-level `Server` deliberately so shared JSON schemas
can be published directly, without a new direct validation dependency. Schemas
derive allowlists, required fields, scalar types, enums, bounds, formats, nonempty
patches and all-day/timed shapes from the domain rules. `additionalProperties` is
false. The dispatcher is authoritative at call time: positive date ordering,
cross-field window limits, source recurrence, capabilities and current revisions
cannot all be represented by standard JSON Schema. Text bounds are measured in
UTF-16 code units by the domain validator (JSON Schema measures Unicode code
points, so astral text may be rejected more strictly at dispatch). No argument
coercion, default injection or unknown-key stripping is performed by this layer.
The call schema preserves the argument object through the SDK envelope parser,
including an own `__proto__` key, so unknown fields cannot disappear before domain
validation. IDs, operation keys and ETags reject trailing line terminators.

`test:mcp:stdio` uses the official SDK `Client` and `StdioClientTransport` to spawn
synthetic/local child processes, initialize, list, call and close. A test-only
child wrapper tees stdout and validates every emitted line with the SDK parser;
its stderr exit receipt verifies clean EOF shutdown without signal fallback. The
normal CLI has no such receipt or banners. Successful normal operation leaves
stderr empty; transport/startup errors use fixed messages only. Input buffers are
bounded to 64 KiB. Do not launch the old domain demo as an MCP server.

## Contract

`Dispatcher.dispatch(tool, arguments, context)` accepts only the 18 names in
`TOOLS`. All arguments are flat, strictly allowlisted scalar records. There is no
route, SQL, shell, URL, profile or credential field. Unknown fields, coercions,
inherited fields and accessors are rejected. IDs are preserved exactly (no case
folding, decoding, UUID conversion or trimming) within the documented validator's
200-character opaque identifier alphabet. IDs are never interpreted as URLs.

Required capabilities are defined per tool in `TOOLS`: `tasks:read/write`,
`projects:read/write`, `calendars:read/write`, and `operations:read`. Context is a
**trusted caller input**, never part of model-produced arguments. Reads require
the matching read capability. Writes additionally require `purpose: 'action'`;
parser, planner, extraction, read and absent contexts cannot dispatch writes,
even with write capabilities. This seam is not authentication or a capability
issuer, and must never be wired to caller-asserted model context in production.

- Lists require `limit` (1–100), allow `offset` (0–10,000), and return `nextOffset`.
  Tombstones, archived projects and cancelled events remain visible. Fake pages
  sort by exact ID; they are not snapshot-isolated under edits between pages.
- Task reads require inclusive `from`/exclusive `to` dates, at most 93 days apart.
  Event reads require a calendar ID and exclusive-end UTC instant interval of at
  most 31 days. Dates are real Gregorian dates in 2000–2100. Instants use exact
  second-resolution `YYYY-MM-DDTHH:mm:ssZ`; offsets and fractional seconds reject.
- Creates require caller-supplied exact IDs and a stable `operationKey` (16–80
  ASCII alphanumeric/underscore/hyphen characters, starting alphanumeric).
  Edits require a positive safe-integer `expectedVersion`, or a strong quoted
  `expectedEtag` for events. No wildcard or weak ETags. Task/project updates are
  nonempty allowlisted patches; separate tools own lifecycle changes.
- Tasks are dated checklist items, not calendar events or generated actions.
  Task creation defaults to incomplete, important=false, deleted=false and empty
  notes. An optional project link does not propagate completion. Removal writes
  a tombstone; no physical deletion or resurrection tool exists.
- Project/assignment creation never generates tasks. Assignment deadline is
  required. Projects use active/complete status plus an independent archived flag;
  restore preserves status. This is an offline contract, **not a claimed mapping**
  to existing planner entity storage or collection versions.
- Event create/update requires title, full start/end interval and allDay. Optional
  description/location are preserved on update when omitted. All-day end dates
  are exclusive. Every mutation requires `scope: 'single'`; recurrence fields or
  another/missing scope reject explicitly. Existing recurring source events must
  also reject, even if the caller asserts single scope. No recurring task or event
  mutation is supported. Fake event seeds require strong `"fake-N"` ETags.

## Safety and real-transport gates

`new Dispatcher()` has no transport and fails closed. The stdio CLI only enables
`FakeTransport`, using synthetic in-memory objects, with explicit synthetic flags.
The separately injected service transport below is **not wired into the CLI**.
Injection is a source-level seam, not an arbitrary endpoint selector. Response objects are validated
against strict projections; backend error details and extra fields never pass
through. Text fields in this prototype are synthetic domain content, not a
redaction guarantee for future real personal data.

Results are `ok` (bounded reads), `applied` (ID + revision), `rejected`, `conflict`,
or `uncertain`. A thrown/malformed write reply becomes uncertain, not failed or
safe to resubmit under a new key. The dispatcher reserves keys before awaiting
transport, binds each to tool + canonical payload, caches terminal results, rejects
changed-payload reuse, and never redispatches an uncertain same-key retry. Status
reports the local receipt; unknown means **unknown**, never proof of nonexecution.
Unknown local keys may be queried through the injected transport. A full ledger
fails closed without eviction (256 keys by default, configurable up to 4096).
It holds no raw request payloads, only hashes and validated result receipts.

These synthetic guarantees are **one Dispatcher instance, one process lifetime only**.
Restarting, replacing the dispatcher or changing operation keys can duplicate
effects. There is no persistent journal, timeout/cancellation, automatic retry,
reconciliation, actor isolation or real authorization. A hanging transport keeps
its key reserved; concurrent retry/status is uncertain. Do not use this as an
exactly-once system or as a second executor for parser/planner output.

A real transport must independently provide authenticated actor/capability
binding, authoritative version/ETag checks at mutation time, preservation of
offline/conflict/tombstone metadata, durable actor-scoped key/payload binding and
operation status/reconciliation, bounded safe projections, and atomic source
recurrence detection. It must map the distinct task/project/event contracts to
actual backend semantics without silently overwriting collections or propagating
task completion. Fake tests prove none of those backend/provider guarantees.

## Injected DCC service transport (not activated)

`ServiceTransport({pool, actorId, calendarSnapshot?, calendarWriter?})` is a separate
service contract, selected by its source-level `contract: 'dcc-service-v1'` marker.
It creates no pool, starts no services, loads no environment, and is not reachable
from any CLI flag or application route. Injection accepts the existing `Pool`, a
cache-only snapshot function returning `Snapshot`, and an optional function bound
to the existing `applyChange` writer. There is no URL or credential configuration.
`serviceToolDefinitions()` publishes its distinct schemas and side-effect warnings.
`createServiceMcpServer` composes those definitions with injected trusted context
and a short-lived, exact-action invocation as an **optional prebound mode**. It is
not a requirement to manually approve every in-app action payload. The pure
`request-intent.ts` seam instead models authenticated-request admission, immutable
executor selection and first-use operation binding for natural tool planning.
Neither is wired to the live command route. See [DEPLOYMENT.md](./DEPLOYMENT.md)
for the minimal in-app integration recommendation and native-runtime gate; no
separate SSH/broker/grant-store subsystem is required. Do not pair service dispatch
with synthetic schemas.

`SqlIntentStore` adds injected SQL durability and backend execution ownership using
the existing legacy lock/receipt slot plus an intent row. `RequestController` adds
host-controlled runner rounds and official SDK in-memory service calls, cancellation
fencing, receipt-only recovery and safe backend-result summaries. Its `ModelRunner`
is an in-process test port, not a Hermes CLI adapter. No runtime route or bridge is
activated. See DEPLOYMENT.md for concurrency-fake limits and outstanding live gates.
Its result envelope is `{source:'dcc-service', result:...}`. It never substitutes
fake data or creates/configures a backend itself; source tests inject fake pools
and providers explicitly. Production composition is not production authentication.

`actorId` is an immutable trusted caller binding, not a tool argument. Receipts are
actor-scoped; **the existing DCC task/project/calendar data is shared, not actor-
isolated**. This is not an authenticator, authorization gateway, credential issuer
or production launch mechanism. Dispatcher purpose/capability gates still run
before any transport call; parser/planner/extraction contexts cannot write.
The service repeats the gate on `execute(command, trustedContext)` for direct
source-level use; omitting that separate context denies even with an injected pool.

### Storage semantics

- Standalone tasks use the existing `manual-tasks` collection UUID and advisory
  transaction lock **817342**. Both `expectedVersion` and every task's projected
  `version` mean the **whole collection version**, not an entity revision. Create
  requires an explicit current collection version (zero when absent); edits
  require the current positive version. Task pages also return `collectionVersion`,
  including empty pages, so callers do not have to guess the create precondition.
  Same-value edits at the current revision
  can return that unchanged revision. Stale submissions reject even for no-ops.
  Existing collection fields, other tasks, unknown task metadata and tombstones
  survive patching. Recurring records are readable with `recurring: true` but
  cannot be mutated. Removal sets `deleted:true`, never physically deletes.
- Production task IDs must match existing manual task storage (1–100 ASCII
  letters/digits/underscore/dot/hyphen). Unsupported opaque IDs reject; nothing
  trims, decodes or rewrites them. `projectId` rejects explicitly: standalone
  checklist records must not masquerade as `source: 'manual-project'` actions.
  No project actions, generated actions or parent completion are modified.
- Projects/assignments are real `kind='project'` rows under lock **817340**.
  IDs are caller-supplied canonical lowercase UUIDs; uppercase/non-UUID IDs reject
  instead of being silently canonicalized by PostgreSQL. Create requires explicit
  `category`, `importance` and `remainingMinutes`; no capacity is invented.
  Description/progress default empty, optional project deadline defaults empty;
  assignments require a date. Updates patch known fields over all existing data,
  preserving resources, planning metadata and extensions. Project deadline can be
  cleared with `''`; an assignment deadline cannot. Status persists the existing
  **active/complete/archived enum**, not a separate archive flag. Archive sets
  archived; **restore sets active**, intentionally not the pre-archive status.
- Changed project/assignment rows **queue planning** via the existing
  `planner_runs.requested=true,next_attempt=now()` update. Background workers may
  later generate/reschedule actions. All service project mutation descriptions
  disclose this. No planner, worker or model is invoked by this transport.
- Read pages are bounded, projected allowlists: no raw collection data, resources,
  source URLs, UIDs, credentials, provider errors or profiles. Task collection
  traversal is capped at the existing 10,000 tasks; project SQL uses LIMIT/OFFSET.
  Calendar snapshot input is capped at 10,000 calendars / 100,000 occurrences and
  event reads require coverage bounds containing the requested interval. Pages
  are not snapshot-isolated across edits. Out-of-contract legacy projections
  fail closed rather than silently truncate fields or fabricate revisions.

### Durable receipts and uncertainty

Receipts live in `planner_entities`, separate kind **dcc-mcp-operation-v1**, with
deterministic UUIDs derived from an actor hash and stable operation key. No schema
migration/startup changes are required. They bind the exact tool and canonical
payload hash, retain safe result receipts, and reject changed-payload or changed-
tool reuse. Local payloads are not stored in receipts; calendar reservations store
the exact bounded immutable writer payload needed for guarded reconciliation.
They also retain its initial serialized JSON and separate byte hash: existing
`applyChange` hashes `JSON.stringify(change)`, while JSONB can reorder object keys.
Guarded recovery honors that original serialization and mutation ID rather than
reconstructing a payload from a fresh cache or assuming canonical hashes match the
writer's insertion-order-sensitive fingerprint. The approved calendar command is
also stored and checked against actor/key/tool scope and the canonical intent hash.

Each mutation takes a receipt-specific transaction advisory lock using
`hashtextextended(receiptId,817344)` and checks the row kind/actor/key before replay.
Local entity mutation, any planning request, and receipt completion share **one
transaction**. Inserts, optimistic versioned updates, receipt updates and planning
requests must affect exactly one row. A thrown/zero-row SQL result rolls back;
errors are sanitized to uncertain. A lost commit acknowledgment is resolved by
the same key reading the durable receipt: either both entity and completion
committed, or neither did. Dispatcher deliberately bypasses its instance-local
synthetic receipt cache for service transports. No durable receipt eviction or
cleanup policy is provided; deletion could permit duplicate effects.

### Calendar safety gates

The expanded cache cannot prove nonrecurrence: `recurrenceId:null` is not proof of
a standalone source. Inject `guardedCalendarWriter` using
`createNonRecurringCalendarWriter(pool, config)` to enable guarded create/update/
cancel. Its source-only `nonRecurringOnly` option is **not** a tool/API field.
After live GET/ICS parse it rejects RRULE, RDATE, RECURRENCE-ID, EXDATE, EXRULE and
multiple/ambiguous event components before PUT. VTIMEZONE recurrence is not event
recurrence. Cache/intent recurrence evidence also rejects. Edits bind the exact
strong ETag using If-Match; create uses If-None-Match:*. A concurrent source edit
cannot bypass the guard without violating the provider's conditional-write/strong
validator semantics. Ordinary browser/Tell Hermes applyChange behavior remains
unchanged when that trusted option is absent, including occurrence edits.

The old unguarded callback seam remains conservative: it cannot enable MCP edits,
cannot promote a bare saved:true reply to a verified completion, and cannot
automatically redrive its older uncertain receipts. Never promote an old receipt
to the new guarded contract just by changing a runtime flag.

Create uses the submitted UUID as the existing writer's immutable mutation ID /
new resource ID. The writer's current source-hash, live GET and conditional-create
checks are the enforcement seam; no caller-supplied resource URL is accepted.
The reservation and exact payload commit before dispatch, and the pool connection
is released before calling the writer (which acquires its own connection).
Guarded same-key retry first checks the mutation ledger, then may call the guarded
writer with the exact frozen payload. This recovers committed-but-never-dispatched
MCP reservations, and prepared writer reservations. Writer lock 817332 serializes
recovery; a matching durable hash plus live mutation marker resolves a lost PUT
response without another PUT. Pending edit recovery still requires the original
strong validator before another conditional PUT. Changed payload/tool/target/key
reuse rejects before an unrelated effect can run.

The service result `state:'saved'` means **provider saved, snapshot_pending**. It
contains the mutation ID, provider ETag when actually supplied (otherwise null),
and readback verified/pending state; it does not invent a snapshot event ID or
claim snapshot refresh. Definite guarded writer completion is durably recorded in
calendar_mutations and then completes the MCP receipt in its own transaction.
Lost completion responses/MCP commit acknowledgments can be resolved by
`get_operation_status` through the narrow DB-only ledger reconciler, with no
provider or unrelated cache reads. Saved status includes the same safe result.
Successful PUT with unavailable readback is saved/pending; possible PUT effects
without definite success remain uncertain, not blanket provider rejection.

There is still an irreducible external-transaction gap: an attempted create whose
resource is now absent may have been deleted after a lost success. It stays
uncertain rather than recreating/resurrecting that resource, including a crash
between the dispatch marker and the actual request. This needs operator review or
stronger provider evidence, not a fresh operation key or a blind retry. No
exactly-once guarantee across external deletions/validator violations is claimed.

Calendar reads mark recurrence
unknown as `null`, and calendars have `writable:false` because the cache contains
no authoritative write ACL; neither is a claim about actual provider permissions.

### Verification and activation gates

`backend/test/mcp/service.test.ts` uses a strict query-contract Pool fake to exercise
transaction staging/rollback, affected rows, lost acknowledgments, actor/key
binding, instance recreation, metadata/tombstone preservation and calendar refusal/
uncertainty. It is **not PostgreSQL**: MVCC, row/advisory lock scheduling, durable
crash recovery, provider ETags/recurrence/conditional writes and permissions remain
unproven without isolated runtime tests. No deployability follows from these tests.

Before in-app activation, connect the existing browser-authenticated command route
to request-scoped actor/tool policy, the durable sole-executor selector, a bounded
native Hermes action loop and receipt-driven UI updates. Do not add a second user
approval/grant-store system or weaken existing session/Origin checks. Isolated DB/
provider tests, receipt retention/privacy policy and runtime verification remain.
Guarded calendar recovery and
provider-saved/pending results are implemented and fake-tested, but actual DB and
provider semantics still require isolated validation. The CLI remains offline
and unconfigured by default; no auth, routes, deployment or credentials are added.
