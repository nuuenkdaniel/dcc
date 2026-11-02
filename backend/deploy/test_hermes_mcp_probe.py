"""Offline tests only. Never import Hermes, spawn MCP/SSH or invoke a provider."""
import contextlib
import io
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

from hermes_mcp_probe import (
    COMPLETE_KEY, CREATE_KEY, TASK, TITLE, InstalledRuntime, ProbeFailure,
    canonical_schemas, command, failure_report, main, probe,
)


NAMES = {"probe_list": "list_tasks", "probe_create": "create_task",
         "probe_complete": "set_task_completed"}
EVENTS = [
    ("probe_create", {"operationKey": CREATE_KEY, "id": TASK, "title": TITLE, "date": "2026-11-01"},
     {"source": "synthetic", "result": {"state": "applied", "id": TASK, "version": 1}}),
    ("probe_complete", {"operationKey": COMPLETE_KEY, "id": TASK, "expectedVersion": 1, "completed": True},
     {"source": "synthetic", "result": {"state": "applied", "id": TASK, "version": 2}}),
    ("probe_list", {"from": "2026-11-01", "to": "2026-11-02", "limit": 10},
     {"source": "synthetic", "result": {"state": "ok", "data": {"items": [
         {"id": TASK, "title": TITLE, "date": "2026-11-01", "completed": True, "deleted": False, "version": 2}
     ], "nextOffset": None}}}),
]


class FakeRuntime:
    def __init__(self):
        self.registered = []
        self.shutdowns = self.closes = self.model_calls = self.constructors = 0
        self.tools = [{"type": "function", "function": {"name": name,
                      "parameters": {"type": "object", "properties": {}}}} for name in NAMES]
        self.events = EVENTS

    def register(self, argv):
        self.registered.append(argv)
        return ["fake_registration"]

    def verified_surface(self, registered):
        # Test contract ONLY, not an assertion of installed registry naming.
        assert registered == ["fake_registration"]
        return ["fake_toolset"], NAMES

    def create_agent(self, toolsets, callback, start_callback):
        assert toolsets == ["fake_toolset"]
        self.constructors += 1
        self.callback = callback
        return self

    def select_raw_tools(self, agent, names):
        if type(self.tools) is not list or len(self.tools) != 3 or set(self.agent_tool_names(agent)) != set(names):
            raise ProbeFailure("agent_tool_allowlist_mismatch")
        snapshot = canonical_schemas(self.tools)
        def check():
            if canonical_schemas(self.tools) != snapshot:
                raise ProbeFailure("agent_tool_snapshot_changed")
        return check

    def agent_tool_names(self, agent):
        return [t["function"]["name"] if type(t) is dict else t for t in self.tools]

    def completion(self, args, kwargs):
        return args

    def run_conversation(self, user_message):
        self.model_calls += 1
        for event in self.events:
            self.callback(*event)
        return {"final": "UNTRUSTED prose must not establish success"}

    def close(self):
        self.closes += 1

    def shutdown(self):
        self.shutdowns += 1


