"""Opt-in QA adapter; no import-time execution, no URL/config override.

The outer stdlib process resolves the OFFICIAL bootstrap. The bootstrapped
process calls production run_action, not a probe or a second model loop.
"""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
REPLY_BUDGET = Path('/root/.hermes/profiles/project-manager/cache/scratch/dcc-natural-replies-two-turn-v1.consumed')


def consume_reply_slot():
    # Fixed, durable, exclusive markers. Failed/uncertain invocations consume
    # their slot too. No deletion/reset/replenishment path exists here.
    slot = os.environ.pop('DCC_QA_REPLY_SLOT', '')
    if (os.environ.pop('DCC_QA_REPLY_APPROVED', '') != 'two-consumed-turns'
            or slot not in ('1', '2') or REPLY_BUDGET.read_text() != 'two-turn-budget-v1\n'):
        raise ValueError('Reply acceptance not admitted')
    fd = os.open(str(REPLY_BUDGET) + '.' + slot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, b'consumed\n'); os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(str(REPLY_BUDGET.parent), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    try:
        runtime = load('dcc_qa_production_runtime', ROOT / 'deploy/task_action_runtime.py')
        if sys.argv[1:] == ['--stdio-proxy']:
            token, expiry = runtime.capability_environment()
            runtime.relay(token, expiry, sys.stdin, sys.stdout,
                          lambda: http.client.HTTPConnection('127.0.0.1', 18534, timeout=15))
            return 0
        if os.environ.pop('DCC_QA_RUNTIME_APPROVED', '') != 'synthetic-loopback-model':
            return 1
        if sys.argv[1:] == []:
            launcher = load('dcc_qa_official_launcher', ROOT / 'deploy/task_action_launcher.py')
            # Validate official interpreter and preserve bootstrap prefix bytes.
            argv = launcher.runtime_command(launcher.resolve_runtime(), ROOT / 'deploy/task_action_runtime.py')
            argv[-1] = str(Path(__file__).resolve())
            argv.append('--bootstrapped')
            os.environ['DCC_QA_RUNTIME_APPROVED'] = 'synthetic-loopback-model'
            os.execv(argv[0], argv)
            return 1
        if sys.argv[1:] != ['--bootstrapped']:
            return 1
        token, expiry = runtime.capability_environment()  # Before Hermes imports.
        raw = sys.stdin.read(32769)
        payload = json.loads(raw)
        if (type(payload) is not dict or set(payload) not in ({'prompt'}, {'prompt','replyVersion'})
                or type(payload['prompt']) is not str or not 0 < len(payload['prompt']) <= 4000
                or len(raw) > (32768 if 'replyVersion' in payload else 4096)
                or 'replyVersion' in payload and (type(payload['replyVersion']) is not int or payload['replyVersion'] != 1)):
            return 1
        if 'replyVersion' in payload:
            consume_reply_slot()
        def stop(_signal, _frame):
            raise InterruptedError('QA cancelled')
        signal.signal(signal.SIGTERM, stop)
        sys.path.insert(0, '/usr/local/lib/hermes-agent')  # Same production entry setup.
        with runtime.quiet_runtime():
            evidence = runtime.run_action(token, expiry, payload['prompt'], product=True,
                                          test_stdio_proxy=Path(__file__).resolve(),
                                          **({'reply_version':1} if 'replyVersion' in payload else {}))
        completion = evidence.pop('completion', None)
        print(json.dumps({'status': 'finished', 'evidence': evidence,
                          **({'completion':completion} if 'replyVersion' in payload else {})}, separators=(',', ':')))
        return 0
    except BaseException:
        return 1  # Never print provider/SDK exceptions, prompts or capabilities.


if __name__ == '__main__':
    raise SystemExit(main())
