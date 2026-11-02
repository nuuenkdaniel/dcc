# Task-only authenticated MCP slice — source, disabled by default

## Implemented boundary

`server.ts` composes ONE TaskActions instance per API process only when
`DCC_TASK_ACTIONS_ENABLED` is exactly `"1"`. Unset and every other value are OFF.
Enabled startup requires the existing Pool, configured browser auth and existing
curator URL/token; missing prerequisites fail closed before listening. The actor is
the source constant `TASK_ACCOUNT_ACTOR`, not user configuration/request data.
With the dependency absent, neither action/callback route is enabled.
The existing `/api/v1/hermes/commands` parser and project/calendar behavior remain
unchanged. No keyword routing or automatic fallback is introduced.

- `POST /api/v1/hermes/task-actions`: existing browser Origin + session checks,
  strict `{key,prompt}`, six requests/minute, 20 KB body. A server-bound TaskActions
  instance admits/starts the durable intent and exposes only list_tasks,
  create_task, set_task_completed. Authenticated text is admission, not a second
  per-payload approval flow. Responses contain backend receipt summaries only.
  A key already owned by the legacy executor conflicts; it is never upgraded or
  silently re-executed through the task route.
- `POST /api/v1/hermes/mcp-task-callback`: **exact method/path exception only**,
  enabled only with the injected instance AND configured browser authentication.
  Requires a separate live 256-bit per-request capability, rejects Cookie/Origin
  headers, and still enforces owner/phase/expiry against the durable journal.
  Query variants/siblings/other methods do not share the exception. Body: 64 KB;
  callback rate: 128/minute/IP; per-capability relay messages: 64. No request body or
  Authorization logging is added; these routes use silent route logging.

Capabilities are issued only after authenticated admission + sole-owner start.
Only SHA-256 verifier keys are kept in the process-local callback map (max 8 active
entries). Capability bytes travel privately in the existing authenticated
backend-to-curator request, then in the action subprocess environment and the MCP
relay subprocess environment, never argv, prompts, model/provider configuration,
tool arguments, SQL rows or browser responses. No persistent secret store is added.
Expiry is at most the existing 120-second intent deadline; abort/finally revoke.
API restart loses capabilities and denies callbacks. An active/uncertain persisted
intent goes receipts-only, never a new model/owner/operation. In-flight work may
finish after cancellation; its late backend receipts remain authoritative.

## Concrete transport and credential/network boundary

Use the existing backend → authenticated private curator bridge hop, unchanged
service bearer. That bearer admits an invocation only; it does NOT authorize MCP
callbacks. Action mode is separately disabled by default on the bridge.

Hermes registers one request-local MCP stdio server (`dcc_task`) launching
`task_action_runtime.py --stdio-proxy`. Its subprocess reads the ephemeral
capability from environment, removes it, then relays SDK JSON-RPC messages through
HTTPS POST to exactly:

`https://dcc.home.captnuu.online/api/v1/hermes/mcp-task-callback`

Host/path are source constants. TLS uses default certificate verification. No
redirects, arbitrary URL, Cookie/Origin forwarding, HTTP retry, SSH/tunnel change,
listener or new service is introduced. This is a narrow stdio-over-POST relay, not
an arbitrary HTTP API or a general/resumable Streamable HTTP server. Backend MCP
initialization, schemas and dispatch are handled by the official SDK. One live
capability permits one initialization; reset/reconnect under a fresh initialization
is denied, not treated as safe model resume.

The native RPC ID is transport correlation, not authority. The controller derives
`call.id = SHA256(owner, typed JSON-RPC ID)` and commits that ID with the frozen
tool/payload/result through SqlIntentStore. Changed messages for the same RPC ID
reject; identical HTTP replays reuse their response. Model `_meta` is discarded
and host correlation injected before SDK dispatch. The owner never comes from
MCP arguments. SDK-discovered create schemas omit id/operationKey; backend injects
them. Service create requires the collection version read from list_tasks; complete
requires the existing task ID and current collection version. No actual provider
native-call-ID or transcript-resume guarantee is asserted.

