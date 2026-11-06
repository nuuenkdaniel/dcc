"""Opt-in installed Hermes acceptance against the full synthetic service fixture.

No model by default. Fixture argv must be explicitly supplied/reviewed; it must not
point at application startup or production services. No user-data transport exists.
"""
import argparse
from datetime import date
import importlib.util
import json
from pathlib import Path
import re
import sys
from runpy import run_path
agent_policy = run_path(str(Path(__file__).with_name('dcc_model_policy.py')))['agent_policy']
inference_context = run_path(str(Path(__file__).with_name('dcc_model_policy.py')))['inference_context']

_spec=importlib.util.spec_from_file_location('dcc_product_probe_runtime',Path(__file__).with_name('task_action_runtime.py'))
_runtime=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_runtime)
PRODUCT_TOOLS=_runtime.PRODUCT_TOOLS
quiet_runtime=_runtime.quiet_runtime
CLARIFICATION_QUESTIONS={
    'missing_calendar':'Which calendar should I use?',
    'missing_duration':'How many minutes should this take?',
    'missing_event_time':'What date and start time should the event use?',
    'ambiguous_project':'Which project or assignment do you mean? Please give its exact name or ID.',
    'ambiguous_calendar':'Which calendar do you mean? Please give its exact name or ID.',
    'ambiguous_relative_date':'What exact date (including year) do you mean?',
    'dst_gap':'That local time does not exist because the clocks move forward. What valid local time should I use?',
    'dst_fold':'That local time occurs twice when the clocks move back. Which UTC offset or occurrence do you mean?',
}

# Only known service refusal codes may be interpreted from an adapter error.
# This is not a parser for arbitrary error prose or a second product executor.
SERVICE_CODES=frozenset(('forbidden','unknown_tool','invalid_arguments','unsupported_recurrence',
    'transport_unconfigured','transport_failure','operation_capacity','not_found','revision_mismatch',
    'already_exists','operation_key_mismatch','deleted','archived','parent_unavailable','calendar_read_only',
    'unsupported_linkage','recurrence_unverified','cache_unavailable'))


def task_read_issue(arguments):
    """Diagnostic-only mirror of list_tasks' existing public read constraints."""
    if not {'from','to','limit'}.issubset(arguments):
        return 'missing_required_fields'
    if not set(arguments).issubset({'from','to','limit','offset'}):
        return 'unexpected_fields'
    if type(arguments['limit']) is not int or not 1<=arguments['limit']<=100:
        return 'invalid_limit'
    if type(arguments.get('offset',0)) is not int or not 0<=arguments.get('offset',0)<=10000:
        return 'invalid_offset'
    try:
        values=[]
        for field in ('from','to'):
            value=arguments[field]
            if type(value) is not str or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',value):
                return 'invalid_dates'
            parsed=date.fromisoformat(value)
            if not 2000<=parsed.year<=2100:
                return 'invalid_dates'
            values.append(parsed)
    except ValueError:
        return 'invalid_dates'
    days=(values[1]-values[0]).days
    return 'nonpositive_window' if days<=0 else 'window_exceeds_93_days' if days>93 else None


class ProbeFailure(ValueError):
    def __init__(self, stage, code, tool=None, reason=None):
        self.diagnostic={'stage':stage,'code':code}
        if tool in PRODUCT_TOOLS:
            self.diagnostic['tool']=tool
        if reason is not None:
            self.diagnostic['reason']=reason
        super().__init__(code)


