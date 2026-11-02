# In-app DCC actions: authenticated request → bounded MCP → receipts

## Implemented source-only slice (not activated)

`SqlIntentStore` in `intent-store.ts` now implements the selector/journal against
an injected Pool and existing `planner_entities`. Each transaction takes the legacy
Tell Hermes advisory lock first, reads the legacy row then the intent row, checks
stored versions/actor/prompt/commands and sentinel, and requires one affected row
for each insert/update. A new MCP intent and its legacy sentinel commit together.
Every connection is released before model/SDK/service work. An ambiguous commit
returns no execution directive; retry reads the journal, never guesses ownership.

`RequestController` in `request-controller.ts` accepts an injected **one-round
in-process runner**, not Hermes CLI JSON. The host bounds rounds, tool batches and
time, and makes real official SDK Client→InMemoryTransport→Server→Dispatcher→
ServiceTransport calls. Only the transaction winning `start` gets an execution
owner; owner identity/capabilities remain captured by backend closures. `_meta`
carries native-call correlation only. Action discovery omits backend-owned write
keys/creation IDs. There is no route, listener, new credential store or bridge edit.

The controller discards model-final data and projects summaries from persisted
results only. It races cancellation/deadline against runner/service work, fences
new work, and persists late service results. Repeated active requests can interrupt
the existing owner, but never replace it. Recovery uses `ServiceTransport.reconcile`
to inspect matching durable receipts (including DB-only guarded-calendar completion
reconciliation); missing receipts remain pending. It never calls execute on unknown
operations, re-reads a provider/cache or restarts a model. Interrupted planning
stays `uncertain` even if all known writes have terminal receipts: receipt recovery
does not establish fulfillment of the original natural-language request.
Cancellation is not rollback: a service/provider operation already dispatched may
finish later. Its frozen key and receipt remain authoritative, and the controller
must not claim that abort means nothing was saved.

The deterministic intent query fake serializes lock waiters and snapshots state
after lock acquisition; tests cover two stores, fault/zero-row paths, SDK planning,
partial results, cancellation/deadline and receipt-only recovery. These are source
tests, **not** proof of PostgreSQL isolation, native Hermes semantics or deployability.
An indefinitely stalled injected database call is not forcibly canceled: deployment
still needs approved DB/pool statement/connect timeouts and operational recovery.
No tests/checks in this continuation were run by the worker; parent owns execution.

The sections below retain the proposed live integration design. References to a
future adapter/controller now mean wiring/verifying these injected source seams,
not activating them automatically.

## Necessity gate and ONE integration recommendation

Use the **existing authenticated DCC text submission** as user-intent admission.
For a newly admitted intent, DCC selects MCP as the sole executor and gives the
daymark-curator action invocation a short-lived, backend-owned tool capability.
The model can read current records and plan routine requested actions within that
capability. **No separate human review of every tool payload is required.** Backend
tool allowlists, field/domain validation, versions/ETags, budgets and durable
receipts remain authoritative; model output is not a credential or proof of work.

Keep the current private DCC↔curator bridge boundary. Add a request-scoped official
MCP callback channel for the action invocation, not an arbitrary full-account HTTP
API, a new SSH subsystem, independent approval broker or credential/grant store.
The concrete proposed callback is a private, intent-bound SDK MCP endpoint such as
`/internal/dcc-intents/:id/mcp`, with the existing bridge service authentication
plus DCC's active-intent/attempt checks. A service credential alone cannot admit an
intent or choose actor/tools. The fixed callback destination comes from deployment
configuration, not browser text or tool arguments. Do not forward browser cookies.
This is a proposed integration, **not implemented transport or a new wire protocol**.

There is an important implementation gate: the repository only shows Hermes CLI
oneshot invocation, not an API for installing per-invocation MCP clients, stable
native tool-call IDs, cancellation or transcript resume. Verify that runtime
interface and Hermes→DCC private reachability before wiring the callback. Do not
invent CLI flags or hand-roll a second tool-call protocol to bypass this gap.

