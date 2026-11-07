# Everyday non-timer actions — executed partial acceptance

Baseline: parent-authorized published release `63ced680560c7978e1e1dd5bc055cdbb29ce2483`.
This work adds acceptance tests and a narrow production description/guidance fix
on `test/dcc-hermes-everyday-actions`: exact daily-action IDs are distinguished
from project IDs. No fields, SQL predicates, auth, permissions, write safeguards,
model selection, budgets or callback transport changed.
Parent reviews/copies the baseline production source plus these test files and
owns all actual execution. Nothing below is a mock-model PASS or tool-availability
claim. Every case in a fresh campaign starts **PENDING** until its assertions
actually execute; retained evidence from the first attempt is recorded below.

## Latest parent execution — partial, not full PASS

The final isolated `dcc_qa_everyday_03` campaign executed **ten real gpt-6-luna
requests /258 assertions**: **EA01–EA09 PASS**, **EA10 FAIL**, EA11–EA12 PENDING.
This proves the named task lifecycle, project/child editing and completion,
archive/restore, assignment deadline changes and ambiguous-project clarification
for this finite synthetic campaign. EA05 passed after the targeted description/
guidance fix; it failed in the retained prior campaign.

EA10 read calendars/events, then supplied a nonmatching event ID to
`get_calendar_series`, which correctly rejected `not_found`. The model stopped
without creation; there were **zero calendar PUTs and zero mutation-ledger rows**.
Calendar creation is a failed intent, not a successful provider-write test.
Move/cancel never ran. The run stopped immediately and retained42 planner rows;
owned listeners/processes/pool/tunnel/isolated PG were closed. No further model
campaign was launched. Aggregate actual attempts across the three campaigns:16.

Parent source gates:228/228 backend tests/build, strict new-runner TypeScript,
20 Python action tests and3 model-policy tests, and diff check PASS. Read-only
source review PASS with no blocking finding. All ten final invocation records
used36 unchanged-within-campaign schemas, digest
`2d30920d87663dfb1ccfddd582c3d0190cf38e19a9f97f836d6b998c08a5dcea`.
Description changes intentionally differ from the old campaign digest.

No full265-case, real CalDAV/public TLS, rendered composer, preparation,
cached inbox/prices, recurrence/all-day/DST or universal reliability claim.
Historical source-worker UNRUN statements below mean the worker did not execute
those commands; the parent results above are the current checkpoint.

## Retained first attempt / client lifecycle correction

Parent's `dcc_qa_everyday_01` attempt reached preflight READY and **EA01 PASS:
one actual gpt-6-luna invocation,32 assertions**, both tasks verified through
HTTP/SQL/receipts with36 unchanged schemas. It then failed at EA02.http-login,
**before a second model invocation**; five retained rows were unchanged. Preserve
that failed campaign/report and its completed EA01 evidence. The original run did
not pass the remaining cases.

A separate zero-model parent diagnostic proved Node fetch reused a stale
keep-alive socket across app close/rebind on18534 (`UND_ERR_SOCKET`). The harness
now sends `Connection: close` on **every** app request from the very first login,
including GETs, action POSTs, replay and conflict checks. It drains each actual
wire response body before returning a buffered Response; login JSON is explicitly
consumed/checked before the next fetch. Even status-only conflict checks leave no
unread wire body. No request retry, production limit change or model-policy
change is introduced. The app server's normal keep-alive behavior is untouched.

The corrected `dcc_qa_everyday_02` actual campaign then passed EA01–EA04: create
both tasks, rename/notes/complete/reopen, exact-target tombstone with replay/409,
and project+child creation. It failed EA05 `write_scope`, at five model calls /
125 assertions. This is the first actual intent failure, not the socket issue:
the model called `list_daily_actions` with the **project ID** in `id`, got an empty
page, and stopped without editing the known child. The child remained version1
on2030-11-07; parent remained active. Preserve this original failure, report and
namespace; EA05 is FAIL and later cases remain PENDING for that campaign.