def decode_receipt(raw, tool):
    """Decode normal Hermes results or its native-isError -> tool_error seam.

    The latter carries ONLY text; service refusals require an entire exact JSON
    envelope. Never search substrings, strip prefixes, accept success from errors,
    or print text. Known validation errors are separate refusals, not receipts.
    """
    try:
        outer=json.loads(raw)
        if type(outer) is not dict:
            raise ValueError()
    except Exception:
        raise ProbeFailure('adapter','malformed_callback',tool) from None
    error_path='error' in outer
    if error_path:
        if set(outer)!={'error'} or type(outer['error']) is not str or len(outer['error'])>65536:
            raise ProbeFailure('adapter','invalid_error_wrapper',tool)
        # IntentStoreError('invalid_arguments') is thrown before service dispatch;
        # the SDK maps its string code to -32603. Recognize only these exact
        # known literals, never arbitrary prose/prefixes. Still NOT a receipt.
        if outer['error'] in ('invalid_arguments','MCP error -32603: invalid_arguments'):
            return None,True,'request_validation'
        if outer['error']=='MCP error -32602: invalid_arguments':
            return None,True,'sdk_validation'
        try:
            envelope=json.loads(outer['error'])
        except Exception:
            raise ProbeFailure('adapter','untyped_adapter_error',tool) from None
        if (type(envelope) is dict and set(envelope) in ({'code','message'},{'code','message','data'})
                and type(envelope.get('code')) is int and envelope['code']==-32602 and type(envelope.get('message')) is str):
            return None,True,'sdk_validation'
        if type(envelope) is dict and set(envelope)=={'code','message'} and type(envelope.get('code')) is int and envelope['code']==-32603 and envelope.get('message')=='invalid_arguments':
            return None,True,'request_validation'
    else:
        try:
            envelope=outer['result']
            if type(envelope) is str:
                envelope=json.loads(envelope)
        except Exception:
            raise ProbeFailure('adapter','malformed_result',tool) from None
    if type(envelope) is not dict or set(envelope)!={'source','result'} or envelope['source']!='dcc-service':
        raise ProbeFailure('receipt','malformed_or_wrong_source',tool)
    if 'structuredContent' in outer and outer['structuredContent']!=envelope:
        raise ProbeFailure('receipt','inconsistent_receipt',tool)
    result=envelope['result']
    if type(result) is not dict:
        raise ProbeFailure('receipt','malformed_service_result',tool)
    is_error=error_path or outer.get('isError') is True
    if is_error and (set(result)!={'state','code'} or result.get('state') not in ('rejected','conflict') or type(result.get('code')) is not str or result['code'] not in SERVICE_CODES):
        raise ProbeFailure('receipt','invalid_error_receipt',tool)
    return result,is_error,'service_refusal' if result.get('state') in ('rejected','conflict') else 'service_result'


