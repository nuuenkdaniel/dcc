# Opt-in authenticated runtime seam — parent checkpoint recorded

Parent has since executed the core copied snapshot: two seeds/six production
model calls/119 assertions PASS, 36 unchanged schemas, 25 retained rows and owned
ports closed. Its sole snapshot source correction, `host(inet_server_addr())`,
is now upstream; an earlier address-display guard failure used zero model calls
and remains a recorded failed attempt. This does not certify later source edits.
The new, separate browser timer/calendar campaign is **UNRUN**; see
[TIMER-CALENDAR.md](TIMER-CALENDAR.md). Full matrix statuses remain pending.

Parent review and explicit execution approval are required. This is **not** in
`npm test`, `check`, `test:mcp`, or the integration-test glob. Importing the runner
executes it, but without the exact approval below it exits before DB/listeners.
Use the freshly reviewed source tree, including `backend/deploy/` and
`backend/test/acceptance/`; do not mix deployed old runtime files with new tests.

## What it executes

Two fixed campaigns, seeds **20261105 / 20261106**, no retries. Each makes three
real model invocations: standalone task create+complete with version/readback;
assignment creation/readback; missing-target typed clarification with no domain
delta. Exactly six invocations maximum, each using production's eight native
iterations, 90-second budget, twelve-call/four-write backend limits. Any failure
stops the run; do not retry automatically or silently switch models/adapters.

Actual loopback HTTP login/cookie/Origin/actions -> `TaskActions` ->
`SqlIntentStore` -> official-bootstrapped production `run_action` -> actual MCP
subprocess -> production `relay` -> **same app's** authenticated callback/SDK ->
real PostgreSQL17 -> HTTP snapshots and replayed receipt summaries. SQL operation
receipts must match the durable call results. Same-key replay cannot call the
model or change any row; changed payload must return 409. Unauthenticated,
wrong-Origin and missing-capability requests cannot change any row. An additional
**host-only, no-model** request advances the fixture's verification clock beyond
an active grant's expiry and requires HTTP403 with no tool/domain effect; it does
not sleep, wait out a real deadline, or change production clocks.

The bridge uses the same `HERMES_HOME` and cwd as `curator_bridge.py`:
`/root/.hermes/profiles/daymark-curator`. `/usr/bin/python3` runs only the stdlib
adapter. `task_action_launcher.resolve_runtime()` obtains the installed official
interpreter/bootstrap; `runtime_command()` validates and preserves its prefix.
Only its final script argument is replaced by the reviewed QA entrypoint. No
guessed Hermes interpreter, fake model runner, profile edit or alternate loop.
Exact `gpt-6-luna` comes from production shared policy, with no new fallback.
Evidence reports the constructor's requested model and an unchanged real schema
snapshot hash/count (36), **not a separate provider-attested served-model ID**.

## Trusted transport injection

`run_action(..., test_stdio_proxy=...)` accepts only the resolved checked-in
`backend/test/acceptance/runtime_loopback.py` path. Production `main()` never
passes that keyword. No URL/CLI/env override is added. Defaults still launch
production `--stdio-proxy` with fixed verified HTTPS hostname/path/port443.
The test MCP subprocess calls production `relay()` with its existing local
connection-factory injection, pinned to **HTTP 127.0.0.1:18534**, same callback path.
Correlation, schemas, response-ID checks, active-owner checks and capabilities
are unchanged. Grants travel only in private subprocess environment and the
Authorization header, never argv/prompt/diagnostics. This proves neither public
TLS/Caddy/DNS nor a browser timer ACK nor live calendar/mail integrations.

## Parent prerequisites and setup