DCC is currently **single-account shared task/project/calendar data**. Actor IDs
scope operation receipts, not data rows or tenants. This design does not introduce
multi-tenant isolation. Root development tools in project-manager are not proposed
action-model tools and are not a reason to add SSH/key-isolation infrastructure.

## Source-grounded current journey

1. `frontend/src/TellHermes.tsx` persists `{key,prompt}` before POST, reuses the key
   for unchanged text/retries and calls `onCreated()` after an OK response.
2. `backend/src/auth.ts` checks exact Origin for mutating `/api/` requests and a
   validated `daymark_session` cookie for protected `/api/v1/` routes. Missing auth
   configuration fails closed. This is already user-intent admission; do not weaken
   those checks or exempt the browser command route.
3. `backend/src/app.ts` accepts only `{key,prompt}` on
   `POST /api/v1/hermes/commands`, caps body/rate and calls `tellHermes`.
4. `backend/src/tell-hermes.ts` locks a stable submission receipt, hashes the exact
   prompt, calls `callCurator({mode:'tell-hermes',...})`, validates one parsed create
   command, freezes it and executes it. This is currently the **DCC executor**.
5. `callCurator` in `backend/src/planner.ts` uses the configured curator URL/service
   credential. `backend/deploy/curator_bridge.py` authenticates `/curate`, invokes
   `daymark-curator --oneshot --max-turns 1 --run-budget 120`, prohibits tools in its
   prompts and extracts final JSON. It is presently a **parser**, not an MCP loop.

Thus simply adding global write tools to that profile would risk a model write
followed by a second DCC execution. Changing that executor boundary is necessary;
requiring separate payload approvals or building another broker is not.

## KEEP versus optional / DEFER

**KEEP:** browser Origin/session checks; current `{key,prompt}` admission and
persist-before-send behavior; the configured private bridge service hop; strict
service schemas and projections; standalone task collection versions; real project
statuses/planning side effects; guarded nonrecurring calendar writer; immutable
operation payloads and durable service receipts; SDK framing and injected factories.

**KEEP as optional restricted mode:** `createServiceMcpServer` exact-action grants.
They are useful for prebound jobs/tests, but **not the only action UX**. A request
action mode must allow first-use payload binding after the model performs reads;
it must not require a human to preapprove each concrete title/target/version.

**IMPLEMENT NEXT only after the runtime gate:** one shared intent selector/store
adapter, one request-local SDK action capability, bounded native Hermes tool loop,
receipt-based result adapter and UI reconciliation. No write capability is attached
globally to planner, assignment planning, extract, mail-classify or price/mail paths.

**DEFER:** independent broker/grant store, new OS users/services/SSH keys, SSH forced
commands, profile-wide MCP write exposure, new credential generation, speculative
network/auth hardening unrelated to this route, and any broad generic backend API.
Do not import `backend/src/server.ts` to bootstrap MCP: it loads env, migrates and
listens. Future runtime code should reuse the API process's injected Pool/cache/
guarded writer, not start another application or migrations.

## Durable sole-executor selection with existing storage

The pure seam in `request-intent.ts` defines transitions, not storage or auth.
The injected SQL store uses `planner_entities` kind `dcc-request-intent-v1` and
the **same legacy receipt lock** as Tell Hermes:
`pg_advisory_xact_lock(hashtextextended(legacyReceiptId,817343))`. Transaction and
session advisory locks must address the same key/namespace. Validate in PostgreSQL
tests before activation; pure tests do not prove database concurrency.

Under that lock, read BOTH the new intent and existing `hermes-command` receipt:

- Bind stable submission key, exact prompt hash and server-derived account actor.
  No actor, purpose, executor, scope or capability is accepted in browser JSON.
  Current auth exposes a boolean, not a principal: for this single-account app use
  a stable server-owned account actor, not a cookie, password hash or model label.
