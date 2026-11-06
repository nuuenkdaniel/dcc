"""Offline product probe tests, no subprocess, Hermes or provider calls."""
import json
import sys
import types
import unittest
from unittest.mock import Mock,patch

import product_mcp_probe as probe


def native_error_callback(result, source='dcc-service'):
    # Actual adapter-shaped seam reported by parent: native isError ->
    # tool_error(sanitized text content), NOT the normal result/structured path.
    envelope={'source':source,'result':result}
    native={'isError':True,'content':[{'type':'text','text':json.dumps(envelope)}],'structuredContent':envelope}
    return json.dumps({'error':native['content'][0]['text']})


class ProductProbeTests(unittest.TestCase):
    def test_clarification_requires_exact_reason_question_and_never_applied_prose(self):
        for reason,question in probe.CLARIFICATION_QUESTIONS.items():
            tracker=probe.ReceiptTracker()
            def record(result):
                tracker.record('mcp__dcc_product_probe__request_clarification',{'reason':reason},json.dumps({'result':{'source':'dcc-service','result':result}}))
            record({'state':'ok','data':{'reason':reason,'question':question}})
            self.assertEqual(tracker.observed['request_clarification']['state'],'ok')
            for result in [{'state':'ok','data':{'reason':reason,'question':'Everything applied'}},{'state':'applied','id':'invented','version':1}]:
                with self.assertRaises(probe.ProbeFailure):record(result)

    def test_read_diagnostic_matches_required_fields_limits_dates_and_window_boundaries(self):
        valid={'from':'2026-11-01','to':'2026-11-04','limit':100,'offset':0}
        self.assertIsNone(probe.task_read_issue(valid))
        self.assertIsNone(probe.task_read_issue({**valid,'from':'2026-01-01','to':'2026-04-04'}))  # 93 days
        for args,reason in [
            ({'from':'2026-11-01','to':'2026-11-04'},'missing_required_fields'),
            ({**valid,'operationKey':'not-allowed-on-read'},'unexpected_fields'),
            ({**valid,'limit':101},'invalid_limit'),({**valid,'limit':True},'invalid_limit'),
            ({**valid,'offset':-1},'invalid_offset'),({**valid,'from':'2026-02-30'},'invalid_dates'),
            ({**valid,'to':valid['from']},'nonpositive_window'),
            ({**valid,'from':'2026-01-01','to':'2026-04-05'},'window_exceeds_93_days'),
        ]:
            with self.subTest(reason=reason):self.assertEqual(probe.task_read_issue(args),reason)

    def test_native_iserror_service_read_refusal_and_corrected_read_recover_without_claimed_effects(self):
        tracker=probe.ReceiptTracker();name='mcp__dcc_product_probe__list_tasks'
        invalid={'from':'2026-01-01','to':'2027-01-01','limit':100}
        tracker.record(name,invalid,native_error_callback({'state':'rejected','code':'invalid_arguments'}))
        self.assertNotIn('list_tasks',tracker.observed)
        self.assertTrue(tracker.pending_reads)
        self.assertEqual(tracker.refusals,[{'stage':'service_refusal','code':'invalid_arguments','tool':'list_tasks','reason':'window_exceeds_93_days'}])
        valid={'from':'2026-11-01','to':'2026-11-04','limit':100}
        result={'state':'ok','data':{'items':[],'nextOffset':None,'collectionVersion':0}}
        tracker.record(name,valid,json.dumps({'result':{'source':'dcc-service','result':result}}))
        self.assertFalse(tracker.pending_reads)
        self.assertEqual(tracker.observed['list_tasks'],result)

    def test_native_iserror_conflict_requires_read_retry_and_error_success_never_counts(self):
        tracker=probe.ReceiptTracker();name='mcp__dcc_product_probe__set_task_completed'
        args={'id':'synthetic','expectedVersion':1,'completed':True}
        tracker.record(name,args,native_error_callback({'state':'conflict','code':'revision_mismatch'}))
        self.assertTrue(tracker.pending)
        read={'state':'ok','data':{'items':[],'nextOffset':None,'collectionVersion':2}}
        tracker.record('mcp__dcc_product_probe__list_tasks',{'from':'2026-11-01','to':'2026-11-04','limit':100},json.dumps({'result':{'source':'dcc-service','result':read}}))
        applied={'state':'applied','id':'synthetic','version':3}
        tracker.record(name,{**args,'expectedVersion':2},json.dumps({'result':{'source':'dcc-service','result':applied}}))
        self.assertFalse(tracker.pending)
        for payload in [native_error_callback(applied),native_error_callback({'state':'ok','data':{}}),native_error_callback({'state':'rejected','code':'invalid_arguments'},'synthetic'),native_error_callback({'state':'rejected','code':'forbidden'}),native_error_callback({'state':'conflict','code':'operation_key_mismatch'}),native_error_callback({'state':'rejected','code':'invented'}),json.dumps({'error':'private raw provider prose'}),json.dumps({'error':'prefix '+json.dumps({'source':'dcc-service','result':{'state':'rejected','code':'invalid_arguments'}})})]:
            with self.subTest(payload=payload),self.assertRaises(probe.ProbeFailure) as error:
                tracker.record(name,args,payload)
            self.assertNotIn('private raw provider prose',repr(error.exception.diagnostic))

    def test_sdk_invalidparams_is_a_separate_no_effect_refusal_not_a_service_receipt(self):
        tracker=probe.ReceiptTracker();name='mcp__dcc_product_probe__list_tasks'
        args={'from':'2026-11-01','to':'2026-11-04'}  # required limit omitted
        raw=json.dumps({'error':json.dumps({'code':-32602,'message':'synthetic private schema detail'})})
        tracker.record(name,args,raw)
        self.assertEqual(tracker.refusals,[{'stage':'sdk_validation','code':'invalid_arguments','tool':'list_tasks','reason':'missing_required_fields'}])
        self.assertNotIn('list_tasks',tracker.observed)
        self.assertTrue(tracker.pending_reads)
        with self.assertRaises(probe.ProbeFailure):tracker.record('mcp__dcc_product_probe__create_task',{},raw)
        with self.assertRaises(probe.ProbeFailure):tracker.record(name,{'from':'2026-11-01','to':'2026-11-04','limit':100},raw)

    def test_predispatch_invalidarguments_protocol_error_is_not_mislabeled_service_evidence(self):
        name='mcp__dcc_product_probe__list_tasks'
        invalid={'from':'2026-01-01','to':'2027-01-01','limit':100}
        for error in ('invalid_arguments','MCP error -32603: invalid_arguments',json.dumps({'code':-32603,'message':'invalid_arguments'})):
            tracker=probe.ReceiptTracker()
            tracker.record(name,invalid,json.dumps({'error':error}))
            self.assertEqual(tracker.refusals,[{'stage':'request_validation','code':'invalid_arguments','tool':'list_tasks','reason':'window_exceeds_93_days'}])
            self.assertFalse(tracker.observed)
            self.assertTrue(tracker.pending_reads)
        with self.assertRaises(probe.ProbeFailure) as failure:
            probe.ReceiptTracker().record(name,invalid,json.dumps({'error':'arbitrary private provider text'}))
        self.assertEqual(failure.exception.diagnostic,{'stage':'adapter','code':'untyped_adapter_error','tool':'list_tasks','reason':'window_exceeds_93_days'})

    def test_tasks_projects_journey_recovers_bad_read_but_keeps_final_readback_and_fatal_errors(self):
        names=['mcp__dcc_product_probe__'+t for t in sorted(probe.PRODUCT_TOOLS)]
        schemas=[{'type':'function','function':{'name':name,'parameters':{'type':'object','properties':{}}}} for name in names]
        next(t for t in schemas if t['function']['name'].endswith('__get_operation_status'))['function']['parameters'].update(properties={'operationKey':{'type':'string'}},required=['operationKey'],additionalProperties=False)
        options={};mode={'omit_final_read':False,'fatal':False,'unrecovered':False,'missing_project':False}
        agent=types.SimpleNamespace(tools=schemas,valid_tool_names=set(names),close=Mock())
        def factory(**kwargs):options.update(kwargs);return agent
        def conversation(**_kwargs):
            def callback(tool,args,result=None,raw=None):
                options['tool_complete_callback']('synthetic-call','mcp__dcc_product_probe__'+tool,args,raw or json.dumps({'result':{'source':'dcc-service','result':result}}))
            invalid={'from':'2026-01-01','to':'2027-01-01','limit':100}
            callback('list_tasks',invalid,raw=native_error_callback({'state':'rejected','code':'forbidden' if mode['fatal'] else 'invalid_arguments'}))
            read={'from':'2026-11-01','to':'2026-11-04','limit':100,'offset':0}
            callback('list_tasks',read,{'state':'ok','data':{'items':[],'nextOffset':None,'collectionVersion':0}})
            callback('create_task',{'title':'Synthetic','date':'2026-11-02','expectedVersion':0},{'state':'applied','id':'created-task','version':1})
            callback('set_task_completed',{'id':'created-task','expectedVersion':1,'completed':True},{'state':'applied','id':'created-task','version':2})
            if not mode['omit_final_read']:
                task={'id':'created-task','title':'Synthetic','date':'2026-11-02','notes':'','important':False,'completed':True,'deleted':False,'recurring':False,'version':2}
                callback('list_tasks',read,{'state':'ok','data':{'items':[task],'nextOffset':None,'collectionVersion':2}})
            callback('create_project',{'title':'Synthetic project','category':'personal','importance':2,'remainingMinutes':0,'progress':''},{'state':'applied','id':'created-project','version':1})
            callback('list_projects',{'id':'created-project','limit':1},{'state':'ok','data':{'items':[] if mode['missing_project'] else [{'id':'created-project','version':1}],'nextOffset':None}})
            if mode['unrecovered']:
                callback('list_tasks',invalid,raw=native_error_callback({'state':'rejected','code':'invalid_arguments'}))
            return {'final':'never used as evidence'}
        agent.run_conversation=Mock(side_effect=conversation)
        modules={'tools':types.ModuleType('tools'),
            'tools.mcp_tool_discovery':types.SimpleNamespace(register_mcp_servers=Mock(return_value=names)),
            'tools.mcp_tool_lifecycle':types.SimpleNamespace(shutdown_mcp_servers=Mock()),
            'tools.registry':types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _n:'mcp-dcc_product_probe')),
            'run_agent':types.SimpleNamespace(AIAgent=factory)}
        modules['tools'].__path__=[]
        with patch.dict(sys.modules,modules):
            result=probe.run_probe(['/synthetic/node'],'tasks-projects',True)
            self.assertTrue(result['journey_pass'])
            self.assertEqual(result['recovered_refusals'],[{'stage':'service_refusal','code':'invalid_arguments','tool':'list_tasks','reason':'window_exceeds_93_days'}])
            mode['omit_final_read']=True
            with self.assertRaises(probe.ProbeFailure) as failure:probe.run_probe(['/synthetic/node'],'tasks-projects',True)
            self.assertEqual(failure.exception.diagnostic['code'],'completed_task_missing')
            mode['omit_final_read']=False;mode['fatal']=True
            with self.assertRaises(probe.ProbeFailure) as failure:probe.run_probe(['/synthetic/node'],'tasks-projects',True)
            self.assertEqual(failure.exception.diagnostic['code'],'forbidden')
            mode['fatal']=False;mode['unrecovered']=True
            with self.assertRaises(probe.ProbeFailure):probe.run_probe(['/synthetic/node'],'tasks-projects',True)
            mode['unrecovered']=False;mode['missing_project']=True
            with self.assertRaises(probe.ProbeFailure) as failure:probe.run_probe(['/synthetic/node'],'tasks-projects',True)
            self.assertEqual(failure.exception.diagnostic['code'],'project_missing')

    def test_fixture_command_refuses_application_startup_shell_and_injection(self):
        argv=['/usr/bin/node','--import','/synthetic/backend/node_modules/tsx/dist/loader.mjs','/synthetic/backend/test/mcp/product-stdio-fixture.ts']
        self.assertEqual(probe.validate_fixture_argv(argv),argv)
        for bad in [None,[],['/bin/sh',*argv[1:]],['node',*argv[1:]],['/usr/bin/node','/synthetic/backend/src/server.ts'],[*argv,';echo private'],[*argv,'/private/.env']]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):probe.validate_fixture_argv(bad)

    def test_full_catalog_stable_readonly_phase_requires_real_callback_receipts_not_prose(self):
        names=['mcp__dcc_product_probe__'+t for t in sorted(probe.PRODUCT_TOOLS)]
        schemas=[{'type':'function','function':{'name':name,'parameters':{'type':'object','properties':{}}}} for name in names]
        next(t for t in schemas if t['function']['name'].endswith('__get_operation_status'))['function']['parameters'].update(properties={'operationKey':{'type':'string'}},required=['operationKey'],additionalProperties=False)
        register=Mock(return_value=names);shutdown=Mock();options={}
        agent=types.SimpleNamespace(tools=schemas,valid_tool_names=set(names),close=Mock())
        def factory(**kwargs):options.update(kwargs);return agent
        def conversation(**_kwargs):
            for name in sorted(probe.PHASES['cached-reads'][1]):
                envelope={'source':'dcc-service','result':{'state':'ok','data':{}}}
                options['tool_complete_callback']('synthetic-call','mcp__dcc_product_probe__'+name,{},json.dumps({'result':envelope}))
            return {'final':'not an effect receipt'}
        agent.run_conversation=Mock(side_effect=conversation)
        modules={'tools':types.ModuleType('tools'),
            'tools.mcp_tool_discovery':types.SimpleNamespace(register_mcp_servers=register),
            'tools.mcp_tool_lifecycle':types.SimpleNamespace(shutdown_mcp_servers=shutdown),
            'tools.registry':types.SimpleNamespace(registry=types.SimpleNamespace(get_toolset_for_tool=lambda _n:'mcp-dcc_product_probe')),
            'run_agent':types.SimpleNamespace(AIAgent=factory)}
        modules['tools'].__path__=[]
        with patch.dict(sys.modules,modules):
            result=probe.run_probe(['/synthetic/node'],'cached-reads',True)
            self.assertTrue(result['journey_pass']);self.assertEqual(result['catalog_count'],36)
            self.assertEqual(register.call_args.args[0]['dcc_product_probe']['tools']['include'],sorted(probe.PRODUCT_TOOLS))
            self.assertEqual(options['max_iterations'],8)
            agent.run_conversation=Mock(return_value={'final':'all done'})
            with self.assertRaises(ValueError):probe.run_probe(['/synthetic/node'],'cached-reads',True)

    def test_only_revision_conflict_read_retry_recovers_and_diagnostics_are_content_free(self):
        tracker=probe.ReceiptTracker()
        def record(tool,args,result):
            tracker.record('mcp__dcc_product_probe__'+tool,args,json.dumps({'result':{'source':'dcc-service','result':result}}))
        args={'expectedVersion':1,'id':'synthetic','completed':True}
        record('set_task_completed',args,{'state':'conflict','code':'revision_mismatch'})
        self.assertTrue(tracker.pending)
        record('list_tasks',{'from':'2026-11-01','to':'2026-11-04','limit':100}, {'state':'ok','data':{'items':[],'nextOffset':None,'collectionVersion':2}})
        record('set_task_completed',{**args,'expectedVersion':2},{'state':'applied','id':'synthetic','version':3})
        self.assertFalse(tracker.pending)
        for result in [{'state':'rejected','code':'forbidden'},{'state':'conflict','code':'operation_key_mismatch'},{'state':'applied','id':'private content','version':'bad'}]:
            with self.assertRaises(probe.ProbeFailure) as error:record('set_task_completed',args,result)
            self.assertNotIn('private content',repr(error.exception.diagnostic))
        tracker=probe.ReceiptTracker()
        record('set_task_completed',args,{'state':'conflict','code':'revision_mismatch'})
        with self.assertRaises(probe.ProbeFailure):record('set_task_completed',{**args,'expectedVersion':2},{'state':'applied','id':'synthetic','version':3})
        with self.assertRaises(probe.ProbeFailure):record('list_tasks',{}, {'state':'ok','data':{}})
        with self.assertRaises(probe.ProbeFailure):record('set_task_completed',args,{'state':'applied','id':'wrong-target','version':3})


if __name__=='__main__':unittest.main()
