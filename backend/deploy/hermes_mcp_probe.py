"""Standalone, synthetic-only Hermes compatibility probe; no model by default.

Run directly, never import InstalledRuntime into an existing Hermes process.
Installed bindings are source-verified; model execution remains explicit opt-in.
No profiles, credentials, environment or production transport are configured here.
"""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from runpy import run_path
agent_policy = run_path(str(Path(__file__).with_name('dcc_model_policy.py')))['agent_policy']
inference_context = run_path(str(Path(__file__).with_name('dcc_model_policy.py')))['inference_context']


TOOLS = {"list_tasks", "create_task", "set_task_completed"}
TASK = "dcc-hermes-probe-task"
TITLE = "Synthetic Hermes MCP compatibility probe"
CREATE_KEY = "dcc_probe_create_0001"
COMPLETE_KEY = "dcc_probe_complete_0001"
PROMPT = f"""This is an isolated SYNTHETIC MCP compatibility test, not real DCC.
Use only the exposed probe MCP tools. Perform exactly these three tool calls in
order, awaiting each result. Do not use other tools or claim success in prose.
1. create_task: operationKey={CREATE_KEY}, id={TASK}, title={TITLE!r},
   date=2026-11-01. This synthetic create schema has no expectedVersion field.
2. set_task_completed: operationKey={COMPLETE_KEY}, id={TASK},
   expectedVersion=the returned create version, completed=true.
3. list_tasks: from=2026-11-01, to=2026-11-02, limit=10.
Then stop. The host verifies tool receipts and completed readback, not your text.
"""


class ProbeFailure(Exception):
    report = None


FAILURE_CODES = {
    "unsafe_executable_path", "synthetic_artifact_path_required", "unsafe_ssh_host",
    "local_artifact_missing", "standalone_process_required", "registry_tool_allowlist_mismatch",
    "agent_tool_allowlist_mismatch", "agent_tool_snapshot_changed", "agent_tool_schema_malformed",
    "malformed_completion_callback", "malformed_completion_result", "registration_failed",
    "invalid_verified_surface", "synthetic_receipt_journey_failed", "runtime_failure", "cleanup_failed",
}


def canonical_schemas(tools):
    # Ignore object identity, object-key order and outer tool-list order, NOT
    # descriptions/parameters or arbitrary changes inside schema arrays.
    return json.dumps(sorted(tools, key=lambda t: t["function"]["name"]),
                      sort_keys=True, separators=(",", ":"), allow_nan=False)


def failure_report(error, stage="before_model", entered=False, agent=None, baseline=None, trace=None):
    tools = getattr(agent, "tools", None)
    names = []
    if type(tools) is list:
        for tool in tools[:64]:
            function = tool.get("function") if type(tool) is dict else None
            name = function.get("name") if type(function) is dict else None
            # Only bounded identifier-shaped tool names, never repr/str of a
            # malformed schema, description, provider field or callback payload.
            names.append(name if type(name) is str and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,127}", name)
                         else "<invalid_tool_name>")
    changed = None
    if baseline is not None:
        try:
            changed = canonical_schemas(tools) != baseline
        except Exception:
            changed = True
    code = str(error) if type(error) is ProbeFailure else "runtime_failure"
    observed = trace.observed if trace is not None else []
    return {"status": "probe_failed", "journey_pass": False,
            "reason": code if code in FAILURE_CODES else "runtime_failure",
            "failure_stage": stage, "model_called": entered, "run_conversation_entered": entered,
            "snapshot_names": names, "snapshot_count": len(tools) if type(tools) is list else None,
            "schema_changed": changed, "created": observed.count("create_task"),
            "completed": observed.count("set_task_completed"),
            "readback_completed": observed.count("list_tasks")}


def command(node, cli_js, ssh_host=None):
    # SSH joins remote arguments into a command string. Permit no shell syntax,
    # quoting, whitespace or expansion in those parent-reviewed fixed arguments.
    for value in (node, cli_js):
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", value):
            raise ProbeFailure("unsafe_executable_path")
    if Path(node).name != "node" or not cli_js.endswith("/backend/dist/mcp/cli.js"):
        raise ProbeFailure("synthetic_artifact_path_required")
    argv = [node, cli_js, "--synthetic-action-test"]
    if ssh_host:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9@._-]*", ssh_host):
            raise ProbeFailure("unsafe_ssh_host")
        return ["/usr/bin/ssh", "-T", "-oBatchMode=yes", "-oConnectTimeout=10",
                "--", ssh_host, *argv]
    if not Path(node).is_file() or not os.access(node, os.X_OK) or not Path(cli_js).is_file():
        raise ProbeFailure("local_artifact_missing")
    return argv