- A real preexisting legacy receipt keeps the legacy executor, including pending
  frozen commands. A feature flag change or retry cannot convert it to MCP.
- With neither receipt, the server's rollout setting selects the executor once.
- For a new MCP owner, atomically insert the intent **and**
  `legacyFenceForIntent(intent)` at the legacy receipt UUID/kind. It has a matching
  fingerprint and a fixed terminal 409 result. Existing Tell Hermes checks those
  fields before parsing/executing, so even an older API process returns the fence
  instead of running the parser executor. Never overwrite a real legacy receipt;
  require affected rows and commit both inserts before starting a model.
- `legacyReceiptEvidence` distinguishes that MCP fence from real legacy results.
  An orphan fence, conflicting executor, actor or changed prompt fails closed.
  Do not recover missing state by silently reparsing under another executor/key.

The new record is an intent workflow journal, not another permission/grant service.
Its global key namespace intentionally matches the existing single-account legacy
key namespace; actor binding does not create a parallel key that bypasses legacy.
Persist `startIntent` before invoking either branch. Duplicate/in-flight requests
return/reconcile receipts instead of starting a second model. Never fall back from
MCP failure/timeout to `tellHermes`.

## Request-local tool planning, not per-payload approval

The action controller owns a finite tool allowlist and derives matching capability
strings from it. These are attached to this admitted request/attempt only. The
initial pure-policy limits are **4 rounds, 12 calls, 4 mutations and 120 seconds**,
inside the current 135-second bridge / 150-second backend / 180-second UI deadlines.
These numbers bound work; they are not a claim that Hermes currently exposes the
required runtime API. Cancellation/late-callback fencing still need runtime tests.

For a native runtime call:

1. Authenticate the bridge hop and look up the backend-owned active intent/attempt.
   Reject missing/expired/inactive callbacks, wrong purpose or out-of-scope tools.
   Do not pass capabilities/actor from MCP arguments or `_meta` into the backend.
2. Use a stable native tool-call correlation ID from the persisted runtime
   transcript, not a reconnect-reset SDK JSON-RPC request counter. It is **not** a
   credential. `reserveIntentCall` validates domain
   fields, injects a deterministic operation key and (for creates) entity UUID,
   then binds that call ID to the exact tool/arguments. No human approval is added.
   The future action-mode SDK schemas omit host-owned write keys/creation IDs;
   existing service contracts still validate the full backend-bound command.
3. Commit that reservation under the intent lock/version check **before** passing
   the command to Dispatcher/ServiceTransport. Retried identical calls replay or
   reconcile their stored command. Changed payload/tool for a call ID rejects.
   Pending/uncertain writes block new work; a new call ID/key is not a safe retry.
4. Commit only Dispatcher/durable-ledger results using `recordIntentResult`.
   Model final prose/JSON is not a receipt. The reducer validates shape but cannot
   prove provenance: the controller must obtain results from the backend itself.
5. Persist round/call/write counts; do not reset budgets on retry. Timeout or lost
   connection marks the intent uncertain and fences new model calls. Resume known
   operations/status from the journal, not a new parsed command or fresh key.

The pure helpers perform no I/O and cannot enforce atomic persistence or runtime
ownership by themselves. Every directive is conditional on a successful locked
store commit. One active driver must own the attempt; late callbacks must consult
that same persisted state. Neither a process-local map nor a model-supplied call ID
is a concurrency/authentication guarantee.

The admitted text permits bounded routine tool planning, not arbitrary commands.
Backend validation cannot cryptographically prove that every otherwise valid
payload is a faithful interpretation of natural language. Scope/budgets and refusal
of unsupported actions reduce exposure; ambiguity/missing required data asks for
clarification, not invented deadlines, calendar selection, effort or completion.
Do not confuse genuine missing intent details with low-level product defaults:
Tell Hermes already uses personal/category, importance 2 and omitted effort 0 for
new projects. If retained, those are explicit backend create defaults (not model
effort estimates or a new approval step). The request-mode schema/adapter must
make that normalization explicit and test it before service dispatch; this pure
seam currently validates the existing service contract, without adding defaults.

