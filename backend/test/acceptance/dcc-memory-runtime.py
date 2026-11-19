"""Explicit installed-Hermes acceptance: synthetic memory only, no model/network/auth.

Run on Hermes with system Python from a staged source tree. Separate subprocesses
prove persistence; temporary profiles are discarded and DCC memories untouched.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy'))
from task_action_launcher import resolve_runtime, runtime_command

CHILD = r'''
import json, os, socket, sys
from pathlib import Path
# Fail closed if an imported runtime attempts any network call.
def no_network(*args, **kwargs):
    raise AssertionError('Network is forbidden in this memory acceptance')
socket.create_connection = no_network
socket.socket.connect = no_network
from tools.memory_tool import MemoryStore, memory_tool, MEMORY_SCHEMA
from tools.registry import registry
store=MemoryStore(memory_char_limit=6000,user_char_limit=4000)
store.load_from_disk()
phase=sys.argv[1]
def change(**args):
    result=json.loads(memory_tool(store=store,**args))
    assert result.get('success') and not result.get('staged'), result
if phase=='write':
    change(action='add',target='user',content='Synthetic preference: meetings last 30 minutes.')
    change(action='add',target='memory',content='Synthetic lesson: check all pages before claiming task completeness.')
elif phase=='correct':
    # Real constructor, explicit synthetic provider: no credential lookup or model invocation.
    profile=Path(os.environ['HERMES_HOME'])
    (profile/'SOUL.md').write_text('Synthetic DCC soul acceptance marker.')
    (profile/'.env').write_text('')
    from run_agent import AIAgent
    agent=AIAgent(model='synthetic-memory-test',provider='openai',requested_provider='openai',
                  api_key='synthetic-not-a-credential',base_url='http://127.0.0.1:1/v1',
                  enabled_toolsets=['memory'],skip_memory=True,skip_context_files=True,
                  load_soul_identity=True,skip_background_review=True,session_db=None,quiet_mode=True)
    try:
        assert agent.valid_tool_names=={'memory'}, agent.valid_tool_names
        assert agent._memory_store is not None and agent._memory_enabled and agent._user_profile_enabled
        assert '30 minutes' in agent._memory_store.format_for_system_prompt('user')
        prompt=agent._build_system_prompt()
        assert 'Synthetic DCC soul acceptance marker.' in prompt
        assert '30 minutes' in prompt
    finally:
        agent.close()
    assert '30 minutes' in store.format_for_system_prompt('user')
    assert 'all pages' in store.format_for_system_prompt('memory')
    change(action='replace',target='user',old_text='meetings last 30 minutes',content='Synthetic preference: meetings last 45 minutes.')
elif phase=='forget':
    assert '45 minutes' in store.format_for_system_prompt('user')
    assert '30 minutes' not in store.format_for_system_prompt('user')
    change(action='remove',target='user',old_text='meetings last 45 minutes')
    change(action='remove',target='memory',old_text='check all pages')
elif phase=='empty':
    assert not store.format_for_system_prompt('user')
    assert not store.format_for_system_prompt('memory')
else:
    raise AssertionError('Unknown test phase')
assert registry.get_toolset_for_tool('memory')=='memory'
assert {'action','target','content','old_text'} <= MEMORY_SCHEMA['parameters']['properties'].keys()
print(json.dumps({'phase':phase,'success':True}))
'''


def main():
    # A named-profile path shares the installed dependency root. An arbitrary
    # /tmp HERMES_HOME asks Hermes to provision a separate runtime.
    with tempfile.TemporaryDirectory(prefix='dcc-memory-script-') as directory, \
         tempfile.TemporaryDirectory(prefix='dcc-memory-qa-',dir='/root/.hermes/profiles') as first, \
         tempfile.TemporaryDirectory(prefix='dcc-memory-qa-',dir='/root/.hermes/profiles') as second:
        root=Path(directory)
        script=root/'task_action_runtime.py';script.write_text(CHILD)
        profile=Path(first);other=Path(second)
        # Resolve official interpreter/bootstrap, not a guessed venv or system-Python import.
        command=runtime_command(resolve_runtime(),script)
        for home,phase in [(profile,'write'),(profile,'correct'),(other,'empty'),(profile,'forget'),(profile,'empty')]:
            env={**os.environ,'HERMES_HOME':str(home)}
            result=subprocess.run([*command,phase],env=env,text=True,capture_output=True,timeout=30)
            if result.returncode:
                # Fixture errors are safe; no model/provider/auth was invoked.
                raise AssertionError(result.stderr[-4000:])
            assert '"success": true' in result.stdout, result.stdout[-1000:]
            print(json.dumps({'phase':phase,'isolated_profile':home.name,'success':True}))
    print('PASS: cross-process remember/correct/forget and profile isolation; no model calls.')


if __name__=='__main__':main()