class Trace:
    """Consumes normalized tool-complete events, never agent final prose."""
    def __init__(self, names):
        self.names = names  # exact installed tool name -> one of TOOLS
        self.observed = []
        self.invalid = False

    def accept(self, name, arguments, envelope):
        if self.invalid:
            return
        try:
            tool = self.names[name]
            if not isinstance(arguments, dict) or not isinstance(envelope, dict):
                raise ValueError()
            if envelope.get("source") != "synthetic":
                raise ValueError()
            result = envelope["result"]
            stage = len(self.observed)
            if stage == 0:
                if tool != "create_task" or arguments != {
                    "operationKey": CREATE_KEY, "id": TASK, "title": TITLE, "date": "2026-11-01"
                } or result != {"state": "applied", "id": TASK, "version": 1}:
                    raise ValueError()
            elif stage == 1:
                if tool != "set_task_completed" or arguments != {
                    "operationKey": COMPLETE_KEY, "id": TASK, "expectedVersion": 1, "completed": True
                } or result != {"state": "applied", "id": TASK, "version": 2}:
                    raise ValueError()
            elif stage == 2:
                if tool != "list_tasks" or arguments != {
                    "from": "2026-11-01", "to": "2026-11-02", "limit": 10
                } or result.get("state") != "ok":
                    raise ValueError()
                data = result["data"]
                items = data["items"]
                if data.get("nextOffset") is not None or len(items) != 1:
                    raise ValueError()
                item = items[0]
                if (item.get("id") != TASK or item.get("completed") is not True
                        or item.get("deleted") is not False or item.get("version") != 2
                        or item.get("title") != TITLE or item.get("date") != "2026-11-01"):
                    raise ValueError()
            else:
                raise ValueError()
            self.observed.append(tool)
        except (KeyError, TypeError, ValueError, AttributeError):
            self.invalid = True


