# Next isolated timer/calendar campaign — source UNRUN

Separate executable: `timer-calendar-runtime.ts`. The core 25-row runner changes
only its parent-proven `host(inet_server_addr())` query. No normal production
callback/CLI override, new dependency, profile edit or production migration.

## Budget and evidence

Seeds **20261105 / 20261106**, five model requests each: **ten maximum**, stop at
first failure, no automatic retry. Same exact production `gpt-6-luna`, official
bootstrap, 36 immutable tool schemas, eight native iterations / 90 seconds /
twelve calls / four writes per invocation. `journey-runtime.ts` invokes the
existing reviewed `runtime_loopback.py`; it does not implement a model loop.

Three real-browser composer requests per seed:

1. Read/configure25/5/start default focus/add a named five-minute mini while
   running. Three writes; read snapshots before/after insertion must show the
   same active identity and non-reset elapsed session.
2. Pause/read/resume/read the same session; two writes. Actual browser progress,
   SQL receipts, originating-tab HTTP ACKs and persisted sessionStorage receipts
   must agree. Same-key HTTP replay adds no model call, receipt or timer reset.
3. Remove only that mini, reset, readback; two writes. Reload must retain seven
   exact operation receipts and a paused fresh 25-minute empty-queue view.

The installed frontend Playwright drives **`/usr/bin/chromium`**, headless,
`--no-sandbox --disable-dev-shm-usage`, a fresh isolated browser context, no user
profile or browser download. It uses the actual reviewed `frontend/dist` at the
app's same origin18534. Static delivery allows only named SPA routes and bounded
compiled assets; traversal, private files and symlinks escaping the artifact are
refused. A digest covers index plus sorted asset bytes. Review/build/copy that
artifact from the exact source before execution; a digest is evidence of bytes,
not automatic proof they came from current source. Browser external-origin
requests are blocked; no fake UI, model route, timer state or successful ACK is
injected. Driver observes existing production polling/ACK requests.

Additional **no-model** deterministic probes: actual clone/opener session copy
must lose the real Web Lock and cannot reset/write its copied clock; manual
pause/frozen-clock/resume interleaves with RPC; missing tab binding returns
rejected receipts rather than fake applied. The auth-loss probe holds only an
actual backend timer-command HTTP response, revokes the real login cookie, then
uses production AuthGate's focus/session recheck to unmount before delivery.
No direct `dcc-auth-required` event or synthetic successful ACK is substituted.
It requires unchanged timer/version/receipts after logout. This is auth loss for
the fixture account, **not a demonstrated multi-account timer migration test**.
Controlled polling checks >=600ms elapsed within a five-second window and a
1500ms scheduling tolerance; a paused timer is checked across >=800ms measured
wall time. These are not blind sleeps or retry-until-success. The original
matrix's 65-second workflow remains a separate pending acceptance case.

Two calendar model requests per seed:

1. List exact School (seedA) / Work (seedB), read cached donor identity; create
   weekly 09:00-10:00 America/New_York from Nov2 2026, COUNT4, explicit RDATE Nov4
   and EXDATE Nov23. VTIMEZONE comes from a real fixture resource GET. Preserve
   `saved/snapshot_pending`; the initially stale cache must not magically acquire
   a new event identity. Provider ICS/ETag and PG frozen payload/receipt prove save.
2. Move only Nov9's occurrence to10:00-11:00; cancel only Nov16's occurrence.
   Read master and current cached IDs/ETags again between writes. UID, RRULE,
   RDATE, EXDATE, VTIMEZONE and unrelated occurrences must survive. Same-key replay
   cannot PUT, change a ledger row, or invoke the model again.

`calendar-provider.ts` is a bounded HTTP GET/conditional PUT resource server at
**127.0.0.1:18535**, with synthetic literal Basic auth, strong body-derived ETags,
If-None-Match create and If-Match update. It is **not a full DAV discovery,
PROPFIND/REPORT, TLS, authentication interoperability, or real-provider test**.
The production scoped writer and ICAL parsing/building are real, as are all SQL
ledger writes and HTTP payloads. The fixture enumerates its own finite resources,
GETs each over HTTP, expands them using ICAL and the production occurrence parser,
then explicitly updates the isolated snapshot. After the initial stale-cache
assertion, this separate synthetic sync runs after each verified save so the
second write can legitimately use the new ETag; writer success values are never
fabricated. The returned receipt still says snapshot_pending. This does not
certify the production synchronization scheduler or live CalDAV expansion.

