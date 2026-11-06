# DCC reliability campaign — first source slice

## Current release scope / composer UX override

The user now directs finishing and deploying the current usable slice through
parent-owned gates/review/publication/deployment, not endless matrix expansion.
All 268 cases remain an honest pending inventory, **not a new mandatory release
gate**. The separate timer/calendar campaign source remains unrun unless parent
chooses it as a critical check; no further workflow expansion is in this fix.

The latest user UX requirement supersedes the old unresolved-input pin: a failed,
rejected, cancelled, timed-out or uncertain composer request automatically moves
to separate local history. The box is editable/clearable when not actively busy,
including when action flags are off. Existing unresolved v1 entries (absent mode
means legacy) are retained with their original key/executor/tab, never replayed
or silently upgraded. Existing retained.v1 entries remain readable. History keeps
the latest twenty locally, with a visible may-have-saved warning; backend receipt
keys are unchanged and are not rolled back, overwritten or automatically retried.
New edited text uses a fresh key only on deliberate submission. Exact text matching
retained history requires an explicit visible "Send as new request" confirmation
because it may duplicate effects. Successful unchanged receipt checks still use
their original key; edited clarification answers start a new intent normally.
Active requests retain timer ACK polling and bounded waiting with a visible Stop
waiting control; detached requests do not execute old timer commands. Storage
failure preserves the old durable slot and keeps the editor usable, but may block
new dispatch until safe persistence works. This bounded UX repair and its new
source/browser regressions are **unrun by the worker**.

## Latest parent-executed checkpoints (not whole-matrix completion)

Parent reports the following actual results before the new timer/calendar journey
source below. These are scoped evidence mappings, **not 268 passed cases**; the
inventory's pending statuses remain unchanged until each full expectation runs.

| Checkpoint | Actual result/evidence level | Matrix intersection and remaining scope |
| --- | --- | --- |
| Core authenticated runtime | Two seeds, six production `gpt-6-luna` invocations, 119 assertions, real HTTP auth/actions/callback + real PG; 36 unchanged schemas; 25 rows retained; owned ports closed | `TOOL.create_task.readback`, `TOOL.set_task_completed.readback`, `TOOL.create_assignment.readback`, `TOOL.request_clarification.readback` exercised for the exact synthetic prompts; bounded `TOOL.list_tasks.readback` / `TOOL.list_projects.readback` subsets, not all paging/metadata cases |
| Core receipt replay/refusals | Same-key task roundtrip replay adds no model call/row; changed payload conflicts; unauthenticated/wrong-Origin/missing/expired grant refused | Task creation/completion `.retry` subsets; `WF16` HTTP replay only (not repeated UI Enter), `WF17` changed prompt; `WF25` expiry only, not backend restart |
| Isolated ServiceTransport SQL | PG17, 16 assertions: concurrent same-key replay, changed payload conflict, CAS one winner, completion readback, assignment/archive/restore/status | SQL portions of relevant task/project/status `.readback` / `.retry`, `WF21` / `WF23`; not model/browser/provider acceptance |
| Chromium UI checkpoint | 18/18 targeted Undo/auth/races and 99/99 full E2E; actual Web Locks/storage with mocked API, test port5173 stopped | `UI12`, `UI48`, `UI55`, `WF18`, `WF21` subsets; not real backend/model acceptance. Prior timer ownership 12/12 is likewise browser + mock transport only |
| New timer/calendar journey | **UNRUN** source at `test/acceptance/timer-calendar-runtime.ts`; maximum ten model invocations | Targets timer tools, `WF02` elapsed subset (not 65 seconds), `WF22`, `WF37`, `WF40` auth-loss subset; calendar list/master/create/single edit/cancel, conditional ETag and replay subsets. Full `WF08/09` model DST interpretation, `WF28` donor-disappearance recovery, public TLS and real CalDAV remain pending |

The first core attempt failed the DB address-display assertion with **zero model
calls**: `inet_server_addr()::text` displayed `127.0.0.1/32`. Parent's successful
copied snapshot used `host(inet_server_addr())`; repository source now matches
that exact fix. Exact host, port18533, PG17 and empty-namespace guards remain.
Retain the failed-attempt diagnostic; do not count it as a model retry or erase it.
No deployment or production acceptance is claimed.