The scoped targeting fix changes production-generated tool/parameter descriptions
and short product-action guidance: `id` means exact ACTION ID, not project ID.
There is no new projectId filter. To find children, retain the explicit date
window, omit the wrong id filter, page and match returned projectId, or use the
supplied exact child ID. An unresolved requested edit is not a successful no-op;
clarify/refuse honestly if it cannot be grounded. No guessed IDs, automatic write
retry, SQL predicate change or authorization/version relaxation is introduced.
The current 35-tool allowlist excludes retired prices; other structural fields
remain unchanged. Description text
intentionally changes the schema digest versus older campaigns; the fresh digest
must still remain stable within each invocation and throughout the new campaign.
The original three-tool/legacy runtime does not acquire this product-only guidance.

The commands below now target a separately approved **fresh**
`dcc_qa_everyday_03`: at most **18 invocation attempts total**, comprising the
original one, corrected campaign's five, and this new twelve. This is a bounded
fresh campaign after a diagnosed targeting fix—not an automatic retry, resuming
either failed namespace, or a declaration that previous campaigns passed. If
another functional case fails, stop and report it; do not silently iterate more
campaigns. Patched checks and campaign03 remain unrun by the source worker.

## Finite use cases grounded in current schemas

One seed **20261107**, maximum **12 model invocation attempts TOTAL**, serial,
stop on FIRST failure, no automatic retry/new-key replacement. Existing native
eight iterations, twelve tool calls and four writes per request are unchanged.
Each planned request has at most three writes. Reads must establish current IDs
and versions; required intermediate readback must appear in the durable journal,
not only in final model prose. IDs in later prompts come from real SQL/HTTP
readback, never invented creation IDs. Detailed prompts are in the runner; these
are plain-language examples of the same requests.

| Case / initial status | Example natural-language request | Required persisted facts / tools |
| --- | --- | --- |
| EA01 PENDING | “Add a study task and a work task for Nov7 2030; note estimates of25 and15 minutes.” | Two `create_task` writes; title/date/notes/important exact; two new backend IDs; collection +2 versions; `list_tasks` readback after each. **Task estimates are notes text**, not a numeric task duration field. |
| EA02 PENDING | “Rename that study task, revise its estimate note to35 minutes, complete it, then reopen it.” | `update_task`, `set_task_completed(true)`, `set_task_completed(false)`; three fresh collection versions and intermediate list readbacks; date/importance/unrelated records unchanged. |
| EA03 PENDING | “Delete only that work task.” | `remove_task` sets only that target's tombstone; it disappears from the active-task projection, **not** the raw collection. Survivor, recurrence/unknown metadata and tombstone remain intact. Host replay adds no model/row/version; changed payload under same key returns409. |
| EA04 PENDING | “Create a coursework project due Nov30 2030 and add a25-minute outline action for Nov7.” | `create_project` planning fields and `create_daily_action`; manual-project source, exact parent link/date/typed minutes, parent active. HTTP planner snapshot matches SQL. This queues a planning request but does not run a planner worker. |
| EA05 PENDING | “Move that manual outline action to Nov8, revise it to40 minutes, then complete it.” | Two `update_daily_action` writes; edited title/notes/date/minutes then completion readbacks. **Parent's entire row/version remains unchanged and active**. Generated-action dates are not exercised or silently rescheduled. |
| EA06 PENDING | “Rename/update the coursework project, then explicitly mark the parent complete.” | `update_project`, `set_project_status`; explicit remainingMinutes/progress updates, current per-entity versions; completed child and other records unchanged. |
| EA07 PENDING | “Archive that project, then restore it.” | `archive_project` then `restore_project`; archived intermediate readback, restored **active** status, same ID/children/history, +2 versions. Replay/conflict host checks add no effects/model calls. No project hard-delete tool exists. |
| EA08 PENDING | “Create a QA-101 assignment due Nov21 2030, then change only its deadline to Nov22.” | `create_assignment`, `update_project(deadline)`; assignment kind, explicit school/importance3/remaining45/progress fields. Course code is description text, **not** a structured courseId field. Deadline is a date, not an invented event time. |
| EA09 PENDING | “Delete the project named QA duplicate; I haven't said which of the two.” | Two host-owned same-titled projects are seeded through production `saveEntity`; model must `request_clarification(ambiguous_project)` with the exact server question and zero domain changes. “Delete project” means archive; neither may be chosen. There is no invented ambiguous_task reason. |
| EA10 PENDING | “Book a School appointment on Nov14 2030,09:30–10:15 New York, QA room.” | `list_calendars`/events, grounded donor VTIMEZONE, `create_calendar_event`, operation-status readback. Explicit14:30Z–15:15Z, non-recurring single scope; actual HTTP GET/ICS/strong ETag and SQL frozen payload/receipt. `saved/snapshot_pending` is not a refreshed event ID. |
| EA11 PENDING | “Move only that appointment one hour later.” | `get_calendar_series`/current cached ID+ETag, `update_calendar_event`; same UID/TZID, actual10:30–11:15 local ICS, no other resource changed. After save, explicit synthetic sync supplies the new cache identity. |
| EA12 PENDING | “Cancel only that appointment.” | `cancel_calendar_event` single scope; provider resource retained with STATUS:CANCELLED, cache no longer shows it, donor/other resources unchanged. Same-key replay and changed-payload refusal cannot issue another GET/PUT, change the ledger or call the model. |

