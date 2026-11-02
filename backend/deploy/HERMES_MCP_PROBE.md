# Isolated Hermes → synthetic MCP compatibility probe

This is **not DCC acceptance**, production transport or an installed-runtime proof.
`hermes_mcp_probe.py` is a standalone process: its cleanup is process-wide. Never
run it inside an existing Hermes agent. No profile edits, credential copying,
`HERMES_HOME`/config overrides, database or calendar provider access are added.

## What can run now

Default mode registers `dcc_probe` using the verified explicit in-memory stdio API,
verifies registry membership/names, reports only a registration count, then shuts MCP down. It never imports AIAgent
or invokes a model. Registration is not proof that a model can invoke the tools.
Registration uses `tools: {include: [list_tasks, create_task, set_task_completed]}`
and `sampling: {enabled: false}`. No other tool or sampling capability is requested.

`--run-synthetic-model` is opt-in and now has the installed-source bindings:

1. `verified_surface` checks every returned name with
   `tools.registry.registry.get_toolset_for_tool(name) == 'mcp-dcc_probe'`.
   It requires exactly three distinct tools, one common probe namespace prefix,
   and the exact three original tool suffixes. Names come from registration, not
   a model-proposed name. Agent construction enables only `mcp-dcc_probe`.
2. The parent verified that constructor `agent.tools` uses progressive disclosure:
   `tool_search`, `tool_describe`, `tool_call`. The probe does **not** allow that
   generic bridge. After construction, `select_raw_tools` calls the verified
   `model_tools.get_tool_definitions(enabled_toolsets=['mcp-dcc_probe'],
   disabled_toolsets=agent.disabled_toolsets, quiet_mode=True,
   skip_tool_search_assembly=True)`. It validates exactly three raw OpenAI schemas,
   the registered names and registry membership **before** replacing this probe
   agent's `tools` and `valid_tool_names`. This is local to the standalone harness;
   no Hermes runtime source, profile, global selector or default is changed.
   `agent_tool_names` then rechecks the actual list before `run_conversation`.
   Snapshot checks run before the model loop, at tool-start/complete callbacks,
   and after the loop returns. Equal-content object rebuilds pass after strict
   schema/name/registry revalidation and canonical comparison (tool-name order and
   object-key order ignored; schema arrays/content are not rewritten). Real schema
   or name/scope changes fail; no silent re-selection or guessed refresh flag is
   used. Callback failures are sticky even if caught by
   the runtime. These checks do not claim an undocumented pre-provider refresh hook.
3. `completion` binds the positional callback
   `(call_id, tool_name, display_args, result)`. Display arguments must be a dict;
   the synthetic journey requires exact nonsecret fixture arguments, not redacted
   substitutes. The rendered JSON `result` wrapper is decoded, then its inner JSON
   envelope if string-valued. Optional `structuredContent` must match that envelope.
   Errors, prose, duplicate JSON keys, nonfinite values and malformed/inconsistent
   envelopes reject. Only synthetic `applied`/`ok` receipts can reach the verifier.

The parent independently passed discovery with the exact names
`mcp__dcc_probe__list_tasks`, `mcp__dcc_probe__create_task`,
`mcp__dcc_probe__set_task_completed` and toolset `mcp-dcc_probe`. The subsequent
model attempt stopped before `run_conversation` because of the constructor's
progressive-disclosure bridge; no model request was made. The parent supplied the
raw-selector signature and documented `skip_tool_search_assembly` behavior for this
harness-only correction. These bindings also use the parent-supplied installed source: MCP registration's
`mcp-{name}` toolset, agent_init.py's `agent.tools`/`valid_tool_names`,
tool_executor.py's four-argument callback, and mcp_tool_handlers.py's JSON renderer.
There are no remaining placeholder bindings or pending generic API questions.

After parent review, model mode uses the verified AIAgent constructor:
openai-codex / gpt-5.6-luna, max_iterations=6, run_budget_seconds=90, ephemeral
instructions, skipped context/memory/background review, session_db=None, quiet mode.
Existing auth is inherited only through the parent's explicitly approved launch;
the harness does not inspect or copy it. Agent final output is discarded. Passing
requires observed synthetic create version 1, completion version 2, then completed
task readback. No raw prompt, tool output, registry names or exception details are
printed; only safe fixed failure codes, aggregate results and names-only tool
snapshots. Both discovery and model
mode request the filtered catalog with sampling disabled.

