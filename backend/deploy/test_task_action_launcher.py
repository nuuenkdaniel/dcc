"""Offline launcher metadata fixtures only; never execute Hermes/bootstrap/model."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import task_action_launcher as launcher

# Synthetic bootstrap prefix, NOT a claim about private installed path setup.
PREFIX = "import sys\nsys.path.insert(0,'/synthetic/runtime')\nimport hermes_bootstrap\nimport runpy\n"
ARGV = ['/synthetic/bin/python3', '-I', '-c', PREFIX + launcher.RUN_MODULE]
SCRIPT = Path('/synthetic/deploy/task_action_runtime.py')
TOKEN = 'a' * 64


class ReplacedProcess(BaseException):
    pass


class LauncherTests(unittest.TestCase):
    def test_exact_terminal_call_replacement_preserves_prefix_and_appends_fixed_script(self):
        # Matching text in a prefix string is NOT rewritten.
        prefix = PREFIX + 'marker=' + repr(launcher.RUN_MODULE) + '\n'
        argv = [*ARGV[:3], prefix + launcher.RUN_MODULE + '\n']
        result = launcher.runtime_command(argv, SCRIPT)
        self.assertEqual(result[:3], ARGV[:3])
        self.assertEqual(result[3], prefix + launcher.RUN_PATH + '\n')
        self.assertEqual(result[4:], [str(SCRIPT)])
        self.assertEqual(argv[3], prefix + launcher.RUN_MODULE + '\n', 'do not mutate resolver metadata')
        # Formatting/quote differences have the identical exact call AST.
        result = launcher.runtime_command([*ARGV[:3], PREFIX + 'runpy.run_module("runpy", run_name="__main__", alter_sys=True)'], SCRIPT)
        self.assertEqual(result[3], PREFIX + launcher.RUN_PATH)

    def test_changed_argv_or_bootstrap_shape_is_refused_without_exec(self):
        bad = [None, {'argv': ARGV}, [], ARGV + ['unexpected'],
               ['python3', *ARGV[1:]], ['/bin/sh', *ARGV[1:]],
               [ARGV[0], '-c', '-I', ARGV[3]],
               [*ARGV[:3], PREFIX + "runpy.run_module('other',run_name='__main__',alter_sys=True)"],
               [*ARGV[:3], PREFIX + launcher.RUN_MODULE + '; print("unexpected tail")'],
               [*ARGV[:3], PREFIX + launcher.RUN_MODULE + ' # changed shape'],
               [*ARGV[:3], "import runpy\n" + launcher.RUN_MODULE],
               [*ARGV[:3], "import hermes_bootstrap\n" + launcher.RUN_MODULE],
               [*ARGV[:3], PREFIX + "runpy.run_module('runpy',run_name='__main__',alter_sys=False)"],
               [*ARGV[:3], PREFIX + launcher.RUN_MODULE + '\x00']]
        with patch.object(launcher.os, 'execv') as execute:
            for argv in bad:
                with self.subTest(argv=argv), self.assertRaises(launcher.LauncherError):
                    launcher.runtime_command(argv, SCRIPT)
            with self.assertRaises(launcher.LauncherError):
                launcher.runtime_command(ARGV, Path('/synthetic/not-the-runtime.py'))
            execute.assert_not_called()

    def test_resolver_uses_official_fixed_metadata_command_without_consuming_stdin(self):
        with patch.object(launcher.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=json.dumps(ARGV))) as resolve:
            self.assertEqual(launcher.resolve_runtime(), ARGV)
        resolve.assert_called_once_with(
            ['/root/.local/bin/hermes', '--print-runtime-command', '--module', 'runpy'],
            stdin=launcher.subprocess.DEVNULL, stdout=launcher.subprocess.PIPE,
            stderr=launcher.subprocess.DEVNULL, text=True, timeout=10, check=False)

    def test_exec_inherits_private_env_and_untouched_prompt_stream_not_argv(self):
        stdin = io.StringIO('{"prompt":"synthetic private prompt"}')
        output = io.StringIO()
        env = {'DCC_TASK_CALLBACK_CAPABILITY': TOKEN, 'HERMES_HOME': '/synthetic/profile'}
        def execute(_executable, _argv):
            self.assertEqual(dict(os.environ), env)
            self.assertEqual(stdin.tell(), 0)
            raise ReplacedProcess()
        with patch.dict(os.environ, env, clear=True), \
             patch.object(sys, 'argv', ['task_action_launcher.py']), patch.object(sys, 'stdin', stdin), \
             patch.object(launcher, 'resolve_runtime', return_value=ARGV), \
             patch.object(launcher.Path, 'is_file', return_value=True), patch.object(launcher.os, 'access', return_value=True), \
             patch.object(launcher.os, 'execv', side_effect=execute) as execv, contextlib.redirect_stdout(output):
            with self.assertRaises(ReplacedProcess):
                launcher.main()
        executable, argv = execv.call_args.args
        self.assertEqual(executable, ARGV[0])
        self.assertEqual(argv[:3], ARGV[:3])
        self.assertEqual(argv[3], PREFIX + launcher.RUN_PATH)
        self.assertEqual(Path(argv[4]), Path(launcher.__file__).resolve().with_name('task_action_runtime.py'))
        self.assertNotIn(TOKEN, repr(argv)); self.assertNotIn('synthetic private prompt', repr(argv))
        self.assertEqual(output.getvalue(), '')

    def test_metadata_preflight_never_executes_bootstrap_and_logs_only_fixed_status(self):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['task_action_launcher.py', '--preflight']), \
             patch.object(launcher, 'resolve_runtime', return_value=ARGV), \
             patch.object(launcher.Path, 'is_file', return_value=True), patch.object(launcher.os, 'access', return_value=True), \
             patch.object(launcher.os, 'execv') as execute, contextlib.redirect_stdout(output):
            self.assertEqual(launcher.main(), 0)
        execute.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {'status':'runtime_ready'})
        self.assertNotIn('python3', output.getvalue())

    def test_resolver_failures_are_sanitized_and_never_reach_exec(self):
        failures = [types.SimpleNamespace(returncode=1, stdout=TOKEN + ' raw failure'),
                    types.SimpleNamespace(returncode=0, stdout=TOKEN + ' invalid JSON'),
                    types.SimpleNamespace(returncode=0, stdout=json.dumps({'private': TOKEN})),
                    types.SimpleNamespace(returncode=0, stdout=json.dumps([*ARGV[:3], TOKEN]))]
        for result in failures:
            output = io.StringIO()
            with self.subTest(result=result), patch.object(sys, 'argv', ['task_action_launcher.py']), \
                 patch.object(launcher.Path, 'is_file', return_value=True), \
                 patch.object(launcher.subprocess, 'run', return_value=result), \
                 patch.object(launcher.os, 'execv') as execute, contextlib.redirect_stdout(output):
                self.assertEqual(launcher.main(), 1)
            execute.assert_not_called()
            self.assertEqual(json.loads(output.getvalue()), {'status':'runtime_unavailable'})
            self.assertNotIn(TOKEN, output.getvalue())


if __name__ == '__main__':
    unittest.main()