Successful progress is case-specific, not an assertion that every tool variation
works. This split avoids packing the project update/status/archive/restore cycle
into one request requiring more sequential reads than the native iteration budget.
EA02 still deliberately requires seven ordered tool calls (plus final completion)
inside the existing budget; if the actual model fails, preserve that failure and
leave later cases pending, rather than silently loosening the case or rerunning.

### Available shapes not executed by this capped campaign

| Request family | Schema-grounded behavior / explicit boundary | Current evidence here |
| --- | --- | --- |
| Weekly tasks / occurrences | Weekly template fields and materialized occurrence identity are supported; template completion is refused. This runner seeds one valid template with unknown metadata and requires it untouched. | Sentinel preservation only; recurrence mutation/occurrence journeys PENDING. |
| Preparation / topics | `create_preparation` needs a real cached linked event and valid study start date; relink, update, insert/edit/remove topic have exact IDs/versions and last-topic safeguards. | PENDING; not enough remaining budget for a useful linked preparation journey. |
| Cached mail | `search_inbox` query/account/importantOnly + bounded paging; `get_inbox_message` body continuation. Read-only cache, no send/delete/provider-admin tools. | PENDING; no mail tables or personal accounts are loaded. |
| Cached prices | `list_prices`, service limit1, cached source/offer projections; no shopping or provider-admin mutation. | PENDING; no external price fetch or personal cache is used. |
| Calendar recurrence / all-day / DST | Existing typed scoped recurrence fields and allowlisted clarification questions; named-zone creation requires a grounded donor. | This campaign uses simple timed events only. Recurrence, all-day and model DST interpretation PENDING. |
| Unsupported generic actions | No arbitrary SQL/shell/HTTP/files, mail mutation, hard-delete-project, structured task duration/course metadata, calendar discovery/admin, or model-owned IDs/operation keys. | Explicitly excluded, not replaced by fake generic tools. |
| Timers | Existing browser rendezvous is outside this request. | No timer requests or the former auth-loss probe; it cannot block this calendar phase. |

## What really executes