The standalone agent uses only `mcp-dcc_task`, filtered registration, sampling off,
four native iterations/90 seconds inside the 105-second subprocess and 120-second
backend deadline. It uses the existing daymark-curator profile environment with
the parent-proven `tools.tool_search.enabled: "off"`. It requires exactly three
direct model-facing task schemas, checks snapshots and fails closed on a generic
tool-search bridge. No raw-schema monkeypatch or profile edit is performed here.
All model final content is discarded; only a fixed lifecycle acknowledgment returns
to Node. Backend receipt validation remains the sole source of effect summaries.

## UI scope and activation prerequisites

The compact composer defaults to legacy **Create**. Only authenticated
`GET /api/v1/hermes/capabilities` returning `{taskActions:true}` exposes its adjacent
**Task actions** selector. The public status endpoint does not advertise it; this
reports configuration, not live bridge/provider health. Client selection chooses
an explicit route, never actor/tool capabilities. Submission bodies remain only
`{key,prompt}`.

Browser retry storage persists `{key,prompt,mode,settled}`. Old entries without mode
remain unresolved legacy requests and are not rewritten until an explicit retry.
Attempts are saved before sending. Busy controls are disabled; unresolved attempts
pin mode and make the prompt read-only across reload. Unknown/error/partial-pending
responses never unlock or switch executors. Saved task mode with the flag disabled
is retained and blocked, never sent to the legacy route. An authoritative completed
task summary with zero pending operations permits deliberate edits/mode changes;
these create distinct keys on the next submit. Unchanged requests replay their key.
Completed partial results disclose both saved and failed effects; interrupted
planning remains uncertain even with known saved effects.

Only the exact legacy 422 no-write contract clears retry storage. Task completed
no-effect/rejected receipts remain stored as settled; editing is needed for a fresh
intent. A bare HTTP 200/message is not success. UI refresh requires validated legacy
write receipts or authoritative task `applied` effects (including partial/uncertain
results with known effects). Task callbacks use `onCreated('tasks')`: App refreshes
planner state and emits `dcc-task-actions-applied`, consumed by the existing
conflict-preserving ManualTaskSync. Schedule still listens only to the legacy
`dcc-hermes-created` event, avoiding forced calendar refresh for task-only writes.

The composed bridge is the existing `callCurator`, now accepting an optional caller
signal/deadline without changing legacy defaults (150 seconds, no redirects). Task
composition passes controller cancellation and a 105-second HTTP limit; subprocess
execution remains bounded at 105 seconds, agent budget 90, controller/capability
120. Abort cancels the backend HTTP wait and revokes callbacks; it does not claim to
instantly terminate a remote subprocess or roll back already dispatched writes.

Activation checklist:
- Backend `DCC_TASK_ACTIONS_ENABLED=1` with existing DB/auth/curator prerequisites.
- Hermes bridge `DAYMARK_TASK_ACTIONS_ENABLED=1`; deploy adjacent
  `task_action_launcher.py` AND `task_action_runtime.py` with the bridge.
- Run the metadata-only launcher preflight below. The bridge uses fixed
  `/usr/bin/python3` for the **stdlib-only wrapper**, not for Hermes imports.
  `DAYMARK_TASK_ACTION_PYTHON` is obsolete and is no longer read. Verify supported
  MCP subprocess env forwarding and the existing profile's already-approved
  `tools.tool_search.enabled: "off"` setting (no profile edit here).
- Inspect callback TLS/header routing, per-process affinity and sensitive log
  exclusion; keep all auth/capability guards intact.

The front door must route callbacks to that same process, preserve Authorization,
exclude sensitive headers/bodies from proxy logs, and enforce request time/body
bounds. Multi-worker routing without affinity fails closed; it is not supported by
a hidden distributed grant store.