## Diagnostic interpretation and compatible runtime direction

Parent's latest bounded attempt failed with `agent_tool_snapshot_changed` after
17 offline tests passed. Source inspection now establishes that
`tools/mcp_tool_agent.py:refresh_agent_mcp_tools` reselects schemas with progressive
assembly, and `_publish_tool_snapshot` can replace a changed name/content set.
One-off raw schema selection is therefore **not established as a stable runtime
integration**. This patch adds diagnostics; it does not force the runtime to freeze.

Failures now retain the **first** diagnostic checkpoint, even if a callback catches
the failure, schemas are restored later, or cleanup also fails:

- `failure_stage`: `before_model`, `during_callback`, `after_loop`; other exceptions
  inside the conversation method report `during_loop`, and cleanup-only failures
  report `cleanup`.
- `run_conversation_entered` and legacy `model_called` are set immediately before
  invoking `run_conversation`. They prove that entry point was invoked, **not** that
  a provider request was sent. No verified provider-send observation hook is added.
- `snapshot_names` / `snapshot_count`: actual `agent.tools` function names at the
  failure checkpoint, capped at 64 bounded identifier-shaped names. Malformed names
  are replaced by `<invalid_tool_name>`. No description, schema body, tool arguments,
  prompt, provider/auth field, result text or raw exception text is emitted.
- `schema_changed`: canonical content differs from the installed validated raw
  baseline; `null` means no baseline was installed. Thus identical names with
  `true` identifies content changes, while bridge names identify assembly changes.
  A valid-name/registry-scope failure can fail even with unchanged schema content.
- `created`, `completed`, `readback_completed` count verified synthetic tool-complete
  receipts only; agent final prose still cannot establish success.

**Recommendation:** use Hermes's supported native progressive-disclosure path for
an eventual compatibility probe, with the existing explicit filtered MCP registration
and `mcp-dcc_probe` toolset. Before enabling its three outer wrapper schemas, verify
from source that both search/describe and `tool_call` dispatch remain constrained to
the registered probe tools, including rejection of direct names from other toolsets.
Wrapper schema names alone do not prove safe dispatch scope. That wrapper change is
**not applied here**: this diagnostic probe still rejects the generic bridge.
No supported process-scoped assembly-disable option has been verified; do not invent
one, use background-review private frozen-snapshot sentinels, or monkeypatch Hermes.
Do the dispatch-scope source review before another model attempt, not blind retries.

## Parent-only commands

Offline fake tests (no Hermes imports, subprocesses or providers):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s backend/deploy -p 'test_hermes_mcp_probe.py'
git diff --check
```

On Hermes, review the script and exact artifact first. Select the **installed Hermes
Python interpreter**, and verify the fixed absolute Node/compiled CLI paths on Arch.
The CLI must be the reviewed build of `backend/src/mcp/cli.ts`, with its matching
installed dependencies—not application startup. For a local artifact instead,
preserve the `/backend/dist/mcp/cli.js` layout and omit `--ssh-host`.
Variables below are parent-selected nonsecret paths/host, not invented executables.

Discovery only, in a new subprocess:

```sh
timeout -k 5s 45s "$HERMES_PYTHON" -B backend/deploy/hermes_mcp_probe.py --node "$ARCH_NODE" --cli-js "$ARCH_CLI_JS" --ssh-host "$ARCH_HOST"
```

The command below is retained for a **later** explicitly approved bounded model
attempt, only after diagnostic/source review resolves the refresh/dispatch scope.
It is not a request to run another model call now:

```sh
timeout -k 5s 115s "$HERMES_PYTHON" -B backend/deploy/hermes_mcp_probe.py --node "$ARCH_NODE" --cli-js "$ARCH_CLI_JS" --ssh-host "$ARCH_HOST" --run-synthetic-model
```

This is a proposed parent-only execution, not a worker-run result. Timeout/failure
is not success; SIGKILL may prevent cleanup, so inspect only probe-owned processes
if the outer timeout fires. Do not retry a model run automatically.

No worker checks or runtime calls were executed for this slice. Mocked-import
tests cover the actual registration config, registry mapping, constructor limits,
raw schema selection/strict counts and membership, rendered callback normalization,
pre-model rejection, snapshot refresh detection and cleanup.
Diagnostics tests also cover checkpoint attribution, semantic-equivalent rebuilds,
sticky callback failures, names-only output and omission of private/error content.
They do not prove the installed runtime journey. That remains parent execution.