On the approved native LXC, parent starts only the previously approved isolated
PG17 cluster at **127.0.0.1:18533**. Do not start the production backend/worker,
load private `.env`, install packages, reroute production services, or touch port
3001. Port18534 must be free; binding failure is fatal, not permission to kill
its owner. Installed Node22/dependencies and the official Hermes bootstrap must
already work. Run in a parent-controlled environment without `PG*`,
`DATABASE_URL`, `NODE_OPTIONS` or `NODE_EXTRA_CA_CERTS`. The runner refuses them.
It passes an explicit **synthetic** DB password rather than discovering `.pgpass`.
The existing disposable cluster must already permit the chosen local test role
(e.g. its isolated trust setup); do not change production authentication.

Use a **fresh dedicated empty** `dcc_qa_*` database, not the populated SQL
checkpoint. Runner performs no migration/DDL, deletes, truncates or DB creation.
Before any app writes it checks actual current database, server address/port,
PG major17, the two expected tables and empty `planner_entities`; only the empty
default `planner_runs` singleton is permitted. A session advisory lock excludes
another copy of this runner. This conservative empty-only policy intentionally
refuses even prior owned QA rows; keep failed evidence and use a new reviewed DB
for a new finite campaign. Endpoint metadata alone is never accepted as proof.

Example **parent-only** provisioning, after inspecting the isolated target and
approving the new disposable database. These commands are not worker checks:

```sh
createdb -h 127.0.0.1 -p 18533 -U postgres dcc_qa_runtime_seam_01
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 18533 -U postgres -d dcc_qa_runtime_seam_01 <<'SQL'
CREATE TABLE planner_entities(id uuid PRIMARY KEY,kind text NOT NULL,version integer NOT NULL DEFAULT 1,data jsonb NOT NULL);
CREATE TABLE planner_runs(id integer PRIMARY KEY CHECK(id=1),day text,last_success timestamptz,error text,summary text,requested boolean NOT NULL DEFAULT false,next_attempt timestamptz NOT NULL DEFAULT now());
INSERT INTO planner_runs(id) VALUES(1);
SQL
```

These are the existing `migratePlanner` table definitions, not new production
migrations. Parent must verify the `createdb`/psql target independently before
running DDL. Substitute only an already approved isolated role/database name.

## Exact checks/run (repository root, parent only)

Source-only gates first; the acceptance test is additionally typechecked because
ordinary backend `tsconfig` includes only `src/`:

```sh
npm --prefix frontend run check
npm run check:backend
python3 -m unittest discover -s backend/deploy -p 'test_task_action*.py'
python3 -m unittest discover -s backend/deploy -p 'test_dcc_model_policy.py'
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/acceptance/authenticated-runtime.ts
git diff --check
```

Browser gate (existing parent-owned Vite fixture; all API responses mocked):

```sh
npm --prefix frontend run test:e2e -- --workers=1 e2e/undo-auth.spec.ts e2e/undo-races.spec.ts
```

Real opt-in run, after independent seam review and isolated-target verification:

```sh
DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model DCC_QA_DATABASE=dcc_qa_runtime_seam_01 DCC_QA_PG_USER=postgres node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/acceptance/authenticated-runtime.ts
```

One sanitized JSON result goes to stdout: fixed stage/seed, assertion/model call
counts and on success schema evidence/retained row count. Runtime stderr is
discarded and arbitrary exceptions/bodies are never printed. Nonzero exit or
`status:failed` means **no acceptance**; retained partial effects must be reviewed,
not hidden by another run. `status:passed` requires exactly 25 synthetic rows,
including eight durable request journals plus eight fences, six operation receipts, two
assignments and one task collection with two completed tasks.

## Cleanup and remaining evidence

The runner closes only its own app, PG pool/advisory lock, and process groups
created by its subprocess spawns. SIGINT/SIGTERM request bounded cancellation.
Rows/database are deliberately retained; no cleanup targets are inferred from
names. Parent inspects the known disposable DB, owns any separately approved DB
removal, stops its own QA cluster, and verifies both ports closed. Do not print
raw profile/provider logs, cookie headers or capabilities during troubleshooting.

The parent-executed core checkpoint is recorded above; the source worker ran no
checks or models. The new guard regression and timer/calendar journey checks are
**unrun**. All **265 full-matrix cases stay pending** (35 active tools; prices retired); the six core model
invocations are a first integrated checkpoint, not full reliability,
production/public-TLS acceptance or deployment.