Actual authenticated HTTP login/cookie/Origin/actions -> fixture `buildApp` /
`TaskActions` / `SqlIntentStore` -> unchanged production `run_action` via the
official Hermes bootstrap -> existing `runtime_loopback.py` / production relay ->
same app callback SDK/correlation/active-capability checks -> real PostgreSQL17 ->
HTTP manual/planner/calendar snapshots plus operation receipts and actual ICS GET.
Requested model is exactly **gpt-6-luna**,36 schemas; one unchanged schema digest
must hold across all successful invocations. This is configured/requested model
evidence, not a second provider-attested served-model certificate. Capabilities
remain private subprocess env/Authorization headers, never argv, prompts or logs.

`JourneyRuntime` now permits a trusted source cap of10(default) or12 only; the
existing timer runner keeps its default10. Production CLI has no new override.
`SyntheticCalendarProvider` accepts2026(default, unchanged existing cases) or2030;
the new fixture donor/coverage are2030. Its resource-level HTTP GET/conditional
PUT server on18535 is real, as are production scoped writer, ICAL and SQL ledger.
Its resource enumeration/snapshot sync is synthetic—not CalDAV discovery/REPORT,
public TLS, real credentials/provider interoperability or live personal data.

This runner uses **HTTP, not a browser**; it does not claim rendered composer/UI
acceptance. Chromium/frontend dist are not needed to execute it. It reuses only
the installed backend Node dependencies and the already verified official Hermes
bootstrap/profile. No new profile, configuration, package or framework is added.

## Strict isolation and parent setup

Before any DB write/listener: exact two approval values, bounded argv, no PG*/
DATABASE_URL/NODE_OPTIONS/NODE_EXTRA_CA_CERTS defaults; explicit127.0.0.1:18533,
fresh `dcc_qa_*` DB and literal synthetic password (no `.pgpass` discovery).
Actual `host(inet_server_addr())`, port, database name and PG major17 are checked.
The existing QA advisory lock is held. Exactly five **public** tables are allowed:
`app_sessions`, `calendar_mutations`, `calendar_sync_state`, `planner_entities`,
`planner_runs`. Data/session/mutation tables must be empty and the default sync /
planner singleton rows untouched. Populated core/timer/previous failed DBs are
refused; no adoption, truncation, destructive cleanup or production migrations.

Parent creates a **new** DB on its already approved isolated cluster, using the
existing `migrate` and `migratePlanner` functions. Example from reviewed tree root,
only after independently checking cluster/forward ownership and target:

```sh
PGPASSFILE=/dev/null PGPASSWORD=synthetic-isolated-qa-only createdb -h 127.0.0.1 -p 18533 -U postgres dcc_qa_everyday_03
node --import ./backend/node_modules/tsx/dist/loader.mjs --input-type=module <<'JS'
import {createRequire} from 'node:module';
const {Pool}=createRequire(new URL('./backend/package.json',import.meta.url))('pg');
const {migrate}=await import('./backend/src/database.ts');
const {migratePlanner}=await import('./backend/src/planner.ts');
const pool=new Pool({host:'127.0.0.1',port:18533,database:'dcc_qa_everyday_03',user:'postgres',password:'synthetic-isolated-qa-only',ssl:false});
try {
 const r=(await pool.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS v")).rows[0];
 if(r.db!=='dcc_qa_everyday_03'||r.host!=='127.0.0.1'||r.port!==18533||r.v<170000||r.v>=180000)throw Error('Wrong isolated target');
 if((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rowCount)throw Error('Not fresh');
 await migrate(pool);await migratePlanner(pool);
} finally {await pool.end();}
JS
```

An SSH local forward must target the LXC's **127.0.0.1:18533**. App18534 and
provider18535 must be free; bind failure is fatal, never permission to kill their
owners. The provider starts only at EA10 so a provider issue cannot preempt P0
task/project evidence. A fresh app/auth scope per case keeps normal production
rate limits enabled without sleeps, while actor/DB receipts stay durable/shared.
Only host fixture writes are the recurrence sentinel before EA01 and two owned
ambiguous projects before EA09; they use existing `saveTasks` / `saveEntity`, not
a fake model writer. Explicit provider GET/ICAL snapshot refresh runs between the
three calendar requests; save receipts remain snapshot_pending and are checked
before refresh. No planner/sync worker or real CalDAV is started.