class InstalledRuntime:
    def __init__(self):
        if __name__ != "__main__":
            raise ProbeFailure("standalone_process_required")

    def register(self, argv):
        from tools.mcp_tool_discovery import register_mcp_servers
        # Verified explicit in-memory stdio config. No profile config edits.
        return register_mcp_servers({"dcc_probe": {
            "command": argv[0], "args": argv[1:],
            "tools": {"include": sorted(TOOLS)}, "sampling": {"enabled": False},
        }})

    def verified_surface(self, registered):
        from tools.registry import registry
        if (type(registered) is not list or len(registered) != 3
                or any(type(n) is not str or not n for n in registered)
                or len(set(registered)) != 3):
            raise ProbeFailure("registry_tool_allowlist_mismatch")
        names = {}
        prefixes = set()
        for name in registered:
            if registry.get_toolset_for_tool(name) != "mcp-dcc_probe":
                raise ProbeFailure("registry_tool_allowlist_mismatch")
            # Derive the namespace prefix from the registry-returned name, not
            # by constructing guessed tool names for the model. Require the
            # probe namespace and an unambiguous original tool suffix.
            matches = [tool for tool in TOOLS if name.endswith("_" + tool)]
            if len(matches) != 1:
                raise ProbeFailure("registry_tool_allowlist_mismatch")
            tool = matches[0]
            prefix = name[:-len(tool)]
            if not re.fullmatch(r"mcp(?:__|[_-])dcc_probe_+", prefix):
                raise ProbeFailure("registry_tool_allowlist_mismatch")
            prefixes.add(prefix)
            names[name] = tool
        if len(prefixes) != 1 or set(names.values()) != TOOLS:
            raise ProbeFailure("registry_tool_allowlist_mismatch")
        return ["mcp-dcc_probe"], names

    def create_agent(self, toolsets, callback, start_callback):
        from run_agent import AIAgent
        return AIAgent(
            **agent_policy(), enabled_toolsets=toolsets,
            max_iterations=6, run_budget_seconds=90.0, quiet_mode=True,
            ephemeral_system_prompt=inference_context()+" Only execute the isolated synthetic MCP probe. No other actions.",
            skip_context_files=True, skip_memory=True, skip_background_review=True,
            session_db=None, tool_complete_callback=callback,
            tool_start_callback=start_callback,
        )

    def select_raw_tools(self, agent, names):
        from model_tools import get_tool_definitions
        # Installed agent initialization assembles a progressive-disclosure bridge.
        # This supported raw-schema selector is used only on this standalone probe.
        raw = get_tool_definitions(
            enabled_toolsets=["mcp-dcc_probe"], disabled_toolsets=agent.disabled_toolsets,
            quiet_mode=True, skip_tool_search_assembly=True,
        )
        actual = self.agent_tool_names(SimpleNamespace(tools=raw, valid_tool_names=set(names)))
        if set(actual) != set(names):
            raise ProbeFailure("agent_tool_allowlist_mismatch")
        self.verified_surface(actual)  # Recheck registry membership of raw schemas.
        agent.tools = raw
        agent.valid_tool_names = set(actual)
        schemas = canonical_schemas(raw)

        def check_snapshot():
            # Equal-content rebuilds are safe only after the same strict shape,
            # exact-name and registry checks. Never silently reselect raw tools.
            try:
                actual = self.agent_tool_names(agent)
                if set(actual) != set(names) or canonical_schemas(agent.tools) != schemas:
                    raise ValueError()
                self.verified_surface(actual)
            except Exception:
                raise ProbeFailure("agent_tool_snapshot_changed") from None
        return check_snapshot

    def agent_tool_names(self, agent):
        tools = getattr(agent, "tools", None)  # agent_init.py's actual tool list
        if type(tools) is not list or len(tools) != 3:
            raise ProbeFailure("agent_tool_schema_malformed")
        names = []
        for tool in tools:
            if type(tool) is not dict or set(tool) != {"type", "function"} or tool["type"] != "function":
                raise ProbeFailure("agent_tool_schema_malformed")
            function = tool["function"]
            if (type(function) is not dict
                    or set(function) - {"name", "description", "parameters", "strict"}
                    or type(function.get("name")) is not str or not function["name"]
                    or "description" in function and type(function["description"]) is not str
                    or "strict" in function and type(function["strict"]) is not bool):
                raise ProbeFailure("agent_tool_schema_malformed")
            parameters = function.get("parameters")
            if (type(parameters) is not dict or parameters.get("type") != "object"
                    or type(parameters.get("properties")) is not dict
                    or any(type(k) is not str or type(v) is not dict for k, v in parameters["properties"].items())):
                raise ProbeFailure("agent_tool_schema_malformed")
            required = parameters.get("required", [])
            if (type(required) is not list or any(type(k) is not str for k in required)
                    or len(set(required)) != len(required)
                    or any(k not in parameters["properties"] for k in required)):
                raise ProbeFailure("agent_tool_schema_malformed")
            names.append(function["name"])
        valid = getattr(agent, "valid_tool_names", None)
        if len(set(names)) != 3 or type(valid) is not set or valid != set(names):
            raise ProbeFailure("agent_tool_schema_malformed")
        return names

    def completion(self, args, kwargs):
        # tool_executor.py: callback(call_id, tool_name, display_args, result).
        if kwargs or len(args) != 4:
            raise ProbeFailure("malformed_completion_callback")
        call_id, name, arguments, raw = args
        if (type(call_id) is not str or not call_id or type(name) is not str or not name
                or type(arguments) is not dict or type(raw) is not str):
            raise ProbeFailure("malformed_completion_callback")
        try:
            def unique(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError()
                    value[key] = item
                return value

            def reject_constant(_value):
                raise ValueError()

            def decode(text):
                return json.loads(text, object_pairs_hook=unique, parse_constant=reject_constant)

            outer = decode(raw)
            if type(outer) is not dict or "result" not in outer or set(outer) - {"result", "structuredContent"}:
                raise ValueError()
            envelope = outer["result"]
            if type(envelope) is str:
                envelope = decode(envelope)
            if (type(envelope) is not dict or set(envelope) != {"source", "result"}
                    or envelope["source"] != "synthetic" or type(envelope["result"]) is not dict
                    or envelope["result"].get("state") not in {"ok", "applied"}):
                raise ValueError()
            result = envelope["result"]
            if result["state"] == "applied":
                if (set(result) != {"state", "id", "version"}
                        or type(result["id"]) is not str or not result["id"]
                        or type(result["version"]) is not int or result["version"] < 1):
                    raise ValueError()
            elif set(result) != {"state", "data"} or type(result["data"]) is not dict:
                raise ValueError()
            if "structuredContent" in outer:
                structured = outer["structuredContent"]
                if (type(structured) is not dict
                        or json.dumps(structured, sort_keys=True) != json.dumps(envelope, sort_keys=True)):
                    raise ValueError()
            return name, arguments, envelope
        except (ValueError, TypeError):
            raise ProbeFailure("malformed_completion_result") from None

    def shutdown(self):
        from tools.mcp_tool_lifecycle import shutdown_mcp_servers
        shutdown_mcp_servers(timeout=15.0)


def probe(runtime, argv, run_model=False):
    """runtime is injected only for offline tests; installed hooks are above."""
    agent = None
    stage, entered, baseline, trace, first_failure = "before_model", False, None, None, None

    def remember_failure(error, where):
        nonlocal first_failure
        if first_failure is None:
            first_failure = failure_report(error, where, entered, agent, baseline, trace)

    try:
        registered = runtime.register(argv)
        if not isinstance(registered, list) or not registered or not all(isinstance(n, str) for n in registered):
            raise ProbeFailure("registration_failed")
        toolsets, names = runtime.verified_surface(registered)
        if (not isinstance(toolsets, list) or not toolsets
                or not all(isinstance(n, str) and n for n in toolsets)
                or not isinstance(names, dict) or len(names) != 3
                or set(names.values()) != TOOLS
                or not all(isinstance(n, str) and n for n in names)):
            raise ProbeFailure("invalid_verified_surface")
        if not run_model:
            return {"status": "discovery_only", "model_called": False,
                    "registered_count": len(registered), "journey_pass": False}
        trace = Trace(names)
        snapshot = None

        def check_tools(where):
            if snapshot is not None:
                try:
                    snapshot()
                except Exception as error:
                    trace.invalid = True  # Sticky even if a runtime callback catches it.
                    remember_failure(error, where)
                    raise

        def started(*_args, **_kwargs):
            check_tools("during_callback")

        def completed(*args, **kwargs):
            try:
                check_tools("during_callback")
                trace.accept(*runtime.completion(args, kwargs))
                if trace.invalid:
                    remember_failure(ProbeFailure("synthetic_receipt_journey_failed"), "during_callback")
            except Exception as error:
                trace.invalid = True
                remember_failure(error, "during_callback")

        agent = runtime.create_agent(toolsets, completed, started)
        snapshot = runtime.select_raw_tools(agent, names)
        baseline = canonical_schemas(agent.tools)
        check_tools("before_model")
        actual = runtime.agent_tool_names(agent)
        if not isinstance(actual, list) or len(actual) != 3 or set(actual) != set(names):
            raise ProbeFailure("agent_tool_allowlist_mismatch")
        # This is the ONLY model entry point, after actual agent inspection.
        stage, entered = "during_loop", True
        agent.run_conversation(user_message=PROMPT)
        stage = "after_loop"
        check_tools("after_loop")
        if trace.invalid or trace.observed != ["create_task", "set_task_completed", "list_tasks"]:
            raise ProbeFailure("synthetic_receipt_journey_failed")
        return {"status": "synthetic_compatibility_pass", "model_called": True,
                "run_conversation_entered": True,
                "snapshot_names": runtime.agent_tool_names(agent), "snapshot_count": 3,
                "schema_changed": False,
                "journey_pass": True, "created": 1, "completed": 1, "readback_completed": 1}
    except (Exception, KeyboardInterrupt) as error:
        remember_failure(error, stage)
        failure = error if type(error) is ProbeFailure else ProbeFailure("runtime_failure")
        failure.report = first_failure
        raise failure from None
    finally:
        cleanup_error = None
        try:
            if agent is not None:
                agent.close()
        except (Exception, KeyboardInterrupt) as error:
            cleanup_error = error
        finally:
            # Process-wide by design: this script MUST be a standalone process.
            try:
                runtime.shutdown()
            except (Exception, KeyboardInterrupt) as error:
                cleanup_error = error
        if cleanup_error is not None and first_failure is None:
            failure = ProbeFailure("cleanup_failed")
            failure.report = failure_report(failure, "cleanup", entered, agent, baseline, trace)
            raise failure from None


@contextlib.contextmanager
def suppress_runtime_output():
    # Silence imports, logging handlers, native writes and inherited child stderr.
    # No raw prompts, tool output, runtime errors or credentials reach the terminal.
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    try:
        with open(os.devnull, "w") as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            yield
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        finally:
            for fd, copy in zip((1, 2), saved):
                os.dup2(copy, fd)
                os.close(copy)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes-source", default="/usr/local/lib/hermes-agent")
    parser.add_argument("--node", required=True, help="Parent-verified absolute Node executable")
    parser.add_argument("--cli-js", required=True, help="Exact reviewed compiled synthetic CLI artifact")
    parser.add_argument("--ssh-host", help="Parent-reviewed fixed Arch SSH destination, no shell syntax")
    parser.add_argument("--run-synthetic-model", action="store_true")
    args = parser.parse_args()
    try:
        with suppress_runtime_output():
            argv = command(args.node, args.cli_js, args.ssh_host)
            sys.path.insert(0, str(Path(args.hermes_source).resolve()))
            result = probe(InstalledRuntime(), argv, args.run_synthetic_model)
    except ProbeFailure as error:
        result = error.report if error.report is not None else failure_report(error)
    except (Exception, KeyboardInterrupt) as error:
        # Never echo exception text, including exceptions from imported runtime.
        result = failure_report(error)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] != "probe_failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
