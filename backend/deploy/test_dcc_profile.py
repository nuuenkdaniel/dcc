"""Isolated DCC identity/memory tests; no credentials, model, network or service access."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import dcc_profile
import setup_dcc_profile as setup
import task_action_runtime as runtime


class ProfileTests(unittest.TestCase):
    def test_new_profile_seeds_no_personal_facts_and_preserves_learning_on_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            templates=Path(setup.__file__).with_name('dcc-profile')
            setup.initialize(home,templates)
            self.assertEqual(dcc_profile.validate_profile(home,home),home)
            user=home/'memories/USER.md'
            self.assertEqual(user.read_text(),'')
            user.write_text('Synthetic preference: concise replies.')
            with self.assertRaises((ValueError,FileExistsError)):
                setup.initialize(home,templates)
            self.assertEqual(user.read_text(),'Synthetic preference: concise replies.')
            self.assertFalse((home/'auth.json').exists())
            self.assertFalse((home/'.env').exists())
            with patch.object(setup,'PROFILE_HOME',home),patch.object(setup,'validate_profile',side_effect=lambda p:dcc_profile.validate_profile(p,home)),patch.object(setup.subprocess,'run') as run:
                setup.main()
            run.assert_not_called()
            self.assertEqual(user.read_text(),'Synthetic preference: concise replies.')

    def test_missing_or_other_profile_and_symlinked_memory_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            with self.assertRaises(ValueError):dcc_profile.validate_profile(home)
            with self.assertRaises(FileNotFoundError):dcc_profile.validate_profile(home,home)
            setup.initialize(home,Path(setup.__file__).with_name('dcc-profile'))
            other=home/'other.md';other.write_text('Unrelated memory')
            (home/'memories/USER.md').unlink();(home/'memories/USER.md').symlink_to(other)
            with self.assertRaises(ValueError):dcc_profile.validate_profile(home,home)

    def test_memory_is_the_only_extra_tool_and_schema_drift_is_detectable(self):
        selected={'list_tasks'}
        tools=[{'type':'function','function':{'name':'mcp__dcc_task__list_tasks','parameters':{'type':'object','properties':{}}}},
               {'type':'function','function':{'name':'memory','parameters':{'type':'object','properties':{key:{'type':'string'} for key in ('action','target','content','old_text')}}}}]
        names={t['function']['name'] for t in tools}
        group=lambda name:'memory' if name=='memory' else 'mcp-dcc_task'
        baseline=runtime.schema_snapshot(tools,names,selected,'dcc_task',group,memory=True)
        with self.assertRaises(ValueError):runtime.schema_snapshot(tools,names,selected,'dcc_task',group)
        with self.assertRaises(ValueError):runtime.schema_snapshot(tools,names,selected,'dcc_task',lambda _: 'shell',memory=True)
        tools[1]['function']['parameters']['properties']['extra']={'type':'string'}
        self.assertNotEqual(baseline,runtime.schema_snapshot(tools,names,selected,'dcc_task',group,memory=True))
        tools[1]['function']['name']='terminal'
        with self.assertRaises(ValueError):runtime.schema_snapshot(tools,{'terminal','mcp__dcc_task__list_tasks'},selected,'dcc_task',group,memory=True)


if __name__=='__main__':unittest.main()