class ProbeTests(unittest.TestCase):
    def test_default_discovers_and_cleans_up_without_constructing_agent(self):
        runtime = FakeRuntime()
        result = probe(runtime, ["fixed-node", "synthetic-cli"])
        self.assertEqual(result["status"], "discovery_only")
        self.assertFalse(result["model_called"])
        self.assertEqual(runtime.constructors, 0)
        self.assertEqual(runtime.shutdowns, 1)

    def test_opt_in_accepts_only_receipted_create_complete_readback(self):
        runtime = FakeRuntime()
        result = probe(runtime, [], run_model=True)
        self.assertTrue(result["journey_pass"])
        self.assertEqual(result["readback_completed"], 1)
        self.assertEqual(runtime.model_calls, 1)
        self.assertEqual((runtime.closes, runtime.shutdowns), (1, 1))
        self.assertNotIn(TITLE, str(result))
        self.assertNotIn(TASK, str(result))

    def test_agent_with_any_extra_missing_or_duplicate_tool_never_calls_model(self):
        for tools in [list(NAMES) + ["shell"], list(NAMES)[:2], list(NAMES) + ["probe_list"], None]:
            runtime = FakeRuntime()
            runtime.tools = tools
            with self.assertRaisesRegex(ProbeFailure, "agent_tool_allowlist_mismatch"):
                probe(runtime, [], run_model=True)
            self.assertEqual(runtime.model_calls, 0)
            self.assertEqual((runtime.closes, runtime.shutdowns), (1, 1))

    def test_prose_without_trace_cannot_pass_and_wrong_receipts_fail(self):
        for events in [[], EVENTS[:2], list(reversed(EVENTS)), EVENTS + EVENTS[:1],
                       [(*EVENTS[0][:2], {"source": "dcc-service", "result": EVENTS[0][2]["result"]})]]:
            runtime = FakeRuntime()
            runtime.events = events
            with self.assertRaisesRegex(ProbeFailure, "synthetic_receipt_journey_failed"):
                probe(runtime, [], run_model=True)
            self.assertEqual(runtime.shutdowns, 1)

    def test_discovery_failure_still_shuts_down_partial_registration(self):
        runtime = FakeRuntime()
        runtime.register = lambda _: []
        with self.assertRaisesRegex(ProbeFailure, "registration_failed"):
            probe(runtime, [])
        self.assertEqual(runtime.shutdowns, 1)

    def test_fixed_ssh_argv_has_no_shell_interpolation_and_only_synthetic_flag(self):
        argv = command("/usr/bin/node", "/reviewed/backend/dist/mcp/cli.js", "dcc-arch")
        self.assertEqual(argv, ["/usr/bin/ssh", "-T", "-oBatchMode=yes", "-oConnectTimeout=10", "--",
                                "dcc-arch", "/usr/bin/node", "/reviewed/backend/dist/mcp/cli.js", "--synthetic-action-test"])
        for host in ["-oProxyCommand=evil", "host;evil", "$(evil)", "host name"]:
            with self.assertRaises(ProbeFailure):
                command("/usr/bin/node", "/reviewed/backend/dist/mcp/cli.js", host)
        with self.assertRaises(ProbeFailure):
            command("/usr/bin/node", "/reviewed/cli.js;evil", "dcc-arch")


INSTALLED_NAMES = {"mcp__dcc_probe__" + tool: tool for tool in
                   ("list_tasks", "create_task", "set_task_completed")}


def schemas():
    return [{"type": "function", "function": {
        "name": name, "description": "Synthetic fixture",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }} for name in INSTALLED_NAMES]


