# Host-owned resolved task checklists

`RequestController` executes a valid, bound, immutable `create_tasks` guard only
after obtaining a fresh owner claim. Contradictory, unbound, clarification,
read-only and generic requests keep the existing runner path. Interpretation,
authenticated admission, legacy fencing and tool capabilities are unchanged.

The lane shares the SDK adapter's guarded dispatch function: durable reservation
before Dispatcher/service execution, then durable journal result. Every goal
reads the actual global task collection version again; returned item text never
selects an operation. The small fixed date window is a version-only projection,
not a date interpretation. Titles/dates come exclusively from the stored guard.
IDs and operation keys remain derived by `reserveIntentCall`.

One host round, two admitted calls per goal, at most eight calls/four writes;
existing 4-round/12-call/4-write/120-second bounds are not increased. Before
finishing, every goal must have a distinct applied create and matching persisted
receipt/target inspection. Conversation projection independently inspects again.
Conflict, pending/unknown write, failed read or readback, owner loss, cancellation
and expiry stop the sequence. No write retry or queued continuation is added.
Existing active/uncertain/legacy claims remain receipts-only, not upgraded or
resumed. This does not recover earlier partially applied requests or certify
unrelated tools/providers.

## Source and isolated verification

All commands below are verification instructions, not recorded results. These
changes and fixtures are unverified until executed. From the repository root,
using installed dependencies only:

```sh
backend/node_modules/.bin/tsx --test backend/test/mcp/host-checklist.test.ts backend/test/mcp/conversation.test.ts backend/test/mcp/task-actions.test.ts
npm run check:backend
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/acceptance/checklist-persistence.integration.ts backend/test/mcp/host-checklist.test.ts
git diff --check
```

The mock-pool tests prove query/reducer contracts, not PostgreSQL persistence.
`backend/test/acceptance/checklist-persistence.integration.ts` is separately
opt-in. It does **not** load `.env` or default to `DATABASE_URL`. It refuses URL
overrides, nonliteral-loopback addresses, default/service ports, databases not
named `dcc_checklist_test_*`, extra public tables, nonempty entities and an
already-used planner singleton. It verifies the actual connected address/port/
database and holds a session advisory lock. No listener, provider or model runs.
All pool settings are explicit, including a synthetic password (no `.pgpass`
discovery). An unset binding skips the opt-in cases; it is not PG acceptance.

Use an existing isolated PostgreSQL instance on a dedicated loopback port, with
a fresh empty `dcc_checklist_test_green_01` database and synthetic local role.
Provision the following **existing** table definitions separately, on the
independently verified disposable target only; no API/worker startup is needed:

```sql
CREATE TABLE planner_entities(id uuid PRIMARY KEY,kind text NOT NULL,version integer NOT NULL DEFAULT 1,data jsonb NOT NULL);
CREATE TABLE planner_runs(id integer PRIMARY KEY CHECK(id=1),day text,last_success timestamptz,error text,summary text,requested boolean NOT NULL DEFAULT false,next_attempt timestamptz NOT NULL DEFAULT now());
INSERT INTO planner_runs(id) VALUES(1);
```

Example launch (substitute only a reviewed isolated endpoint/role):

```sh
DCC_CHECKLIST_TEST_DATABASE_URL='postgresql://postgres:synthetic-checklist-only@127.0.0.1:18533/dcc_checklist_test_green_01' backend/node_modules/.bin/tsx --test --test-concurrency=1 backend/test/acceptance/checklist-persistence.integration.ts
```

The suite retains evidence; it does no DDL, deletes or cleanup. Use a fresh DB
for every campaign, even after failure. The three-goal regression uses actual
TaskActions, authenticated Fastify injection, Conversations, SqlIntentStore,
Dispatcher and ServiceTransport against PG. Its bridge throws if called and
must have invocation count zero. Other real-PG cases cover one/four goals,
concurrent starts/reload, stale version, interruption after committed write two,
unknown reservation, persisted readback mismatch and retained external fallback.
Prior synthetic tasks/entities and the planner singleton must remain unchanged.
Faults are test-local injections around real service calls, not mocked success
responses or production recovery hooks. No tests claim live integration proof.

## RED against baseline without changing the working checkout

Create a new, unused scratch directory under `$HOME/.cache/` (example unique
name: `dcc-checklist-red-744ccb5-example-01`; do not recreate an existing archive). Archive baseline
`744ccb53a7c564e12225c36e0fd86ecedc496751` there, copy only the two new fixtures,
and link the already installed dependency directory. No reset/stash/source swap
in the working checkout is needed:

```sh
mkdir "$HOME/.cache/dcc-checklist-red-744ccb5-example-01"
git archive 744ccb53a7c564e12225c36e0fd86ecedc496751 backend | tar -x -C "$HOME/.cache/dcc-checklist-red-744ccb5-example-01"
cp backend/test/mcp/host-checklist.test.ts "$HOME/.cache/dcc-checklist-red-744ccb5-example-01/backend/test/mcp/"
cp backend/test/acceptance/checklist-persistence.integration.ts "$HOME/.cache/dcc-checklist-red-744ccb5-example-01/backend/test/acceptance/"
ln -s "$(pwd)/backend/node_modules" "$HOME/.cache/dcc-checklist-red-744ccb5-example-01/backend/node_modules"
backend/node_modules/.bin/tsx --test --test-name-pattern='host checklist completes three guarded writes' "$HOME/.cache/dcc-checklist-red-744ccb5-example-01/backend/test/mcp/host-checklist.test.ts"
```

For real-PG RED, separately provision fresh `dcc_checklist_test_red_01` with the
same two tables, then run the unmodified new HTTP regression against that
archived production source:

```sh
DCC_CHECKLIST_TEST_DATABASE_URL='postgresql://postgres:synthetic-checklist-only@127.0.0.1:18533/dcc_checklist_test_red_01' backend/node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='host checklist persists three tasks without external bridge' "$HOME/.cache/dcc-checklist-red-744ccb5-example-01/backend/test/acceptance/checklist-persistence.integration.ts"
```

Baseline is expected to invoke the failing external stub and fail the regression;
the source repair is expected to persist exactly three tasks without invoking it.
Those are test expectations, not executed RED/GREEN claims.