## Parent checks, diagnostics and run

All new checks/execution are **UNRUN by the source worker**. Inspect first, use
installed dependencies, preserve the relative copied source tree (including
backend/deploy and backend/test/acceptance). Do not import server.ts or load private
`.env`, install anything, change provider config, or start production services.

```sh
npm run check:backend
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/acceptance/everyday-actions-runtime.ts backend/test/mcp/everyday-actions-harness.test.ts
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/mcp/runtime-schemas.test.ts backend/test/mcp/product-operations.test.ts
python3 -m unittest discover -s backend/deploy -p 'test_task_action*.py'
python3 -m unittest discover -s backend/deploy -p 'test_dcc_model_policy.py'
git diff --check
```

Host-only preflight checks the empty actual DB and official launcher without
models, application/provider listeners, migrations or fixture writes; every case
remains PENDING. It leaves that same fresh DB available for the actual campaign:

```sh
DCC_QA_EVERYDAY_APPROVED=synthetic-everyday-actions-model DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model DCC_QA_DATABASE=dcc_qa_everyday_03 DCC_QA_PG_USER=postgres node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/acceptance/everyday-actions-runtime.ts --preflight-only
```

Exactly the same command without `--preflight-only` executes the finite campaign:

```sh
DCC_QA_EVERYDAY_APPROVED=synthetic-everyday-actions-model DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model DCC_QA_DATABASE=dcc_qa_everyday_03 DCC_QA_PG_USER=postgres node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/acceptance/everyday-actions-runtime.ts
```

Each started/completed stage emits sanitized JSON immediately; completion facts
contain HTTP status, authoritative tool result states/codes, row counts, entity
versions/ID hashes, collection version, domain hash, schema evidence, replay
proof and calendar body-hash/ETag where relevant. No prompt, raw model prose,
grant, cookie, nonce, Basic auth or arbitrary exception text is printed. Runtime
stderr stays suppressed. `modelCalls` counts admitted invocation **attempts**;
successful bootstrap/schema evidence is separate, so a pre-model runtime failure
must not be reported as a successful served-model call.

The first failure's stage and bounded code are retained even if cleanup later
fails. Journal result codes/uncertainty and partial DB hashes/counts are collected
best-effort without replacing that failure. Earlier completed cases remain PASS,
current becomes FAIL and later ones PENDING. `runtime_unconfirmed` means the
suppressed production-runtime invocation did not yield verified lifecycle/schema
evidence; it does not invent a provider error explanation. Model prose or an HTTP
200 with uncertain/partial receipts cannot make the case pass. No automatic
model retry, new-key repair, relaunch or fallback is performed.

Final success is emitted **after owned cleanup**, requires12 successful invocation
evidence records and all12 cases PASS. Final consistency also requires49 retained
planner entities (six domain rows,19 operation receipts,12 journals,12 legacy
fences), three calendar mutation ledgers and exactly three conditional provider
PUTs. The task collection ends at version7 with the untouched template, reopened
study task and deleted work tombstone; project/child/assignment versions end5/3/2.
Nonzero exit/FAIL means inspect retained
effects, not rerun until green. No rows/database are removed. Cleanup closes only
this runner's app/provider listeners, child process groups and pool/advisory lock;
parent owns its own PG/tunnel and verifies closed ports. Any later attempt needs
another reviewed empty DB and retains this failed namespace/report. Provider
resources are ephemeral fixture state; successful raw ICS and immutable SQL
payload receipts are asserted before teardown and sanitized hashes remain in the
report. No full265-case completion, live personal integrations or deployment claim.