Deterministic stale-ETag probe alters only an owned synthetic resource before
calling the production writer; it must return revision_mismatch with no PUT or
overwrite. Pure regressions cover conditional HTTP semantics, actual ICS
expansion/exceptions, timed-recurring to all-day refusal, exact DST gap/fold
question envelopes, static bounds and the eleventh-call refusal. **DST model
interpretation and successful all-day creation remain pending**; envelopes alone
are not evidence the model can resolve ambiguous local time. Trusted synthetic
VTIMEZONE is the same explicit modern US rule fixture used by recurrence tests,
not personal data or a claim about historical timezone correctness.

## Parent setup (review before any execution)

Use the existing approved PG17 cluster at loopback18533 and a **new empty**
`dcc_qa_*` database, never the populated core/SQL checkpoint DB. A forward must
target the LXC's **127.0.0.1:18533**, preserving the server-address guard. New
runner permits exactly the public tables from existing `migrate` +
`migratePlanner`: app_sessions, calendar_mutations, calendar_sync_state,
planner_entities, planner_runs. Before the first snapshot write it queries actual
database/host/port/version, acquires the same QA advisory lock, requires empty
data/session/mutation tables and untouched default snapshot/planner singletons.
It does not create schemas, migrate, truncate, adopt old rows or delete anything.

Parent provisions the disposable DB only after independently checking its target.
From repository root, an example using existing migration functions (not
server.ts, dotenv or production startup):

```sh
PGPASSFILE=/dev/null PGPASSWORD=synthetic-isolated-qa-only createdb -h 127.0.0.1 -p 18533 -U postgres dcc_qa_journeys_01
node --import ./backend/node_modules/tsx/dist/loader.mjs --input-type=module <<'JS'
import {createRequire} from 'node:module';
const {Pool}=createRequire(new URL('./backend/package.json',import.meta.url))('pg');
const {migrate}=await import('./backend/src/database.ts');
const {migratePlanner}=await import('./backend/src/planner.ts');
const p=new Pool({host:'127.0.0.1',port:18533,database:'dcc_qa_journeys_01',user:'postgres',password:'synthetic-isolated-qa-only',ssl:false});
try {
 const r=(await p.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS v")).rows[0];
 if(r.db!=='dcc_qa_journeys_01'||r.host!=='127.0.0.1'||r.port!==18533||r.v<170000||r.v>=180000)throw Error('Wrong isolated target');
 if((await p.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount)throw Error('Not fresh');
 await migrate(p);await migratePlanner(p);
} finally {await p.end();}
JS
```

No installs, private `.env`/credential discovery, production migrations/services,
DNS/Caddy/certificate changes, or port3001 use. Existing isolated role/trust must
already work. Same fixed Hermes profile/bootstrap as the core campaign; provider
execution is parent-owned. Both ports18534/18535 must be free. Bind failure is
fatal, never authorization to kill another owner. Copy the reviewed full source,
installed backend and frontend dependencies and current frontend/dist; keep the
relative tree intact. No arbitrary static directory environment override exists.

## Exact parent checks and run (all new checks UNRUN by worker)

```sh
npm --prefix frontend run check
npm run check:backend
python3 -m unittest discover -s backend/deploy -p 'test_task_action*.py'
python3 -m unittest discover -s backend/deploy -p 'test_dcc_model_policy.py'
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/acceptance/timer-calendar-runtime.ts backend/test/mcp/acceptance-journey-fixtures.test.ts
git diff --check
```

No-model checks must pass and the new seam must be independently reviewed first.
Explicit execution from reviewed snapshot root, without ambient PG*/DATABASE_URL/
NODE_OPTIONS/NODE_EXTRA_CA_CERTS (same refusal as core):

```sh
DCC_QA_JOURNEYS_APPROVED=synthetic-browser-calendar-model DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model DCC_QA_DATABASE=dcc_qa_journeys_01 DCC_QA_PG_USER=postgres node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/acceptance/timer-calendar-runtime.ts
```

Output is fixed stage/seed/counts, schema/artifact hashes and per-phase row/PUT,
timer version/receipt count and synthetic provider body-hash/ETag evidence. Failure
also retains up to eight synthetic resource hashes and eight conditional-PUT
metadata entries (never bodies) in the diagnostic JSON. No capabilities, cookies, Basic auth, nonce, prompt, raw browser,
provider or runtime exceptions are printed. Exactly ten calls and six actual
successful provider PUTs are required for success; no full-matrix status changes.
Rows and partial failure effects are retained for parent inspection. Provider
resources exist only inside this owned fixture process; successful ICS structure,
HTTP conditions, hashes and ledger checks are asserted before teardown.

Cleanup closes only created browser contexts/processes, app/provider listeners,
runtime process groups and pool/advisory lock. Parent verifies cleanup independently
including its own SSH forward/PG cluster; the runner never stops them. Failure
means stop and inspect retained namespace; a later attempt needs another fresh
approved DB and must not erase the previous failure. Public TLS/proxy, actual
CalDAV/mail providers and **all 268 full-matrix cases** remain uncertified. No deploy.