class ReceiptTracker:
    """Typed bad-read refusal requires a corrected read; conflicts require read/retry."""
    def __init__(self):
        self.observed={}
        self.pending={}
        self.sequence=0
        self.reads={}
        self.pending_reads={}
        self.refusals=[]

    def read_refusal(self,tool,arguments,stage):
        reason=task_read_issue(arguments) if tool=='list_tasks' else None
        if reason is None:
            raise ProbeFailure(stage,'invalid_arguments',tool,'valid_or_unsupported_input_refused')
        if len(self.refusals)>=12:
            raise ProbeFailure('acceptance','refusal_budget_exhausted',tool)
        diagnostic=ProbeFailure(stage,'invalid_arguments',tool,reason).diagnostic
        self.refusals.append(diagnostic)
        self.pending_reads[tool]=diagnostic

    def record(self, name, arguments, raw):
        tool=name.removeprefix('mcp__dcc_product_probe__') if type(name) is str else None
        if tool not in PRODUCT_TOOLS or name!='mcp__dcc_product_probe__'+tool or type(arguments) is not dict:
            raise ProbeFailure('receipt','invalid_callback',tool)
        try:
            result,is_error,stage=decode_receipt(raw,tool)
        except ProbeFailure as error:
            # Diagnose an independently verifiable bad request even when the
            # adapter supplies only untyped prose. It remains FATAL, not a receipt.
            reason=task_read_issue(arguments) if tool=='list_tasks' else None
            if reason is not None:
                error.diagnostic['reason']=reason
            raise
        self.sequence+=1
        if stage in ('sdk_validation','request_validation'):
            self.read_refusal(tool,arguments,stage)
            return
        fingerprint=(tool,json.dumps({k:v for k,v in arguments.items() if k!='expectedVersion'},sort_keys=True,allow_nan=False))
        state=result.get('state')
        if is_error and state in ('ok','applied','saved'):
            raise ProbeFailure('receipt','inconsistent_error_receipt',tool)
        if state in ('rejected','conflict'):
            if set(result)!={'state','code'} or type(result.get('code')) is not str or result['code'] not in SERVICE_CODES:
                raise ProbeFailure('receipt','invalid_refusal',tool)
            if result=={'state':'rejected','code':'invalid_arguments'} and tool=='list_tasks':
                self.read_refusal(tool,arguments,'service_refusal')
                return
        if state=='conflict' and result=={'state':'conflict','code':'revision_mismatch'} and tool in ('create_task','set_task_completed','create_project'):
            self.pending[fingerprint]=self.sequence
            return
        if state not in ('ok','applied','saved'):
            raise ProbeFailure('service_refusal' if state in ('rejected','conflict') else 'receipt',result['code'] if state in ('rejected','conflict') else 'unconfirmed_or_denied',tool)
        if state=='ok' and (set(result)!={'state','data'} or type(result['data']) is not dict):
            raise ProbeFailure('receipt','invalid_read',tool)
        if tool=='request_clarification':
            reason=arguments.get('reason')
            if set(arguments)!={'reason'} or type(reason) is not str or reason not in CLARIFICATION_QUESTIONS or result!={'state':'ok','data':{'reason':reason,'question':CLARIFICATION_QUESTIONS[reason]}}:
                raise ProbeFailure('receipt','invalid_clarification',tool)
        if state=='ok' and tool in ('list_tasks','list_projects'):
            if tool=='list_tasks' and task_read_issue(arguments) is not None:
                raise ProbeFailure('receipt','successful_invalid_read',tool)
            data=result['data']
            fields={'items','nextOffset','collectionVersion'} if tool=='list_tasks' else {'items','nextOffset'}
            if (set(data)!=fields or type(data['items']) is not list or len(data['items'])>100
                    or data['nextOffset'] is not None and (type(data['nextOffset']) is not int or data['nextOffset']<1)
                    or tool=='list_tasks' and (type(data['collectionVersion']) is not int or data['collectionVersion']<0)
                    or any(type(item) is not dict or type(item.get('id')) is not str or type(item.get('version')) is not int or item['version']<1
                           or tool=='list_tasks' and type(item.get('completed')) is not bool for item in data['items'])):
                raise ProbeFailure('receipt','invalid_read_page',tool)
        if state=='applied' and (set(result)!={'state','id','version'} or type(result['id']) is not str or type(result['version']) is not int or result['version']<1):
            raise ProbeFailure('receipt','invalid_applied',tool)
        if state=='applied' and ('id' in arguments and result['id']!=arguments['id'] or type(arguments.get('expectedVersion')) is int and result['version']<arguments['expectedVersion']):
            raise ProbeFailure('receipt','mismatched_applied',tool)
        if state=='saved' and (set(result)!={'state','operationKey','mutationId','confirmation','readback','providerEtag'} or result['confirmation']!='snapshot_pending' or result['readback'] not in ('verified','pending') or not all(type(result[k]) is str for k in ('operationKey','mutationId'))):
            raise ProbeFailure('receipt','invalid_saved',tool)
        if fingerprint in self.pending:
            required='list_tasks' if tool in ('create_task','set_task_completed') else 'list_projects'
            if self.reads.get(required,0)<=self.pending[fingerprint]:
                raise ProbeFailure('recovery','missing_authoritative_read',tool)
            del self.pending[fingerprint]
        if state=='ok':
            self.reads[tool]=self.sequence
            self.pending_reads.pop(tool,None)
        self.observed[tool]=result