## Status, not a completion claim

The older slice notes below retain their original evidence boundaries; use the
latest checkpoint table above for current parent-reported execution counts.

The parent reported backend/frontend 208-test gates plus typechecks/builds and diff
checks PASS before this follow-up; both 35-tool finite source seeds also passed.
Those results do not cover the current repairs. The original 265 acceptance cases
remain pending; the clarification tool adds three pending cases (268 total).

Current follow-up source changes are **unrun** here:
- Running/paused default focus retains its identity and elapsed countdown across
  queue insertion, start/resume and reload. A fresh/reset session alone selects a
  queued mini; switching an existing session's phase requires reset first.
- Timer ownership is required before elapsed reconciliation, ticking, persistence,
  manual changes or RPC. Pending/denied/missing Web Locks quarantine copied state;
  the UI offers deliberate retry and warns that a reclaimed copy lacks later
  original-tab changes. Stored receipts are preserved. AuthGate unmount releases
  ownership; late lock grants are ignored. Real two-tab acceptance remains pending.
- Manual reorder uses the same running/fresh-session eligibility as RPC and checks
  current functional state/indices; rejected moves cannot reset elapsed progress or
  publish success notices.
- Pure timer state and hooks moved out of the component module; clock initialization
  and ref synchronization moved out of render. Stable clock callbacks have explicit
  effect dependencies. The exact post-change lint count is parent-owned/unverified.
- Typed clarification uses the existing journal, no new schema. The added injected
  controller-to-render test is a query-fake source seam, not HTTP/model acceptance.

The baseline was source-reviewed with 32 product tools. This branch adds three
browser timer tools, one constrained clarification tool, and exact Luna 6 inference policy. These new production paths
require independent review and execution. No source test proves live PostgreSQL,
provider behavior or natural-language interpretation. The previous intermittent
`list_tasks` invalid-limit/untyped-adapter failure is **unresolved**, even if a
later journey passed. Keep it open until seeded repeated acceptance explains it.

Initial reproducible candidates:

| ID | Baseline failure | Source repair/regression | Current evidence |
| --- | --- | --- | --- |
| WF01 | Four constructors independently select Luna 5.6 | Shared `dcc_model_policy.py`; AST constructor audit and isolated-path loader test | Parent policy tests and installed synthetic Luna 6 helper PASS; deployed hardcoded scripts still await source delivery |
| WF02 | Focus state exists only inside mounted Pomodoro view; no MCP timer control or reload reconciliation | Tab-local persisted clock/receipt engine, typed browser rendezvous, rendered prompt→ACK→actual clock test | Parent prior 208-test gates PASS; follow-up review repairs await execution |
| WF03 | Intermittent task probe refusal/adaptation | Existing strict adapter refusal diagnostics; retain exact bounded window and invalid-limit regression | Still unresolved in actual model acceptance |

## Executable inventory

The opt-in real authenticated HTTP/production-runtime/PG seam is now source at
[`test/acceptance/README.md`](test/acceptance/README.md), with exact parent setup,
checks, commands, pinned loopback transport and empty-namespace guards. It is
**unrun** and excluded from ordinary test globs; this does not close any pending
full-matrix case or certify public TLS/proxy/deployment.

`test/reliability-matrix.ts` exports **268 pending cases**: every current **36 tools × 3**
(readback/refusal/retry), **60 rendered feature groups × 2** (interaction/failure
and reload), and **40 adversarial workflow cases**. Every case has an ID, expected
state/readback, evidence kind and explicit pending status. Existing tests referenced
by a case are evidence seams, not proof the whole feature passed. Android's native
screens/offline/timer remain an explicit parity boundary; no Android change/check
was made. Feature groups enumerate controls without claiming their suboperations
were all exercised by one happy path.
This is a first-pass inventory, not certified exhaustive rendered-control coverage:
native Android's control-level inventory and atomizing grouped UI suboperations
remain open work for the next loop. Catalog inventory coverage is explicitly 36/36; that
stronger completeness statement does not apply to rendered controls yet.

