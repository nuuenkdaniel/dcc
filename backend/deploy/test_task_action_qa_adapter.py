"""Synthetic adapter regressions only: no bootstrap, provider, HTTP or PG runs."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parent.parent / 'test/acceptance/runtime_loopback.py'
spec = importlib.util.spec_from_file_location('synthetic_qa_adapter', PATH)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class AdapterTests(unittest.TestCase):
    def test_official_bootstrap_prefix_is_preserved_and_no_model_called_by_outer_adapter(self):
        runtime = types.SimpleNamespace(run_action=Mock())
        original = ['/official/python', '-I', '-c', 'exact validated bootstrap', str(qa.ROOT / 'deploy/task_action_runtime.py')]
        launcher = types.SimpleNamespace(resolve_runtime=Mock(return_value='official descriptor'), runtime_command=Mock(return_value=list(original)))
        with patch.object(qa, 'load', side_effect=[runtime, launcher]), \
                patch.dict(os.environ, {'DCC_QA_RUNTIME_APPROVED': 'synthetic-loopback-model'}, clear=True), \
                patch.object(sys, 'argv', [str(PATH)]), patch.object(qa.os, 'execv', side_effect=RuntimeError()) as execute:
            self.assertEqual(qa.main(), 1)
        launcher.resolve_runtime.assert_called_once_with()
        launcher.runtime_command.assert_called_once_with('official descriptor', qa.ROOT / 'deploy/task_action_runtime.py')
        executable, argv = execute.call_args.args
        self.assertEqual(executable, original[0])
        self.assertEqual(argv, [*original[:-1], str(PATH), '--bootstrapped'])
        runtime.run_action.assert_not_called()

    def test_pinned_proxy_calls_production_relay_and_no_model(self):
        runtime = types.SimpleNamespace(capability_environment=Mock(return_value=('a'*64, 12345)), relay=Mock(), run_action=Mock())
        with patch.object(qa, 'load', return_value=runtime), patch.object(sys, 'argv', [str(PATH), '--stdio-proxy']), \
                patch.object(qa.http.client, 'HTTPConnection', return_value='pinned') as connection:
            self.assertEqual(qa.main(), 0)
            args = runtime.relay.call_args.args
            self.assertEqual(args[:2], ('a'*64, 12345))
            self.assertEqual(args[4](), 'pinned')
            connection.assert_called_once_with('127.0.0.1', 18534, timeout=15)
        runtime.run_action.assert_not_called()

    def test_no_approval_no_model_and_no_arbitrary_arguments(self):
        runtime = types.SimpleNamespace(run_action=Mock())
        for approval, argv in [('', []), ('synthetic-loopback-model', ['--callback-url', 'http://example.invalid'])]:
            with patch.object(qa, 'load', return_value=runtime), patch.dict(os.environ, {'DCC_QA_RUNTIME_APPROVED': approval}, clear=True), patch.object(sys, 'argv', [str(PATH), *argv]):
                self.assertEqual(qa.main(), 1)
        runtime.run_action.assert_not_called()

    def test_bootstrapped_entry_calls_production_function_not_an_alternate_loop(self):
        evidence = {'model': 'gpt-6-luna', 'schemaCount': 35, 'schemaSha256': 'b'*64, 'schemasUnchanged': True}
        runtime = types.SimpleNamespace(capability_environment=Mock(return_value=('a'*64, 12345)), quiet_runtime=contextlib.nullcontext, run_action=Mock(return_value=evidence))
        with patch.object(qa, 'load', return_value=runtime), patch.dict(os.environ, {'DCC_QA_RUNTIME_APPROVED': 'synthetic-loopback-model'}, clear=True), \
                patch.object(sys, 'argv', [str(PATH), '--bootstrapped']), patch.object(sys, 'stdin', io.StringIO('{"prompt":"Synthetic QA"}')), \
                patch.object(sys, 'stdout', new_callable=io.StringIO) as output, patch.object(sys, 'path', list(sys.path)), patch.object(qa.signal, 'signal'):
            self.assertEqual(qa.main(), 0)
            self.assertEqual(json.loads(output.getvalue()), {'status': 'finished', 'evidence': evidence})
        runtime.run_action.assert_called_once_with('a'*64, 12345, 'Synthetic QA', product=True, test_stdio_proxy=PATH)


if __name__ == '__main__':
    unittest.main()