PHASES = {
    'clarification': ('A synthetic event request omits its duration. Call request_clarification with missing_duration, then stop. Do not guess a duration or perform any write. Final prose is not a clarification receipt.', {'request_clarification'}),
    'tasks-projects': ('First list_tasks with from 2026-11-01, to 2026-11-04 (exclusive), limit 100, offset 0. Use this exact bounded date window for every task read; never request an entire year. Create a synthetic task on 2026-11-02 using the authoritative collectionVersion; complete that same created task using its latest collection version, then list_tasks again in the same window and verify it is completed. Create one synthetic personal project with importance 2 and remainingMinutes 0, then list_projects by its exact returned id. Correct a typed invalid read before continuing; after a revision conflict read the latest version before retrying. Do not mutate anything else.', {'create_task','set_task_completed','list_tasks','create_project','list_projects'}),
    'calendar': ('List calendars and events for Calendar_A within 2026-11-01 through 2026-11-03 UTC. Read get_calendar_series for snapshot-event-id. Create one synthetic UTC timed nonrecurring event in Calendar_A from 2026-11-02T10:00:00Z to 2026-11-02T11:00:00Z with explicit single scope. A saved snapshot_pending result is not refreshed event identity. Do not edit existing events.', {'list_calendars','list_calendar_events','get_calendar_series','create_calendar_event'}),
    'cached-reads': ('Read list_daily_actions from 2026-11-01 through 2026-11-04 and list_preparations. Search cached inbox for Synthetic, account all, importantOnly false; get cached body for synthetic-mail offset 0 limit 100. Read list_prices. Do not write anything.', {'list_daily_actions','list_preparations','search_inbox','get_inbox_message','list_prices'}),
}

def validate_fixture_argv(argv):
    if (type(argv) is not list or not 1 <= len(argv) <= 32
            or any(type(a) is not str or len(a)>500 or not re.fullmatch(r'[A-Za-z0-9_./@:=+-]+',a) for a in argv)
            or not Path(argv[0]).is_absolute() or Path(argv[0]).name not in ('node','ssh')
            or not any(a.endswith('/backend/test/mcp/product-stdio-fixture.ts') for a in argv)
            or any('server.ts' in a or '.env' in a for a in argv)):
        raise ValueError('Invalid fixture command')
    return argv