`test/reliability-matrix.test.ts` executes catalog completeness and all-tool negative
authority/unknown-field guards. It does **not** execute the positive cases. Machine
readable export (installed dependencies only, no listener/data/provider):

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs --input-type=module -e "import {RELIABILITY_CASES,CAMPAIGNS} from './backend/test/reliability-matrix.ts'; console.log(JSON.stringify({cases:RELIABILITY_CASES,campaigns:CAMPAIGNS}))"
```

Two varied complete passes use seeds **20261105** and **20261106**, reference zone
`America/New_York`, synthetic School/Work calendars and fixed synthetic reference
dates. Thus 530 case observations are required before satisfaction, plus independent
review. Do not mark a case passed without its required readback. Unknown material
failures stop a campaign. Every failure records only scenario ID/seed/stage/known
code, synthetic state delta and regression reference. Never store private prompts,
tokens, provider errors, session exports or canonical private notes here.

Run finite batches. Each model invocation retains eight native iterations, twelve
calls, four writes and its existing time budget; only explicitly corrected refusals
can recover. Concurrency is bounded to two isolated requests initially. A passing
retry does not erase an unexplained failure. Remaining cases stay pending rather
than triggering endless model retries.

## Actual model and callsite policy

Adjacent `deploy/dcc_model_policy.py` is mandatory for the official-bootstrap
action runtime, read-context runtime, product probe and legacy compatibility probe.
They all pass exact `gpt-6-luna` and `openai-codex`; no environment/model/provider
override or fallback is introduced. The parent owns configuring the existing
daymark-curator default and proving provider acceptance. OpenCode's own model is
intentionally unchanged.
The same public policy supplies an explicit current reference time with the
America/New_York UTC offset to each inference loop. Offset-aware fold/leap-date
source regressions do not prove the model will interpret natural dates correctly.

| Inference | Route/boundary |
| --- | --- |
| Fresh composer/product actions | Authenticated actions → fixed scoped callback → production `run_action` |
| Old task/legacy retry | Existing pinned three-tool policy or parser executor; no policy upgrade |
| Legacy parser, custom-project preview, study extraction | Common bridge → supplied-context MCP → host domain validators |
| Assignment and day planning, mail classification | Same read-only context/proposal boundary; host is sole executor |
| Material decoding, selected session excerpts | Explicit supplied/selected data, not an inference grant |
| Mail and price connectors | Existing connector dispatch, not product model administration tools |

## Timer authority and first-slice limits

`get_focus_timer` reads the live originating tab. `control_focus_timer` supports
start/pause/resume/reset and explicit focus/break configuration. `edit_focus_queue`
adds/removes/moves individual mini timers. Writes require the snapshot version,
backend-owned operation IDs and keys. No generic JS, frontend route or script tool
exists. Timer-only receipts never trigger planner/calendar refresh.

The authenticated actions request pins its random tab ID in the existing intent
journal. The authenticated, exact-Origin timer bridge gives that tab bounded
nonce/operation requests. A held Web Lock excludes live clones of sessionStorage;
without it, timer RPC is unavailable, not silently redirected. The browser applies
CAS and commits timer state and the exact replay receipt in one sessionStorage
document **before** ACK. Progress uses monotonic elapsed time while mounted and
saved wall-time elapsed on reload. Backward wall-clock restore pauses safely.
Manual controls reuse that same state and existing `advanceFocusTimer` behavior.

The backend keeps only a bounded request rendezvous, not a persistent timer session
or backend clock. Reservations/completed replies use the existing operation receipts
and durable intent call ledger; neither adds a table nor stores a backend timer clock.
A ten-second unacknowledged command is uncertain; a read is unavailable. Expired
nonces cannot acknowledge. A backend restart loses pending rendezvous and cannot
re-execute an old operation. Browser receipts prevent local duplicate application.
Retrying an uncertain timer intent now issues a **fresh receipt-only nonce** to its
original tab. The old command is never dispatched again. A persisted matching
browser receipt can complete the durable backend receipt after ACK loss or restart;
missing/compacted browser proof returns uncertainty without changing the timer.
Expired original nonces remain invalid. A retry restarts bounded browser polling.
This source path still requires actual HTTP/browser/restart acceptance.

The composer offers Stop waiting (abort, not rollback), then explicit Retain uncertain
request and start new. It archives the full old key/executor/tab and warning locally
before releasing the input; old server records are unchanged. Storage failure keeps
the request pinned rather than losing it. A new request has a new key and never
silently retries the old mutation. Late receipts cannot overwrite another tab's new
submission; old-key polling stops when that retained key is no longer current.
The new read-only `request_clarification` tool accepts only one of eight missing or
ambiguous domain reasons, never arbitrary question/success prose. The server supplies
the exact question; up to three unique questions are bound to the existing invocation
journal and projected separately from effects. Questions fence subsequent writes in
that invocation. Existing pending writes still fence new calls; questions do not
resolve uncertainty. The composer renders the questions and requires an edited/new
intent for an answer, retaining any known applied effects. Production model selection
of useful questions still needs actual acceptance. Corrupt/full storage fails closed.

The local replay journal retains at most 128 receipts and compacts the oldest 64
with a persisted monotonic **receiptFloorVersion**. Timer versions never reset, even
when the timer resets. An old immutable command below that floor cannot execute;
without retained proof it is uncertain. The backend's durable operation-key/payload
fence prevents changing that old command's expectedVersion to evade the browser
floor. Thus compaction does not brick ordinary usage or claim proof it discarded.
Two seeded source loops each assert 256 operations, replay/recovery immutability and
compaction fences. Queues are capped at 60. Invalid/corrupt storage is preserved;
RPC does not report applied when persistence fails. No tab available means no backend
claim that a timer started. Native Android Hermes timer routing is not implemented.

## Parent source checks (worker execution may be denied)

```sh
npm run check:backend
npm --prefix frontend run check
python3 -B -m unittest discover -s backend/deploy -p 'test_dcc_model_policy.py'
python3 -B -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
python3 -B -m unittest discover -s backend/deploy -p 'test_task_action_launcher.py'
python3 -B -m unittest discover -s backend/deploy -p 'test_read_context_runtime.py'
python3 -B -m unittest discover -s backend/deploy -p 'test_product_mcp_probe.py'
python3 -B -m unittest discover -s backend/deploy -p 'test_hermes_mcp_probe.py'
git diff --check
```

Reuse the existing Testing Library controlled-clock tests and Playwright browser
configurations. Ordinary source checks do not start APIs/workers or run models.

## Executable finite source campaigns

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/run-reliability-campaign.ts 20261105
node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/run-reliability-campaign.ts 20261106
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/reliability-campaign.test.ts backend/test/mcp/browser-timer.test.ts backend/test/mcp/schemas.test.ts
npm --prefix frontend test -- src/browserTimer.test.tsx src/TellHermes.test.tsx
```