## Clarification/receipt campaign (parent only)

**UNRUN for this feature.** Reuse the same reviewed `authenticated-runtime.ts`,
official launcher, MCP relay, loopback HTTP fixture and isolated PG17 pool above;
this is not a second harness. Review/typecheck the current source first, including
the TS2367 correction in conversation preparation. The earlier core campaign's
PASS does not certify this campaign or the new web/native clients.

Select **one** finite campaign per explicitly approved run:

- `DCC_QA_RUNTIME_CAMPAIGN=clarification`: CSE354 three-chunk original → real typed
  question → named answer (`Lectures, practice problems, and review`) → expected
  three tasks → operation receipts + SQL and HTTP readback → complete 3/3.
- `DCC_QA_RUNTIME_CAMPAIGN=clarification-general`: same journey with the explicit
  answer `just general chunks`, verifying three course-prefixed generic labels.

Each selection also executes one clear three-named-task request without a question.
Exactly **three model invocations are planned**, with a hard guard of **at most
four**, no automatic retries, no looping both variants, and stop on first failure.
Running both selections would be separate parent approvals/new disposable DBs,
not permission for six calls in a single campaign. Same-key replay, changed answer,
concurrent competing child keys, wrong client/owner, unauthenticated and wrong-Origin
turns must cause no extra model invocation or duplicate effect. NY-day assertions
allow only the execution-admission date (or the legitimate midnight boundary),
not a frozen prior conversation date. The supported checklist still contains
exactly three titles; model prose cannot underdeclare it as two.

Use a **new empty** `dcc_qa_*` database on the independently verified isolated
`127.0.0.1:18533` PG17 cluster. The same two existing tables must be its only
application tables: `planner_entities` empty, `planner_runs` one empty default
singleton. The definitions/provisioning above are the existing planner schema,
not a feature migration. The runner performs no DDL, DB creation, deletion or
truncation. No private `.env`, production DB, normal server/worker, personal
records, mail/calendar/provider adapter, installation or profile edit is allowed.
Only the explicitly approved real model transport uses its existing official
bootstrap; all domain data and endpoints are isolated synthetic fixtures.

Parent-only commands after source review and isolated-target approval:

```sh
npm --prefix frontend run check
npm run check:backend
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/acceptance/authenticated-runtime.ts
npm --prefix frontend run test:e2e -- --workers=1 e2e/hermes-conversation.spec.ts
git diff --check
```

With the same environment refusals, synthetic role/password and approved port
18534 ownership as the core guide:

```sh
DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model DCC_QA_RUNTIME_CAMPAIGN=clarification DCC_QA_DATABASE=dcc_qa_clarification_01 DCC_QA_PG_USER=postgres node --import ./backend/node_modules/tsx/dist/loader.mjs backend/test/acceptance/authenticated-runtime.ts
```

Do not execute the generic variant automatically; if separately approved, use
`clarification-general` and a different reviewed empty database. Success requires
**16 retained rows**: three request journals + three legacy fences, six operation
receipts, one task collection containing six distinct tasks, two closed compact
conversation records, and one owner/client slot. Closed conversation rows must
contain no original/prompt/answer transcript. Saved task IDs/titles/dates must match
the receipts and HTTP snapshot exactly. The output reports selected campaign,
stage/seed, assertion/model counts, requested-model/schema evidence and retained
row count; it does not print raw prompts, cookies, capabilities or exceptions.

Failures retain all partial rows for parent inspection. The existing runner closes
only its own listener, pool/advisory lock and spawned process groups. Parent owns
DB cleanup, port verification, real Chromium review, safe-home Android build/test
APK compilation, approved disposable-emulator IME/recreation/rotation checks,
APK delivery and LXC deployment. A passing real runner is not a phone UI, public
TLS, calendar repair or universal natural-language fulfillment claim.
