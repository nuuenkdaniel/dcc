"""Source-only policy audit; no providers, config files or Hermes imports."""
import ast
from pathlib import Path
import runpy
import unittest
from datetime import datetime,timezone

ROOT=Path(__file__).parent


class ModelPolicyTests(unittest.TestCase):
    def test_reference_time_is_explicit_new_york_offset_across_fold_and_leap_day(self):
        context=runpy.run_path(str(ROOT/'dcc_model_policy.py'))['inference_context']
        self.assertIn('2026-11-01T01:30:00-04:00',context(datetime(2026,11,1,5,30,tzinfo=timezone.utc)))
        self.assertIn('2026-11-01T01:30:00-05:00',context(datetime(2026,11,1,6,30,tzinfo=timezone.utc)))
        self.assertIn('2028-02-29T00:00:00-05:00',context(datetime(2028,2,29,5,tzinfo=timezone.utc)))
    def test_every_production_and_probe_constructor_uses_exact_shared_policy_without_fallback(self):
        policy=runpy.run_path(str(ROOT/'dcc_model_policy.py'))['agent_policy']
        self.assertEqual(policy(),{'provider':'openai-codex','requested_provider':'openai-codex','model':'gpt-6-luna'})
        found=[]
        for path in ROOT.glob('*.py'):
            if path.name.startswith('test_'):continue
            source=path.read_text();tree=ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='AIAgent':
                    found.append(path.name)
                    self.assertFalse(any(k.arg in ('model','provider','requested_provider') for k in node.keywords),path.name)
                    self.assertTrue(any(k.arg is None and isinstance(k.value,ast.Call) and isinstance(k.value.func,ast.Name) and k.value.func.id=='agent_policy' for k in node.keywords),path.name)
        self.assertEqual(set(found),{'task_action_runtime.py','read_context_runtime.py','product_mcp_probe.py','hermes_mcp_probe.py'})

    def test_policy_loads_by_absolute_sibling_path_under_isolated_run_path(self):
        source=(ROOT/'task_action_runtime.py').read_text()
        tree=ast.parse(source)
        # Execute only the public policy-loading assignment, not runtime/model code.
        assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='agent_policy' for t in n.targets))
        namespace={'Path':Path,'run_path':runpy.run_path,'__file__':str((ROOT/'task_action_runtime.py').resolve())}
        exec(compile(ast.Module(body=[assignment],type_ignores=[]),'synthetic_policy_load','exec'),namespace)
        self.assertEqual(namespace['agent_policy']()['model'],'gpt-6-luna')

if __name__=='__main__':unittest.main()