## Proposed route / bridge / SDK / UI patch (NOT applied)

```diff
 # app.ts — keep the protected route, Origin/session hook, strict body and rate cap
- result = await tellHermes(body, dependencies)
+ intent = await store.claimAuthenticatedIntent(body, serverAccountActor, rollout)
+ if (intent.executor === 'legacy-parser-v1')
+   result = await existingLegacyReceiptOrTellHermes(intent, dependencies)
+ else
+   result = await actionController.runOrReconcile(intent, dependencies)
 # NO tellHermes(modelFinalJson), fallback parser, or second execution in MCP branch

 # curator_bridge.py — authenticate /curate as now; only a new action mode changes
+ if mode == 'tell-hermes-action':
+   return run_native_request_scoped_action_loop(bound_intent_reference)
 # Existing tell-hermes/parser, planner, extract, mail-classify etc remain tool-free
```

These names are proposed interfaces, not claims of existing functions or invented
Hermes flags. Action mode needs native MCP access restricted to this backend intent,
bounded turns/time, stable call IDs/transcript and an outcome/receipt reference;
the old first-`{`/last-`}` JSON extraction must NOT be an execution path for it.
An unsupported action mode must fail closed, not fall through to the bridge's
generic planner prompt. Enable the backend rollout only after that runtime path
has been verified; never use parser fallback as recovery for an admitted MCP intent.
The existing `daymark-curator` action invocation can be request-locally configured;
do not change that profile's global write permissions or reuse this mode for parsing.

The proposed callback lives outside the browser API namespace and must have its
own existing-service-auth + active-intent gate. Do **not** add a session/Origin
exemption to `/api/v1/hermes/commands` or accept browser cookies on the bridge hop.
An admitted intent is required in addition to the service credential; no endpoint
can create capabilities, choose an account or expose arbitrary routes/SQL/URLs.
No callback endpoint, credential/header plumbing or profile edit is implemented.

**User journey:** authenticated text submission → committed sole-executor choice →
request-local model reads current tasks/projects/calendars → validated requested
actions through MCP → durable service receipts → backend-built intent result → UI
refreshes affected existing snapshots. Calendar `saved/snapshot_pending` shows a
pending confirmation badge until refreshed cache identity appears; never invent
an event ID from a mutation UUID. Partial/uncertain results retain the submission
key and disclose committed effects. Unchanged retries show/reconcile receipts;
they do not execute model output again. Missing details is clarification, not a
separate approval ceremony for every tool payload.

## Next proof and explicit remaining limits

The future SQL adapter must test simultaneous claims, rollback/zero-row outcomes,
legacy/MCP rolling-version races, orphan fences, persisted budgets and lost commit
acknowledgments. Route tests must retain 401/no session, 403/wrong Origin and strict
body/rate limits; injected selectors/actors/capabilities must reject. Runtime tests
must prove request-only MCP visibility, stable call IDs, bounded native rounds,
cancellation/late callbacks, no cookies in bridge traffic, no model-result second
execution and receipt-only retry. UI tests must preserve keys and render partial,
uncertain and saved-awaiting-snapshot outcomes without false success.

Current source tests exercise the reducer, SQL store, injected SDK controller,
old Tell Hermes honoring the sentinel, and query-fake services. They are not live
authentication integration, a Hermes native tool loop or real concurrency proof.
The exact unresolved runtime interface/reachability gate above prevents a coherent
live route/bridge patch today; do not silently replace it with another subsystem.

**The catalog is not finished:** recurrence creation/series/occurrence mutations
remain unsupported for tasks/events; permanent deletion is absent; manual-project
actions are not standalone checklist linkage; live auth/transport/UI integration
is still missing. Existing project changes queue planning. Actor-scoped receipts
remain distinct from single-account shared data authorization.