class InstalledBindingTests(unittest.TestCase):
    def setUp(self):
        # Bypass only the standalone constructor guard. Every installed import is
        # replaced below; no actual Hermes modules or executable code are loaded.
        self.runtime = object.__new__(InstalledRuntime)
        self.registry = types.SimpleNamespace(get_toolset_for_tool=Mock(return_value="mcp-dcc_probe"))
        self.register = Mock(return_value=list(INSTALLED_NAMES))
        self.shutdown = Mock()
        self.factory = Mock()
        self.get_definitions = Mock(return_value=schemas())
        package = types.ModuleType("tools")
        package.__path__ = []
        self.modules = patch.dict(sys.modules, {
            "tools": package,
            "tools.registry": types.SimpleNamespace(registry=self.registry),
            "tools.mcp_tool_discovery": types.SimpleNamespace(register_mcp_servers=self.register),
            "tools.mcp_tool_lifecycle": types.SimpleNamespace(shutdown_mcp_servers=self.shutdown),
            "run_agent": types.SimpleNamespace(AIAgent=self.factory),
            "model_tools": types.SimpleNamespace(get_tool_definitions=self.get_definitions),
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_standalone_guard_and_explicit_filtered_config_sampling_off(self):
        with self.assertRaisesRegex(ProbeFailure, "standalone_process_required"):
            InstalledRuntime()
        argv = ["/fixed/node", "/reviewed/backend/dist/mcp/cli.js", "--synthetic-action-test"]
        result = probe(self.runtime, argv)
        self.assertEqual(result["status"], "discovery_only")
        self.register.assert_called_once_with({"dcc_probe": {
            "command": argv[0], "args": argv[1:],
            "tools": {"include": ["create_task", "list_tasks", "set_task_completed"]},
            "sampling": {"enabled": False},
        }})
        self.factory.assert_not_called()
        self.get_definitions.assert_not_called()
        self.assertEqual(self.registry.get_toolset_for_tool.call_count, 3)
        self.shutdown.assert_called_once_with(timeout=15.0)

    def test_registry_mapping_uses_membership_namespace_and_exact_three_tools(self):
        self.assertEqual(self.runtime.verified_surface(list(INSTALLED_NAMES)),
                         (["mcp-dcc_probe"], INSTALLED_NAMES))
        invalid = [[], list(INSTALLED_NAMES)[:2], list(INSTALLED_NAMES) + ["mcp_dcc_probe_shell"],
                   ["mcp_dcc_probe_list_tasks"] * 3,
                   ["mcp_other_" + tool for tool in INSTALLED_NAMES.values()],
                   ["mcp_dcc_probe_shell", *list(INSTALLED_NAMES)[1:]],
                   [list(INSTALLED_NAMES)[0], 1, list(INSTALLED_NAMES)[2]]]
        for names in invalid:
            with self.subTest(names=names), self.assertRaisesRegex(ProbeFailure, "registry_tool_allowlist_mismatch"):
                self.runtime.verified_surface(names)
        self.registry.get_toolset_for_tool.return_value = "shell"
        with self.assertRaisesRegex(ProbeFailure, "registry_tool_allowlist_mismatch"):
            self.runtime.verified_surface(list(INSTALLED_NAMES))

    def test_registry_accepts_exact_installed_double_underscore_names(self):
        names = {
            "mcp__dcc_probe__list_tasks": "list_tasks",
            "mcp__dcc_probe__create_task": "create_task",
            "mcp__dcc_probe__set_task_completed": "set_task_completed",
        }
        self.assertEqual(self.runtime.verified_surface(list(names)),
                         (["mcp-dcc_probe"], names))
        self.assertEqual([call.args[0] for call in self.registry.get_toolset_for_tool.call_args_list],
                         list(names))

    def test_actual_agent_function_schemas_are_checked_strictly(self):
        agent = types.SimpleNamespace(tools=schemas(), valid_tool_names=set(INSTALLED_NAMES))
        self.assertEqual(self.runtime.agent_tool_names(agent), list(INSTALLED_NAMES))
        malformed = [None, {}, schemas()[:2], schemas() + schemas()[:1],
                     [{"type": "shell", "function": {}}, *schemas()[1:]]]
        for edit in [lambda f: f.update(name=42), lambda f: f.update(description=1),
                     lambda f: f.update(parameters="not a schema"),
                     lambda f: f.update(parameters={"type": "object", "properties": [], "required": []}),
                     lambda f: f.update(parameters={"type": "object", "properties": {}, "required": ["absent"]}),
                     lambda f: f.update(strict="true"), lambda f: f.update(unexpected=True)]:
            tools = schemas()
            edit(tools[0]["function"])
            malformed.append(tools)
        for tools in malformed:
            with self.subTest(tools=tools), self.assertRaisesRegex(ProbeFailure, "agent_tool_schema_malformed"):
                self.runtime.agent_tool_names(types.SimpleNamespace(tools=tools, valid_tool_names=set(INSTALLED_NAMES)))
        agent.valid_tool_names.add("shell")
        with self.assertRaisesRegex(ProbeFailure, "agent_tool_schema_malformed"):
            self.runtime.agent_tool_names(agent)

    def test_complete_callback_normalizes_rendered_nested_json_and_consistent_structured_content(self):
        envelope = EVENTS[0][2]
        name = "mcp_dcc_probe_create_task"
        for value in [{"result": json.dumps(envelope)}, {"result": envelope},
                      {"result": json.dumps(envelope), "structuredContent": envelope}]:
            self.assertEqual(self.runtime.completion(("call-1", name, EVENTS[0][1], json.dumps(value)), {}),
                             (name, EVENTS[0][1], envelope))

    def test_complete_callback_rejects_errors_malformed_json_and_disagreement(self):
        envelope = EVENTS[0][2]
        bad = ["prose", "[]", '{"result":"not JSON"}',
               '{"result":{},"result":{}}',
               json.dumps({"result": {"source": "dcc-service", "result": envelope["result"]}}),
               json.dumps({"result": {"source": "synthetic", "result": {"state": "rejected", "code": "forbidden"}}}),
               json.dumps({"result": json.dumps(envelope), "isError": True}),
               json.dumps({"result": json.dumps(envelope), "error": "private runtime detail"}),
               json.dumps({"result": json.dumps(envelope), "structuredContent": {"source": "synthetic", "result": {"state": "ok", "data": {}}}}),
               json.dumps({"result": json.dumps(envelope), "structuredContent": json.dumps(envelope)}),
               '{"result":{"source":"synthetic","result":{"state":"applied","id":"x","version":NaN}}}',
               '{"result":{"source":"synthetic","result":{"state":"applied","id":"x","version":true}}}',
               '{"result":{"source":"synthetic","result":{"state":"ok","data":{},"error":"x"}}}']
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaisesRegex(ProbeFailure, "malformed_completion_result"):
                self.runtime.completion(("call-1", "mcp_dcc_probe_create_task", {}, raw), {})
        for args, kwargs in [((), {}), (("id", "tool", "redacted prose", "{}"), {}),
                             (("id", "tool", {}, "{}"), {"extra": True})]:
            with self.assertRaisesRegex(ProbeFailure, "malformed_completion_callback"):
                self.runtime.completion(args, kwargs)

    def test_installed_bindings_full_fake_journey_and_constructor_limits(self):
        bridge = ["tool_search", "tool_describe", "tool_call"]
        agent = types.SimpleNamespace(
            tools=[{"type": "function", "function": {"name": name}} for name in bridge],
            valid_tool_names=set(bridge), disabled_toolsets=["shell"], close=Mock())
        def construct(**kwargs):
            def run_conversation(**_input):
                for index, (short, arguments, envelope) in enumerate(EVENTS):
                    tool = NAMES[short]
                    kwargs["tool_complete_callback"](
                        f"call-{index}", "mcp__dcc_probe__" + tool, arguments,
                        json.dumps({"result": json.dumps(envelope)}))
                return {"final": "Model prose ignored"}
            agent.run_conversation = Mock(side_effect=run_conversation)
            return agent
        self.factory.side_effect = construct
        summary = probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
        self.assertTrue(summary["journey_pass"])
        options = self.factory.call_args.kwargs
        self.assertEqual(options["enabled_toolsets"], ["mcp-dcc_probe"])
        self.assertEqual(options["max_iterations"], 6)
        self.assertEqual(options["run_budget_seconds"], 90.0)
        self.assertEqual((options["provider"], options["requested_provider"], options["model"]),
                         ("openai-codex", "openai-codex", "gpt-5.6-luna"))
        for flag in ["skip_context_files", "skip_memory", "skip_background_review", "quiet_mode"]:
            self.assertIs(options[flag], True)
        self.assertIsNone(options["session_db"])
        self.assertTrue(callable(options["tool_start_callback"]))
        self.get_definitions.assert_called_once_with(
            enabled_toolsets=["mcp-dcc_probe"], disabled_toolsets=["shell"],
            quiet_mode=True, skip_tool_search_assembly=True)
        self.assertEqual({t["function"]["name"] for t in agent.tools}, set(INSTALLED_NAMES))
        self.assertEqual(agent.valid_tool_names, set(INSTALLED_NAMES))
        agent.close.assert_called_once_with()
        self.shutdown.assert_called_once_with(timeout=15.0)

    def test_raw_selection_denies_extra_wrong_duplicate_or_malformed_schemas_before_model(self):
        wrong = schemas()
        wrong[0]["function"]["name"] = "tool_call"
        foreign = schemas()
        foreign[0]["function"]["name"] = "mcp__other__list_tasks"
        for raw in [None, schemas()[:2], schemas() + schemas()[:1], wrong, foreign,
                    [schemas()[0], schemas()[0], schemas()[2]]]:
            with self.subTest(raw=raw):
                agent = types.SimpleNamespace(tools=["constructor bridge"], valid_tool_names={"tool_call"},
                                              disabled_toolsets=[], run_conversation=Mock(), close=Mock())
                original = agent.tools
                self.factory.return_value = agent
                self.get_definitions.return_value = raw
                with self.assertRaisesRegex(ProbeFailure, "agent_tool_schema_malformed"):
                    probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
                agent.run_conversation.assert_not_called()
                self.assertIs(agent.tools, original, "reject before replacing constructor tools")
                agent.close.assert_called_once_with()
        self.assertEqual(self.shutdown.call_count, 6)

    def test_raw_selection_rechecks_registry_membership(self):
        agent = types.SimpleNamespace(tools=[], valid_tool_names=set(), disabled_toolsets=[])
        self.registry.get_toolset_for_tool.return_value = "general-tools"
        with self.assertRaisesRegex(ProbeFailure, "registry_tool_allowlist_mismatch"):
            self.runtime.select_raw_tools(agent, INSTALLED_NAMES)
        self.assertEqual(agent.tools, [])

    def test_snapshot_accepts_equivalent_rebuild_but_rejects_real_changes(self):
        agent = types.SimpleNamespace(tools=[], valid_tool_names=set(), disabled_toolsets=[])
        check = self.runtime.select_raw_tools(agent, INSTALLED_NAMES)
        agent.tools = list(reversed(json.loads(json.dumps(agent.tools))))
        agent.valid_tool_names = set(agent.valid_tool_names)
        check()  # New objects and reversed outer order, same canonical schemas.
        mutations = [lambda a: a.tools[0]["function"].update(name="tool_call"),
                     lambda a: a.tools[0]["function"].update(description="Changed schema content"),
                     lambda a: a.valid_tool_names.add("tool_search")]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.get_definitions.return_value = schemas()
                agent = types.SimpleNamespace(tools=[], valid_tool_names=set(), disabled_toolsets=[])
                check = self.runtime.select_raw_tools(agent, INSTALLED_NAMES)
                check()
                mutate(agent)
                with self.assertRaisesRegex(ProbeFailure, "agent_tool_snapshot_changed"):
                    check()
        self.assertEqual(self.get_definitions.call_count, 4)

    def test_run_loop_refresh_reports_first_failure_at_start_complete_or_after_loop(self):
        for where in ["after_loop", "start", "complete", "caught_and_restored"]:
            with self.subTest(where=where):
                self.get_definitions.return_value = schemas()
                agent = types.SimpleNamespace(tools=[], valid_tool_names=set(), disabled_toolsets=[], close=Mock())
                def construct(**options):
                    def run_conversation(**_input):
                        original, valid = agent.tools, agent.valid_tool_names
                        bridge = ["tool_search", "tool_describe", "tool_call"]
                        agent.tools = [{"type": "function", "function": {
                            "name": name, "parameters": {"type": "object", "properties": {}}
                        }} for name in bridge]
                        agent.valid_tool_names = set(bridge)
                        if where == "start":
                            options["tool_start_callback"]()
                        elif where in {"complete", "caught_and_restored"}:
                            options["tool_complete_callback"]("call-1", "tool_call", {"private": "omit"}, "private raw output")
                            if where == "caught_and_restored":
                                agent.tools, agent.valid_tool_names = original, valid
                        return {"final": "Cannot establish success"}
                    agent.run_conversation = run_conversation
                    return agent
                self.factory.side_effect = construct
                with self.assertRaises(ProbeFailure) as caught:
                    probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
                report = caught.exception.report
                self.assertEqual(report["reason"], "agent_tool_snapshot_changed")
                self.assertEqual(report["failure_stage"], "after_loop" if where == "after_loop" else "during_callback")
                self.assertTrue(report["model_called"])
                self.assertTrue(report["run_conversation_entered"])
                self.assertTrue(report["schema_changed"])
                self.assertEqual(report["snapshot_names"], ["tool_search", "tool_describe", "tool_call"])
                self.assertNotIn("private", json.dumps(report))
                agent.close.assert_called_once_with()
        self.assertEqual(self.shutdown.call_count, 4)

    def test_before_model_failure_reports_names_and_no_conversation_entry(self):
        self.get_definitions.return_value = schemas()[:2]
        agent = types.SimpleNamespace(tools=schemas(), valid_tool_names=set(INSTALLED_NAMES),
                                      disabled_toolsets=[], run_conversation=Mock(), close=Mock())
        self.factory.return_value = agent
        with self.assertRaises(ProbeFailure) as caught:
            probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
        report = caught.exception.report
        self.assertEqual(report["failure_stage"], "before_model")
        self.assertFalse(report["model_called"])
        self.assertFalse(report["run_conversation_entered"])
        self.assertEqual(report["snapshot_names"], list(INSTALLED_NAMES))
        self.assertIsNone(report["schema_changed"], "no validated baseline was installed")
        agent.run_conversation.assert_not_called()

    def test_content_only_refresh_keeps_names_but_reports_schema_change(self):
        agent = types.SimpleNamespace(tools=[], valid_tool_names=set(), disabled_toolsets=[], close=Mock())
        def construct(**_options):
            def run_conversation(**_input):
                agent.tools[0]["function"]["description"] = "PRIVATE_SCHEMA_CONTENT"
            agent.run_conversation = run_conversation
            return agent
        self.factory.side_effect = construct
        with self.assertRaises(ProbeFailure) as caught:
            probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
        report = caught.exception.report
        self.assertEqual(report["snapshot_names"], list(INSTALLED_NAMES))
        self.assertTrue(report["schema_changed"])
        self.assertEqual(report["failure_stage"], "after_loop")
        self.assertNotIn("PRIVATE_SCHEMA_CONTENT", json.dumps(report))

    def test_failure_diagnostics_never_echo_errors_prompts_arguments_or_schema_content(self):
        private = "PRIVATE provider=secret prompt text arguments output"
        tools = schemas()
        tools[0]["function"]["description"] = private
        tools[0]["function"]["parameters"]["properties"]["secret"] = {"default": private}
        tools[1]["function"]["name"] = private
        agent = types.SimpleNamespace(tools=tools, valid_tool_names=set(), provider=private)
        for error in [RuntimeError(private), ProbeFailure(private)]:
            report = failure_report(error, "during_loop", True, agent, canonical_schemas(schemas()))
            self.assertEqual(report["reason"], "runtime_failure")
            self.assertEqual(report["snapshot_names"][1], "<invalid_tool_name>")
            self.assertNotIn("PRIVATE", json.dumps(report))
            self.assertNotIn("default", json.dumps(report))
            self.assertNotIn("provider", json.dumps(report))

    def test_cleanup_error_cannot_replace_first_failure_diagnostics(self):
        self.get_definitions.return_value = []
        self.factory.return_value = types.SimpleNamespace(
            tools=schemas(), valid_tool_names=set(INSTALLED_NAMES), disabled_toolsets=[],
            close=Mock(side_effect=RuntimeError("PRIVATE close detail")))
        self.shutdown.side_effect = RuntimeError("PRIVATE shutdown detail")
        with self.assertRaises(ProbeFailure) as caught:
            probe(self.runtime, ["fixed-node", "synthetic-cli"], run_model=True)
        self.assertEqual(caught.exception.report["failure_stage"], "before_model")
        self.assertNotIn("PRIVATE", json.dumps(caught.exception.report))

    def test_final_cli_json_preserves_safe_diagnostic_report_not_exception_text(self):
        failure = ProbeFailure("PRIVATE raw error text")
        failure.report = failure_report(failure, "after_loop", True,
                                        types.SimpleNamespace(tools=schemas()))
        output = io.StringIO()
        with (patch("hermes_mcp_probe.command", return_value=["synthetic-only"]),
              patch("hermes_mcp_probe.InstalledRuntime", return_value=self.runtime),
              patch("hermes_mcp_probe.probe", side_effect=failure),
              patch("hermes_mcp_probe.suppress_runtime_output", return_value=contextlib.nullcontext()),
              patch.object(sys, "argv", ["probe", "--node", "/fixed/node", "--cli-js", "/fixed/backend/dist/mcp/cli.js"]),
              patch.object(sys, "path", list(sys.path)), contextlib.redirect_stdout(output)):
            self.assertEqual(main(), 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result["failure_stage"], "after_loop")
        self.assertTrue(result["run_conversation_entered"])
        self.assertEqual(result["snapshot_names"], list(INSTALLED_NAMES))
        self.assertNotIn("PRIVATE", output.getvalue())


if __name__ == "__main__":
    unittest.main()
