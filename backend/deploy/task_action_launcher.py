#!/usr/bin/python3
"""Stdlib-only adapter for the installed official Hermes runtime bootstrap.

No shell, credentials discovery, runtime installation or model invocation during
--preflight. Runtime argv and environment are never printed.
"""
import ast
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERMES = '/root/.local/bin/hermes'
RUN_MODULE = "runpy.run_module('runpy',run_name='__main__',alter_sys=True)"
RUN_PATH = "import sys; sys.argv.pop(0); runpy.run_path(sys.argv[0],run_name='__main__')"


class LauncherError(Exception):
    pass


def runtime_command(argv, script):
    """Preserve launcher prefix bytes; replace ONLY the validated terminal call."""
    if (type(argv) is not list or len(argv) != 4
            or any(type(part) is not str or not part or '\x00' in part for part in argv)
            or not re.fullmatch(r'/[A-Za-z0-9_./+-]+', argv[0])
            or not re.fullmatch(r'python(?:[0-9]+(?:\.[0-9]+)*)?', Path(argv[0]).name)
            or argv[1:3] != ['-I', '-c'] or len(argv[3]) > 65536
            or not Path(script).is_absolute() or Path(script).name != 'task_action_runtime.py'):
        raise LauncherError('Unsupported runtime command')
    code = argv[3]
    try:
        tree = ast.parse(code)
        expected = ast.parse(RUN_MODULE).body[0]
        if not tree.body or ast.dump(tree.body[-1], include_attributes=False) != ast.dump(expected, include_attributes=False):
            raise ValueError()
        imports = [node for statement in tree.body[:-1] for node in ast.walk(statement) if isinstance(node, ast.Import)]
        if not any(alias.name == 'hermes_bootstrap' for node in imports for alias in node.names):
            raise ValueError()
        if not any(alias.name == 'runpy' and alias.asname in (None, 'runpy') for node in imports for alias in node.names):
            raise ValueError()
        # AST positions are UTF-8 byte offsets. Never reserialize/unparse the
        # bootstrap: path setup, isolation and dependency initialization stay exact.
        final = tree.body[-1]
        lines = code.encode('utf-8').splitlines(keepends=True)
        start = sum(map(len, lines[:final.lineno - 1])) + final.col_offset
        end = sum(map(len, lines[:final.end_lineno - 1])) + final.end_col_offset
        raw = code.encode('utf-8')
        if raw[end:].strip(b' \t\r\n;'):
            raise ValueError()
        replaced = raw[:start].decode('utf-8') + RUN_PATH + raw[end:].decode('utf-8')
        ast.parse(replaced)
    except (ValueError, SyntaxError, TypeError, UnicodeError):
        raise LauncherError('Unsupported runtime bootstrap') from None
    return [*argv[:3], replaced, str(script)]


def resolve_runtime():
    resolved = subprocess.run(
        [HERMES, '--print-runtime-command', '--module', 'runpy'],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, timeout=10, check=False,
    )
    if resolved.returncode or type(resolved.stdout) is not str or len(resolved.stdout) > 65536:
        raise LauncherError('Runtime resolution failed')
    try:
        return json.loads(resolved.stdout)
    except (ValueError, TypeError):
        raise LauncherError('Runtime resolution failed') from None


def main():
    try:
        probe = sys.argv[1:2] == ['--product-probe']
        if not probe and sys.argv[1:] not in ([], ['--preflight'], ['--read-context-server']):
            raise LauncherError('Unsupported launcher arguments')
        script = Path(__file__).resolve().with_name('task_action_runtime.py')
        if not script.is_file() or not script.with_name('read_context_runtime.py').is_file() or not script.with_name('dcc_model_policy.py').is_file():
            raise LauncherError('Runtime script missing')
        argv = runtime_command(resolve_runtime(), script)
        if not Path(argv[0]).is_file() or not os.access(argv[0], os.X_OK):
            raise LauncherError('Runtime executable missing')
        if sys.argv[1:] == ['--preflight']:
            print('{"status":"runtime_ready"}')
            return 0
        if sys.argv[1:] == ['--read-context-server']:
            argv.append('--read-context-server')
        if probe:
            argv.extend(sys.argv[1:])
        # Inherit private env and untouched stdin. No token/prompt in argv.
        os.execv(argv[0], argv)
        raise LauncherError('Runtime exec returned')
    except Exception:
        print('{"status":"runtime_unavailable"}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