def run_probe(argv, phase, model=False):
    from tools.mcp_tool_discovery import register_mcp_servers
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry
    from run_agent import AIAgent
    agent = None
    tracker=ReceiptTracker()
    observed = tracker.observed
    invalid = False
    diagnostic = None
    try:
        names = register_mcp_servers({'dcc_product_probe':{'command':argv[0],'args':argv[1:],
            'tools':{'include':sorted(PRODUCT_TOOLS)},'sampling':{'enabled':False}}})
        expected = {'mcp__dcc_product_probe__' + t for t in PRODUCT_TOOLS}
        if type(names) is not list or len(names) != len(expected) or set(names) != expected or any(registry.get_toolset_for_tool(name)!='mcp-dcc_product_probe' for name in names):
            raise ValueError('Catalog mismatch')
        if not model:
            return {'status':'discovery_only','catalog_count':len(expected),'journey_pass':False}
        baseline = None

        def snapshot():
            return _runtime.schema_snapshot(agent.tools,agent.valid_tool_names,PRODUCT_TOOLS,'dcc_product_probe',registry.get_toolset_for_tool)

        def check(*_args,**_kwargs):
            nonlocal invalid
            try:
                if baseline is not None and snapshot() != baseline:
                    raise ValueError('Schema changed')
            except Exception:
                invalid = True
                raise

        def completed(*args,**kwargs):
            nonlocal invalid, diagnostic
            try:
                check()
                if kwargs or len(args) != 4:
                    raise ValueError('Wrong callback')
                _call_id,name,arguments,raw = args
                tracker.record(name,arguments,raw)
            except Exception as error:
                invalid = True
                if diagnostic is None:
                    diagnostic=error.diagnostic if isinstance(error,ProbeFailure) else {'stage':'callback','code':'invalid_callback_or_schema'}

        agent = AIAgent(**agent_policy(),
            enabled_toolsets=['mcp-dcc_product_probe'],max_iterations=8,run_budget_seconds=90.0,quiet_mode=True,
            skip_context_files=True,skip_memory=True,skip_background_review=True,session_db=None,
            tool_start_callback=check,tool_complete_callback=completed,
            ephemeral_system_prompt=inference_context()+' Isolated SYNTHETIC acceptance. Only use the exact product MCP catalog. Read current versions before writes; backend owns IDs/operation keys. Maximum twelve calls/four writes. Use request_clarification for missing/ambiguous details or DST gaps/folds; questions are not effects, and no further writes follow a question. No real services or user data are present. Do not claim effects from prose.')
        baseline=snapshot();check()
        agent.run_conversation(user_message=PHASES[phase][0]);check()
        if invalid:
            failure=ProbeFailure('receipt','invalid_receipt');failure.diagnostic=diagnostic
            raise failure
        if tracker.pending_reads:
            failure=ProbeFailure('acceptance','unrecovered_read_refusal');failure.diagnostic=next(iter(tracker.pending_reads.values()))
            raise failure
        if tracker.pending or not PHASES[phase][1].issubset(observed):
            raise ProbeFailure('acceptance','missing_receipts_or_unrecovered_conflict')
        if phase=='clarification' and (set(observed)!={'request_clarification'} or observed['request_clarification']!={'state':'ok','data':{'reason':'missing_duration','question':CLARIFICATION_QUESTIONS['missing_duration']}}):
            raise ProbeFailure('acceptance','clarification_not_exclusive','request_clarification')
        if phase=='tasks-projects':
            task=observed['set_task_completed']
            if task['id']!=observed['create_task']['id']:
                raise ProbeFailure('readback','completed_wrong_task','set_task_completed')
            items=observed['list_tasks']['data']['items']
            if not any(t['id']==task['id'] and t['completed'] is True for t in items):
                raise ProbeFailure('readback','completed_task_missing','list_tasks')
            project=observed['create_project']
            if not any(p['id']==project['id'] for p in observed['list_projects']['data']['items']):
                raise ProbeFailure('readback','project_missing','list_projects')
        if phase=='calendar' and (observed['create_calendar_event'].get('state')!='saved' or observed['create_calendar_event'].get('confirmation')!='snapshot_pending'):
            raise ValueError('Calendar receipt missing')
        return {'status':'synthetic_product_pass','phase':phase,'catalog_count':len(expected),'journey_pass':True,'observed_tools':sorted(observed),**({'recovered_refusals':tracker.refusals} if tracker.refusals else {})}
    finally:
        try:
            if agent is not None:
                agent.close()
        finally:
            shutdown_mcp_servers(timeout=15.0)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-argv-json',required=True)
    parser.add_argument('--phase',choices=PHASES,default='cached-reads')
    parser.add_argument('--run-synthetic-model',action='store_true')
    args=parser.parse_args()
    try:
        argv=validate_fixture_argv(json.loads(args.fixture_argv_json))
        with quiet_runtime():
            result=run_probe(argv,args.phase,args.run_synthetic_model)
    except Exception as error:
        result={'status':'synthetic_product_failed','journey_pass':False,'diagnostic':error.diagnostic if isinstance(error,ProbeFailure) else {'stage':'runtime','code':'catalog_schema_or_runtime_failed'}}
    print(json.dumps(result,sort_keys=True))
    return 0 if result['status']!='synthetic_product_failed' else 1


if __name__=='__main__':
    raise SystemExit(main())
