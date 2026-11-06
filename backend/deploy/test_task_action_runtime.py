"""Synthetic-only tests: no network, credential files, DB or Hermes imports."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

import task_action_runtime as runtime

TOKEN = 'a' * 64
EXPIRY = 1120000


def exercise_product_schemas(schemas):
    """Called by Node with real controller model-facing schemas over stdin."""
    names={'mcp__dcc_task__'+t for t in runtime.PRODUCT_TOOLS}
    agent=types.SimpleNamespace(tools=schemas,valid_tool_names=names,run_conversation=Mock(return_value={}),close=Mock())
    modules={'tools':types.ModuleType('tools'),
        'tools.mcp_tool_discovery':types.SimpleNamespace(register_mcp_servers=Mock(return_value=sorted(names))),
        'tools.mcp_tool_lifecycle':types.SimpleNamespace(shutdown_mcp_servers=Mock()),
        'tools.registry':types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _n:'mcp-dcc_task')),
        'run_agent':types.SimpleNamespace(AIAgent=Mock(return_value=agent))}
    modules['tools'].__path__=[]
    with patch.dict(sys.modules,modules),patch.object(runtime.time,'time',return_value=1000):
        runtime.run_action(TOKEN,EXPIRY,'Synthetic real-schema regression',product=True)
        agent.run_conversation.assert_called_once()
        target=next(t for t in schemas if t['function']['name'].endswith('__create_task'))
        target['function']['parameters']['properties']['operationKey']={'type':'string'}
        agent.run_conversation.reset_mock()
        try:
            runtime.run_action(TOKEN,EXPIRY,'Synthetic invalid schema',product=True)
        except ValueError:
            agent.run_conversation.assert_not_called()
        else:
            raise AssertionError('Mutation operation key reached model')


class RelayTests(unittest.TestCase):
    def connection(self, status=200, body=b'{"jsonrpc":"2.0","id":1,"result":{}}'):
        response = types.SimpleNamespace(status=status, read=io.BytesIO(body).read)
        return types.SimpleNamespace(request=Mock(), getresponse=Mock(return_value=response), close=Mock())

    def test_fixed_tls_post_capability_header_only_and_no_cookie_or_origin(self):
        connection = self.connection()
        output = io.StringIO()
        with patch.object(runtime.time, 'time', return_value=1000), \
             patch.object(runtime.ssl, 'create_default_context', return_value='verified-default-context') as tls, \
             patch.object(runtime.http.client, 'HTTPSConnection', return_value=connection) as https:
            runtime.relay(TOKEN, EXPIRY, io.StringIO('{"jsonrpc":"2.0","id":1,"method":"ping"}\n'), output)
        tls.assert_called_once_with()
        https.assert_called_once_with('dcc.home.captnuu.online', 443, timeout=15, context='verified-default-context')
        args, kwargs = connection.request.call_args
        self.assertEqual(args, ('POST', '/api/v1/hermes/mcp-task-callback'))
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + TOKEN)
        self.assertNotIn('Cookie', kwargs['headers']); self.assertNotIn('Origin', kwargs['headers'])
        self.assertNotIn(TOKEN, kwargs['body'].decode())
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['id'], 1)

    def test_redirect_error_expiry_large_input_and_wrong_response_id_fail_without_retry(self):
        for status, body in [(302, b''), (403, b''), (200, b'{"jsonrpc":"2.0","id":"1","result":{}}')]:
            connection = self.connection(status, body); factory = Mock(return_value=connection)
            with patch.object(runtime.time, 'time', return_value=1000), self.assertRaises(ValueError):
                runtime.relay(TOKEN, EXPIRY, io.StringIO('{"jsonrpc":"2.0","id":1,"method":"ping"}\n'), io.StringIO(), factory)
            factory.assert_called_once_with(); connection.close.assert_called_once_with()
        factory = Mock()
        for line, expiry in [('x' * 65537, EXPIRY), ('{}\n', 1)]:
            with patch.object(runtime.time, 'time', return_value=1000), self.assertRaises(ValueError):
                runtime.relay(TOKEN, expiry, io.StringIO(line), io.StringIO(), factory)
        factory.assert_not_called()

    def test_notification_is_not_emitted_as_fake_response(self):
        connection = self.connection(202)
        output = io.StringIO()
        with patch.object(runtime.time, 'time', return_value=1000):
            runtime.relay(TOKEN, EXPIRY, io.StringIO('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'), output, lambda: connection)
        self.assertEqual(output.getvalue(), '')

    def test_capability_removed_from_process_environment_before_runtime_imports(self):
        with patch.dict(os.environ, {'DCC_TASK_CALLBACK_CAPABILITY': TOKEN, 'DCC_TASK_CALLBACK_EXPIRES_AT': str(EXPIRY)}, clear=True), \
             patch.object(runtime.time, 'time', return_value=1000):
            self.assertEqual(runtime.capability_environment(), (TOKEN, EXPIRY))
            self.assertEqual(dict(os.environ), {})


class RuntimeTests(unittest.TestCase):
    def test_complete_product_catalog_exact_registration_and_schema_stability(self):
        expected = {'list_calendars','list_calendar_events','list_tasks','list_projects','get_operation_status',
                    'create_task','update_task','set_task_completed','remove_task','create_project','create_assignment',
                    'update_project','set_project_status','archive_project','restore_project','create_calendar_event',
                    'update_calendar_event','cancel_calendar_event','list_daily_actions','create_daily_action',
                    'update_daily_action','list_preparations','update_preparation','update_preparation_topic','search_inbox','get_inbox_message','list_prices','get_calendar_series','create_preparation','relink_preparation','insert_preparation_topic','remove_preparation_topic','get_focus_timer','control_focus_timer','edit_focus_queue','request_clarification'}
        self.assertEqual(runtime.PRODUCT_TOOLS, expected)
        names = ['mcp__dcc_task__' + name for name in sorted(expected)]
        schemas = [{'type':'function','function':{'name':name,'parameters':{'type':'object','properties':{}}}} for name in names]
        status=next(t for t in schemas if t['function']['name'].endswith('__get_operation_status'))
        status['function']['parameters'].update(properties={'operationKey':{'type':'string'}},required=['operationKey'],additionalProperties=False)
        register = Mock(return_value=names)
        agent = types.SimpleNamespace(tools=schemas,valid_tool_names=set(names),run_conversation=Mock(return_value={}),close=Mock())
        modules = {'tools':types.ModuleType('tools'),
                   'tools.mcp_tool_discovery':types.SimpleNamespace(register_mcp_servers=register),
                   'tools.mcp_tool_lifecycle':types.SimpleNamespace(shutdown_mcp_servers=Mock()),
                   'tools.registry':types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _name:'mcp-dcc_task')),
                   'run_agent':types.SimpleNamespace(AIAgent=Mock(return_value=agent))}
        modules['tools'].__path__=[]
        with patch.dict(sys.modules,modules),patch.object(runtime.time,'time',return_value=1000):
            runtime.run_action(TOKEN,EXPIRY,'Synthetic product request',product=True)
            options=modules['run_agent'].AIAgent.call_args.kwargs
            self.assertIn('list_daily_actions.id is an exact ACTION ID, never a project ID',options['ephemeral_system_prompt'])
            self.assertIn('unresolved target is incomplete, not a successful no-change',options['ephemeral_system_prompt'])
            self.assertEqual(options['max_iterations'],8)
            self.assertEqual(options['run_budget_seconds'],90.0)
            self.assertEqual(register.call_args.args[0]['dcc_task']['tools']['include'],sorted(expected))
            agent.run_conversation.assert_called_once()
            def changed(**_kwargs):
                agent.tools[0]['function']['parameters']['properties']['injected']={'type':'string'}
                return {}
            agent.run_conversation.side_effect=changed
            with self.assertRaises(ValueError):
                runtime.run_action(TOKEN,EXPIRY,'Synthetic scope change',product=True)

    def test_actual_bindings_use_filtered_subprocess_env_and_never_model_operation_keys(self):
        names = ['mcp__dcc_task__' + name for name in sorted(runtime.TOOLS)]
        schemas = [{'type':'function', 'function':{'name':name, 'parameters':{'type':'object','properties':{}}}} for name in names]
        register = Mock(return_value=names); shutdown = Mock()
        agent = types.SimpleNamespace(tools=schemas, valid_tool_names=set(names), run_conversation=Mock(return_value={}), close=Mock())
        factory = Mock(return_value=agent)
        modules = {
            'tools': types.ModuleType('tools'),
            'tools.mcp_tool_discovery': types.SimpleNamespace(register_mcp_servers=register),
            'tools.mcp_tool_lifecycle': types.SimpleNamespace(shutdown_mcp_servers=shutdown),
            'tools.registry': types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _name:'mcp-dcc_task')),
            'run_agent': types.SimpleNamespace(AIAgent=factory),
        }
        modules['tools'].__path__ = []
        with patch.dict(sys.modules, modules), patch.object(runtime.time, 'time', return_value=1000):
            evidence = runtime.run_action(TOKEN, EXPIRY, 'Synthetic authenticated task request')
            self.assertEqual(evidence['model'], 'gpt-6-luna')
            self.assertEqual(evidence['schemaCount'], 3)
            self.assertTrue(evidence['schemasUnchanged'])
            self.assertRegex(evidence['schemaSha256'], r'^[a-f0-9]{64}$')
            config = register.call_args.args[0]['dcc_task']
            self.assertEqual(config['env']['DCC_TASK_CALLBACK_CAPABILITY'], TOKEN)
            self.assertNotIn(TOKEN, repr(config['args']))
            self.assertEqual(config['sampling'], {'enabled':False})
            self.assertEqual(config['tools']['include'], sorted(runtime.TOOLS))
            options = factory.call_args.kwargs
            self.assertEqual(options['enabled_toolsets'], ['mcp-dcc_task'])
            self.assertEqual(options['max_iterations'], 4)
            self.assertNotIn('Daily action reads:', options['ephemeral_system_prompt'])
            self.assertNotIn(TOKEN, repr(options))
            agent.close.assert_called_once_with(); shutdown.assert_called_once_with(timeout=15.0)
            self.assertEqual(config['args'], [str(Path(runtime.__file__).resolve()), '--stdio-proxy'])
            approved = Path(runtime.__file__).resolve().parent.parent / 'test/acceptance/runtime_loopback.py'
            runtime.run_action(TOKEN, EXPIRY, 'Synthetic injected relay', test_stdio_proxy=approved)
            injected = register.call_args.args[0]['dcc_task']
            self.assertEqual(injected['command'], sys.executable)
            self.assertEqual(injected['args'], [str(approved), '--stdio-proxy'])
            self.assertNotIn(TOKEN, repr(injected['args']))
            for forbidden in ['/tmp/arbitrary.py', 'http://127.0.0.1:18534', Path(runtime.__file__)]:
                with self.assertRaises(ValueError):
                    runtime.run_action(TOKEN, EXPIRY, 'Synthetic refused relay', test_stdio_proxy=forbidden)
            agent.run_conversation.reset_mock()
            agent.tools = [{'type':'function','function':{'name':'tool_call','parameters':{'type':'object','properties':{}}}}]
            with self.assertRaises(ValueError):
                runtime.run_action(TOKEN, EXPIRY, 'Synthetic')
            agent.run_conversation.assert_not_called()

    def test_production_cli_cannot_select_test_relay_or_callback_url(self):
        for args in [['--test-stdio-proxy'], ['--callback-url', 'http://127.0.0.1:18534'], ['--bootstrapped']]:
            with patch.object(sys, 'argv', [runtime.__file__, *args]), patch.object(runtime, 'run_action') as run:
                self.assertEqual(runtime.main(), 1)
                run.assert_not_called()


class BridgeTests(unittest.TestCase):
    def test_read_helper_timeout_removes_bridge_owned_request_directory(self):
        module=self.bridge();seen=[]
        def timeout(*_args,**kwargs):
            seen.append(kwargs['env']['DCC_HELPER_DIRECTORY'])
            self.assertTrue(Path(seen[0]).is_dir())
            raise module.subprocess.TimeoutExpired('synthetic-helper',105)
        with patch.object(module.subprocess,'run',side_effect=timeout):
            code,payload=self.request(module,{'mode':'extract','text':'synthetic private supplied material','title':'Synthetic'})
        self.assertEqual(code,502)
        self.assertFalse(Path(seen[0]).exists())
        self.assertNotIn('synthetic private supplied material',repr(payload))

    def bridge(self):
        # The existing bridge reads its token at import. Intercept that exact
        # source read with a synthetic value; no private file is ever opened.
        spec = importlib.util.spec_from_file_location('synthetic_curator_bridge', Path(__file__).with_name('curator_bridge.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'DAYMARK_CURATOR_TOKEN_FILE':'/never-open'}, clear=True), \
             patch.object(Path, 'read_text', return_value='synthetic-bridge-bearer'):
            spec.loader.exec_module(module)
        return module

    def request(self, module, payload, bearer='synthetic-bridge-bearer'):
        handler = object.__new__(module.Handler)
        body = json.dumps(payload).encode()
        handler.path = '/curate'
        handler.headers = {'Authorization':'Bearer '+bearer, 'Content-Length':str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler.connection = types.SimpleNamespace(settimeout=Mock())
        handler.respond = Mock()
        handler.do_POST()
        return handler.respond.call_args.args

    def test_bridge_disabled_by_default_and_service_auth_does_not_become_callback_auth(self):
        module = self.bridge()
        with patch.dict(os.environ, {}, clear=True), patch.object(module.subprocess, 'run') as spawn:
            self.assertEqual(self.request(module, {'mode':'task-action'})[0], 503)
            self.assertEqual(self.request(module, {'mode':'product-action'})[0], 503)
            self.assertEqual(self.request(module, {'mode':'task-action'}, 'wrong')[0], 401)
            spawn.assert_not_called()

    def test_bridge_passes_capability_only_in_env_and_leaves_legacy_parser_path_intact(self):
        module = self.bridge()
        with patch.dict(os.environ, {'DAYMARK_TASK_ACTIONS_ENABLED':'1'}, clear=True), \
             patch.object(module.time, 'time', return_value=1000), \
             patch.object(module.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout='{"status":"finished"}')) as spawn:
            payload = {'mode':'task-action','prompt':'Synthetic task request','callbackCapability':TOKEN,'expiresAt':EXPIRY}
            self.assertEqual(self.request(module, payload), (200, {'status':'finished'}))
            args, kwargs = spawn.call_args
            self.assertEqual(args[0], ['/usr/bin/python3', str(Path(module.__file__).with_name('task_action_launcher.py'))])
            self.assertNotIn(TOKEN, repr(args)); self.assertNotIn(TOKEN, kwargs['input'])
            self.assertEqual(kwargs['env']['DCC_TASK_CALLBACK_CAPABILITY'], TOKEN)
            self.assertEqual(kwargs['env']['HERMES_HOME'], '/root/.hermes/profiles/daymark-curator')
            self.assertEqual(kwargs['timeout'], 105)
            self.assertEqual(json.loads(kwargs['input'])['catalog'],'tasks-v1')
            self.assertEqual(self.request(module,{**payload,'mode':'product-action'}),(200,{'status':'finished'}))
            self.assertEqual(json.loads(spawn.call_args.kwargs['input'])['catalog'],'product-v1')
            spawn.return_value = types.SimpleNamespace(returncode=0, stdout='{"action":"rejected"}')
            self.assertEqual(self.request(module, {'mode':'tell-hermes','prompt':'Synthetic legacy command'})[0], 200)
            self.assertEqual(spawn.call_args.args[0], ['/usr/bin/python3',str(Path(module.__file__).with_name('task_action_launcher.py'))])
            helper=json.loads(spawn.call_args.kwargs['input'])['readHelper']
            self.assertEqual(helper['context'], {'mode':'tell-hermes','prompt':'Synthetic legacy command'})
            self.assertIn('Parse ONE local DCC create command',helper['instruction'])
            self.assertNotIn('DCC_TASK_CALLBACK_CAPABILITY',spawn.call_args.kwargs['env'])
            for mode in ('custom-project-tasks','extract','assignment','mail-classify',None):
                context={'text':'synthetic supplied context',**({'mode':mode} if mode else {})}
                self.assertEqual(self.request(module,context)[0],200)
                helper=json.loads(spawn.call_args.kwargs['input'])['readHelper']
                self.assertEqual(helper['context'],context)
                self.assertNotIn('callbackCapability',helper)


if __name__ == '__main__':
    unittest.main()