Follow-up targeted regression commands for the parent (unrun by the worker):

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/clarification.test.ts backend/test/mcp/request-controller.test.ts backend/test/mcp/runtime-isolation.test.ts backend/test/reliability-matrix.test.ts
npm --prefix frontend test -- src/browserTimer.test.tsx src/focusTimer.test.ts src/App.test.tsx src/TellHermes.test.tsx test/clarification-flow.test.tsx
npm --prefix frontend run lint
```

The dedicated `frontend/test/clarification-flow.test.tsx` seam deliberately stays
outside app-source typechecking/bundling: it imports the backend controller and
strict query fakes, not a real Pool or startup. Vitest executes it explicitly as part
of the frontend test gate. The normal backend source compiler remains authoritative
for controller types; the normal frontend compiler covers the rendered composer.
Parent must run the full source gates and `git diff --check` as well as targeted
regressions; no current PASS or lint-warning count is asserted here.

The runner is inert on import and accepts only these two seeds. It executes 36
capability/unknown-field refusals, 256 timer commands with exact duplicate/recovery
checks, intent key/prompt/expiry fences and representative task completion, project
archive/restore, topic insertion/removal and safe read projections. Observations
are appended only after the corresponding observable assertions succeed. JSON output
contains seed, assertion counts, partial source-seam coverage, and an explicit
not-proven list; failure output contains only stage/code and completed observations.
No expected inventory entry is converted into a pass. The service portion uses the
strict query fake/injected synthetic calendar resources, **not** real PostgreSQL,
CalDAV, authenticated HTTP, a browser or a model. All 268 campaign inventory cases
remain pending at their required acceptance tier. Node tests execute both finite
seeds during the parent backend gate; they do not start QA services or load private
environment files. Source runner results are evidence only after actual execution.

## Isolated runtime/browser acceptance — parent only

Use a separately approved disposable PostgreSQL database and synthetic fixture
records/calendars. No personal records or production DB/provider may be used.
Construct the real authenticated API, migrations and browser with the existing
stack; these service starts are not part of source checks. Run the **production
`run_action`** through its real fixed HTTPS callback and official bootstrap, not just
`product_mcp_probe.py`'s separate model loop or the query-fake stdio fixture.
The parent must supply isolated HTTPS routing for the unchanged callback origin
with normal TLS/authentication; no arbitrary callback override or insecure TLS flag
is added. Verify wrong Origin/session, expired capability, wrong tab/nonce and
actual HTTP response limits as negative controls.

`test/mcp/authenticated-runtime-fixture.ts` exports an inert parent construction
seam for the actual buildApp/auth/TaskActions path. It accepts a parent-owned Pool,
reviewed origin, calendar dependencies and bridge; it imports no environment or
server startup. Its literal synthetic login is test-only. Parent must inject the
official-launcher production `run_action` bridge (not a separate model loop) and an
isolated real DB when claiming storage acceptance. In addition to
`isolatedSyntheticOnly:true`, supply required `isolation` metadata: a disposable
loopback database named `dcc_qa_*`, explicit non-default port (not 5432/3001/5301),
`syntheticDataOnly:true`, exact Luna model and approved model invocation, and either
no calendar callbacks or reviewed synthetic loopback calendar origins. Construction
checks the Pool's public host/port/database against metadata before creating the
application; it does not read credentials or connect. Metadata cannot prove that
injected executable bridge/provider callbacks obey it; parent review remains required.

Parent setup sequence (each service/model step separately reviewed):

1. Prepare a disposable DB using the existing migrations and only synthetic
   School/Work calendars. Construct the fixture with that Pool, normal scoped
   calendar writer/snapshot, exact browser Origin and the bridge that invokes the
   production official-bootstrap launcher/action runtime. Do not import server.ts
   or private environment loaders as a shortcut in an ordinary source check.
2. In the isolated QA network route the unchanged fixed HTTPS callback to this
   authenticated API with normal TLS. Keep the API/proxy pair matched (normal web
   origin localhost:5173 and API 127.0.0.1:5301 when using development defaults).
   Never use or stop port 3001. The worker does not set up this routing or listener.
3. Use a fresh Playwright browser context, synthetic fixture login and actual
   composer. Run production run_action with Luna 6, not the separate product probe
   model loop. Verify timer poll/nonce ACK and actual rendered elapsed state.
4. Abort one timer ACK request after browser persistence, retry the unchanged key,
   and require a fresh recoverOnly challenge, identical operation receipt, continued
   elapsed progress and no second model invocation or timer reset. Repeat after an
   isolated API restart with the same DB and original browser storage (re-login if
   the fixture's in-memory login session was lost).
5. Test missing proof: recovery must remain uncertain without applying a command.
   Explicitly retain that old request, then submit a different read-only request;
   verify a new key and unchanged old record. Test wrong tab/nonce, duplicate-tab
   locks, storage corruption, late receipts and expired original capabilities.
6. Record only scenario/seed, counts and synthetic state readback. Do not export
   session cookies, capabilities/nonces, raw network traces or provider errors.
   A real SQL/HTTP/browser pass still does not prove real CalDAV until separately
   approved isolated provider resources are read back.

Deploy/copy the reviewed adjacent policy/launcher/action/helper/probe files together
to isolated scratch first. Prove Luna 6 metadata/provider acceptance with no fallback,
then browser prompt→actual timer status/start/pause/resume/configure/reset/queue,
elapsed clock, reload, duplicated Enter and lost ACK. Capture authoritative receipts
and isolated DB/CalDAV readback for non-timer writes, not model prose. Only the parent
publishes source and owns deployment. All 268 positive/fault acceptance statuses
remain pending until actual evidence is recorded outside private data.
