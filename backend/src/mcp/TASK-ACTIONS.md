# Authenticated action relay and compatibility

The filename is retained for the original task-only rollout. The unified product
path is now `/api/v1/hermes/actions`; the original `/api/v1/hermes/task-actions`
remains three-tool compatibility. See README.md for exact tools and DEPLOYMENT.md
for the operation/callsite inventory and explicit remaining acceptance gaps.

## Auth and limits

Both admission routes require existing exact Origin and authenticated session,
strict `{key,prompt}` JSON, 20 KB bodies and six requests/minute. The source account
actor and tool policy never come from browser/model JSON.
Product discovery uses `/api/v1/hermes/action-capabilities`; the old task discovery
endpoint keeps its exact `{taskActions}` shape for older strict browser clients.

The callback remains exactly:
`https://dcc.home.captnuu.online/api/v1/hermes/mcp-task-callback`.
Only its exact POST path receives the independent capability auth exception.
Cookie/Origin headers reject; query/sibling/method variants receive no exception.
Capabilities are per-owner ephemeral 256-bit values with hashed map keys, at most
eight active entries and a 120-second deadline. Abort/finally revoke. Callbacks have
64 KB bodies, 128/minute/IP rate bounds and 64 messages/capability. Intent limits
remain four rounds, twelve calls and four writes. Routes have silent logging.

Capabilities travel privately through the authenticated existing bridge, subprocess
environment and fixed HTTPS Authorization header. They never enter model prompts,
provider configuration, argv, SQL or browser receipts. The relay uses TLS defaults,
no cookies, redirects, arbitrary destinations or automatic HTTP retries. Model
metadata is replaced with owner-bound typed RPC correlation before SDK dispatch.

## Bootstrap and activation

- Backend: exact `DCC_TASK_ACTIONS_ENABLED=1`, existing DB/auth/curator prerequisites.
- Bridge: exact `DAYMARK_TASK_ACTIONS_ENABLED=1` for both task/product action modes.
- Deploy adjacent `curator_bridge.py`, `task_action_launcher.py`,
  `task_action_runtime.py` and `read_context_runtime.py`.
  `DAYMARK_TASK_ACTION_PYTHON` remains obsolete.
- Keep the existing profile's supported direct tool schemas; runtime fails closed
  on generic tool-search wrappers or any changed selected schema/name set.
- One API process must receive callbacks; preserve Authorization and exclude
  sensitive bodies/headers from proxy logs. No hidden distributed store is provided.

System Python runs only the stdlib launcher. It asks the fixed official Hermes
launcher for `--print-runtime-command --module runpy`, validates a four-string
`[absolute-python, '-I', '-c', code]` argv and the terminal runpy-call AST, preserves
the bootstrap prefix, substitutes the fixed run_path fragment and execv's the
adjacent runtime. Changed launcher shape fails closed. No runtime argv/env is logged.
The stdio proxy imports only stdlib and can use sys.executable without bootstrap.

Metadata-only preflight on the runtime host:

```sh
HERMES_HOME=/root/.hermes/profiles/daymark-curator /usr/bin/python3 /root/.local/share/daymark/task_action_launcher.py --preflight
```

`runtime_ready` means template/executable/script metadata validated, not model or
integration acceptance. No prompt is consumed or bootstrap executed in preflight.
Product execution permits eight native iterations (legacy tasks retain four),
within 90 seconds and the unchanged twelve-call/four-write limits. The bridge
subprocess and HTTP wait remain bounded by 105 seconds, and the controller by 120 seconds.
Read-context helpers expose exactly read_context/submit_proposal, permit four
iterations/90 seconds, and receive no product capability. Their request-local files
contain only supplied context/proposals, are mode-private, and are removed on cleanup.

## Retry and UI truth

Fresh requests use product-v1 with no selector. Old mode-less/legacy/task storage
remains pinned until an authoritative receipt; catalog changes never upgrade an
unresolved intent. Interrupted planning stays uncertain even after known receipts
resolve, because fulfillment is unknown. The runtime never falls back to the parser.

Validated task/project effects refresh their domains. Calendar `saved` triggers its
own refresh and reports snapshot confirmation pending. Sanitized backend read
results are displayed under compact disclosure; model prose never proves a write.
Ordinary browser/Android routes retain their original contracts.

Focused/full checks are listed in README.md. Broad Python discovery may encounter
the unrelated mail fixture's absent Hermes-only mail-venv on Arch; this is not an
action-feature result. Source/fake checks do not establish live SQL/proxy/provider
behavior, and the extended source pass must be verified before publication.