Bridge activation configuration: `DAYMARK_TASK_ACTIONS_ENABLED=1` only (default OFF).
Existing private bridge configuration remains
`HERMES_CURATOR_URL`, `HERMES_CURATOR_TOKEN`, `DAYMARK_CURATOR_TOKEN_FILE`.
Deploy the adjacent action runtime file and verify the selected profile's already
approved tool-search setting. No new persistent callback credential is needed.
Per-run environment names: `DCC_TASK_CALLBACK_CAPABILITY`,
`DCC_TASK_CALLBACK_EXPIRES_AT`. No settings, secrets, profiles or services were
changed/activated by the worker.

### Official launcher bootstrap compatibility

Parent inspection established that plain system Python lacks Hermes dependencies,
and the previously assumed `.hermes/bin/python` does not exist. The successful
synthetic launch preserved the official runtime bootstrap, not a guessed venv path.

The stdlib wrapper resolves `/root/.local/bin/hermes --print-runtime-command --module
runpy`, with stdin disconnected, stdout captured privately and stderr suppressed.
It accepts only a four-string argv shaped `[absolute-python, '-I', '-c', code]`,
bootstrap imports of hermes_bootstrap/runpy, and the terminal call AST exactly
`runpy.run_module('runpy',run_name='__main__',alter_sys=True)`. Quote/spacing variants
of that same AST are accepted; changed arguments, extra statements/trailing content
or other argv shapes fail closed. No arbitrary find/replace, AST unparse of the
bootstrap, monkeypatch, dependency install or auth-file search is used.

Only that validated terminal statement is replaced with the fixed stdlib fragment
`import sys; sys.argv.pop(0); runpy.run_path(sys.argv[0],run_name='__main__')`.
All preceding bootstrap bytes/argv prefix are retained, and the fixed adjacent task
runtime path is appended as an argv element (never interpolated into Python code).
`os.execv` inherits the original private environment and untouched prompt stdin.
Resolved argv/env are never logged. Resolver time is inside the existing 105-second
subprocess limit; failure is unconfirmed, never a parser fallback or automatic retry.

The MCP proxy subprocess still uses `sys.executable`: its `--stdio-proxy` branch
imports only stdlib, so it does not need Hermes bootstrap/dependencies. Do not use
`--run-module runpy /path/to/script`: runpy's CLI interprets that argument as a module,
and the parent verified that invocation fails.

Parent-only preflight on Hermes after placing the reviewed adjacent source files:

```sh
HERMES_HOME=/root/.hermes/profiles/daymark-curator /usr/bin/python3 /root/.local/share/daymark/task_action_launcher.py --preflight
```

This prints only `runtime_ready`/`runtime_unavailable` JSON status. Ready means argv
template/executable/script metadata validated, **not** bootstrap/model execution or
live DCC acceptance. It never executes the returned bootstrap or reads prompt stdin.
The bridge invokes the wrapper through system Python, so direct executable mode is
not required; its shebang also supports normal parent-managed executable deployment.

## Parent-owned checks (unrun by worker)

```sh
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/mcp/task-actions.test.ts
node --import ./backend/node_modules/tsx/dist/loader.mjs --test backend/test/task-composition.test.ts backend/test/curator-cancellation.test.ts
npm --prefix frontend run test -- src/TellHermes.test.tsx src/ManualTaskSync.test.tsx
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_task_action_launcher.py'
python3 -c "import ast,pathlib; [ast.parse(pathlib.Path(p).read_text(),filename=p) for p in ('backend/deploy/task_action_launcher.py','backend/deploy/task_action_runtime.py','backend/deploy/curator_bridge.py')]"
npm --prefix backend run test:mcp
npm run check:backend
npm --prefix frontend run check
git diff --check
```

Tests use synthetic SQL, injected private bridge execution and Fastify injection
with real SDK client/server protocol calls. They do not prove PostgreSQL isolation,
live TLS/proxy/header routing, installed MCP env forwarding or production acceptance.
Parent must verify those runtime boundaries before any activation/live action.

Parent-reported broad Python discovery also encounters the preexisting unrelated
`test_mail_connector` StopIteration: the Hermes-only
`/root/.local/share/daymark/mail-venv` is absent on Arch. This is not a task feature
failure; use the focused task/probe test patterns here, without installing mail deps
or changing that unrelated fixture as part of this slice.
