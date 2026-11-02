"""Standalone task MCP runtime/fixed HTTPS stdio relay. No production startup."""
import contextlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time

HOST = 'dcc.home.captnuu.online'
CALLBACK_PATH = '/api/v1/hermes/mcp-task-callback'
TOOLS = {'list_tasks', 'create_task', 'set_task_completed'}


def capability_environment():
    token = os.environ.pop('DCC_TASK_CALLBACK_CAPABILITY', '')
    expiry = int(os.environ.pop('DCC_TASK_CALLBACK_EXPIRES_AT', '0'))
    if not re.fullmatch(r'[a-f0-9]{64}', token) or expiry <= time.time() * 1000:
        raise ValueError('Invalid invocation')
    return token, expiry


def relay(token, expiry, input_stream, output_stream, connection_factory=None):
    """One stdio JSON-RPC line per POST; TLS defaults, no redirects/cookies/retries."""
    factory = connection_factory or (lambda: http.client.HTTPSConnection(
        HOST, 443, timeout=15, context=ssl.create_default_context()))
    while True:
        line = input_stream.readline(65537)
        if not line:
            return
        if len(line.encode('utf-8')) > 65536 or not line.endswith('\n') or time.time() * 1000 >= expiry:
            raise ValueError('Invalid invocation')
        message = json.loads(line)
        if type(message) is not dict or message.get('jsonrpc') != '2.0':
            raise ValueError('Invalid MCP message')
        connection = factory()
        try:
            connection.request('POST', CALLBACK_PATH, body=line.encode('utf-8'), headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/json'})
            response = connection.getresponse()
            if response.status == 202 and 'id' not in message:
                continue
            if response.status != 200:
                raise ValueError('Callback denied')
            body = response.read(524289)
            if len(body) > 524288:
                raise ValueError('Callback too large')
            result = json.loads(body)
            if (type(result) is not dict or result.get('jsonrpc') != '2.0' or 'id' not in message
                    or type(result.get('id')) is not type(message['id']) or result['id'] != message['id']):
                raise ValueError('Invalid callback response')
            output_stream.write(json.dumps(result, separators=(',', ':')) + '\n')
            output_stream.flush()
        finally:
            connection.close()


@contextlib.contextmanager
def quiet_runtime():
    sys.stdout.flush(); sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    try:
        with open(os.devnull, 'w') as sink:
            os.dup2(sink.fileno(), 1); os.dup2(sink.fileno(), 2)
            yield
    finally:
        try:
            sys.stdout.flush(); sys.stderr.flush()
        finally:
            for fd, original in zip((1, 2), saved):
                os.dup2(original, fd); os.close(original)


def run_action(token, expiry, prompt):
    # Parent-verified APIs; the existing profile's tool_search setting is off.
    # Require direct schemas. Never monkeypatch raw schemas or permit the bridge.
    from tools.mcp_tool_discovery import register_mcp_servers
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry
    agent = None
    invalid = False
    try:
        registered = register_mcp_servers({'dcc_task': {
            'command': sys.executable, 'args': [str(Path(__file__).resolve()), '--stdio-proxy'],
            # This is MCP subprocess env, never provider/model config or prompts.
            'env': {'DCC_TASK_CALLBACK_CAPABILITY': token, 'DCC_TASK_CALLBACK_EXPIRES_AT': str(expiry)},
            'tools': {'include': sorted(TOOLS)}, 'sampling': {'enabled': False}}})
        expected = {'mcp__dcc_task__' + tool for tool in TOOLS}
        if type(registered) is not list or len(registered) != 3 or set(registered) != expected:
            raise ValueError('Wrong tools')
        if any(registry.get_toolset_for_tool(name) != 'mcp-dcc_task' for name in expected):
            raise ValueError('Wrong scope')

        def snapshot():
            tools = agent.tools
            if type(tools) is not list or len(tools) != 3:
                raise ValueError('Wrong schema count')
            names = []
            for tool in tools:
                if type(tool) is not dict or tool.get('type') != 'function' or type(tool.get('function')) is not dict:
                    raise ValueError('Wrong schema')
                function = tool['function']; name = function.get('name'); parameters = function.get('parameters')
                if (type(name) is not str or name not in expected or type(parameters) is not dict
                        or parameters.get('type') != 'object' or type(parameters.get('properties')) is not dict
                        or 'operationKey' in parameters['properties']
                        or name.endswith('__create_task') and 'id' in parameters['properties']):
                    raise ValueError('Wrong schema')
                names.append(name)
            if set(names) != expected or agent.valid_tool_names != expected:
                raise ValueError('Wrong scope')
            if any(registry.get_toolset_for_tool(name) != 'mcp-dcc_task' for name in names):
                raise ValueError('Wrong scope')
            return json.dumps(sorted(tools, key=lambda t: t['function']['name']), sort_keys=True, allow_nan=False)

        baseline = None
        def check(*_args, **_kwargs):
            nonlocal invalid
            try:
                if baseline is not None and (snapshot() != baseline or time.time() * 1000 >= expiry):
                    raise ValueError('Scope changed')
            except Exception:
                invalid = True
                raise

        from run_agent import AIAgent
        agent = AIAgent(provider='openai-codex', requested_provider='openai-codex', model='gpt-5.6-luna',
                        enabled_toolsets=['mcp-dcc_task'], max_iterations=4, run_budget_seconds=90.0,
                        quiet_mode=True, skip_context_files=True, skip_memory=True, skip_background_review=True,
                        session_db=None, tool_start_callback=check, tool_complete_callback=check,
                        ephemeral_system_prompt='Act only on the authenticated task request using the three DCC task MCP tools. Read current tasks and collection versions before writes. Never invent task dates. Missing details means no write. No projects, calendar, deletion, files or other actions. Backend owns IDs/operation keys: never request or supply them. Routine requested actions need no second approval.')
        baseline = snapshot(); check()
        result = agent.run_conversation(user_message=prompt)
        check()
        if invalid or type(result) is not dict or result.get('error'):
            raise ValueError('Unconfirmed invocation')
    finally:
        try:
            if agent is not None:
                agent.close()
        finally:
            shutdown_mcp_servers(timeout=15.0)


def main():
    try:
        token, expiry = capability_environment()  # Remove BEFORE Hermes imports.
        if sys.argv[1:] == ['--stdio-proxy']:
            relay(token, expiry, sys.stdin, sys.stdout)
            return 0
        if sys.argv[1:]:
            return 1
        raw = sys.stdin.read(32769)
        if len(raw) > 32768:
            return 1
        payload = json.loads(raw)
        if type(payload) is not dict or set(payload) != {'prompt'} or type(payload['prompt']) is not str or not 0 < len(payload['prompt']) <= 4000:
            return 1
        sys.path.insert(0, '/usr/local/lib/hermes-agent')
        with quiet_runtime():
            run_action(token, expiry, payload['prompt'])
        print('{"status":"finished"}')  # Lifecycle ACK only, not model output.
        return 0
    except Exception:
        return 1  # No raw HTTP/model errors or payload logging.


if __name__ == '__main__':
    raise SystemExit(main())
