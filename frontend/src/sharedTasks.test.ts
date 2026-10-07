import {test,expect} from 'vitest'
import {mergeTasks,type SharedTask} from './sharedTasks'
const t=(id:string,title=id):SharedTask=>({id,title,date:'2026-10-04',notes:'',completed:false})
test('imports local tasks while preserving remote tasks',()=>{expect(mergeTasks([],[t('a')],[t('b')]).tasks).toHaveLength(2)})
test('merges independent edits and propagates deletions as hidden tombstones',()=>{expect(mergeTasks([t('a'),t('b')],[t('a','edit')],[t('a'),t('b'),t('c')]).tasks).toEqual([t('a','edit'),{...t('b'),deleted:true},t('c')])})
test('conflicts never silently overwrite',()=>{expect(mergeTasks([t('a')],[t('a','local')],[t('a','remote')]).conflicts).toEqual(['a']);expect(mergeTasks([t('a')],[t('a','local')],[t('a','remote')],'remote').tasks).toEqual([t('a','remote')])})
test('sample data never syncs',()=>{expect(mergeTasks([],[{...t('a'),sample:true}],[]).tasks).toEqual([])})
test('remote tombstones remain tombstones instead of resurrecting tasks',()=>{const deleted={...t('a'),deleted:true};expect(mergeTasks([t('a')],[t('a')],[deleted]).tasks).toEqual([deleted])})
test('a stale peer cannot resurrect a task deleted by a synced client',()=>{const deleted={...t('a'),deleted:true};expect(mergeTasks([],[t('a')],[deleted]).tasks).toEqual([deleted])})
test('physical deletion from an older client becomes a retained tombstone',()=>{expect(mergeTasks([t('a')],[t('a')],[]).tasks).toEqual([{...t('a'),deleted:true}])})
test('an older client omitting an existing tombstone does not compact it',()=>{const deleted={...t('a'),deleted:true};expect(mergeTasks([deleted],[deleted],[]).tasks).toEqual([deleted])})
test('explicit undo restores a tombstone without losing unrelated edits',()=>{const deleted={...t('a'),deleted:true};expect(mergeTasks([deleted],[{...deleted,deleted:false}],[deleted,t('b')]).tasks).toEqual([{...deleted,deleted:false},t('b')])})
