import {test,expect} from 'vitest'
import {mergeTasks,type SharedTask} from './sharedTasks'
const t=(id:string,title=id):SharedTask=>({id,title,date:'2026-10-04',notes:'',completed:false})
test('imports local tasks while preserving remote tasks',()=>{expect(mergeTasks([],[t('a')],[t('b')]).tasks).toHaveLength(2)})
test('merges independent edits and propagates deletions',()=>{expect(mergeTasks([t('a'),t('b')],[t('a','edit')],[t('a'),t('b'),t('c')]).tasks).toEqual([t('a','edit'),t('c')])})
test('conflicts never silently overwrite',()=>{expect(mergeTasks([t('a')],[t('a','local')],[t('a','remote')]).conflicts).toEqual(['a']);expect(mergeTasks([t('a')],[t('a','local')],[t('a','remote')],'remote').tasks).toEqual([t('a','remote')])})
test('sample data never syncs',()=>{expect(mergeTasks([],[{...t('a'),sample:true}],[]).tasks).toEqual([])})
test('remote tombstones remain tombstones instead of resurrecting tasks',()=>{const deleted={...t('a'),deleted:true};expect(mergeTasks([t('a')],[t('a')],[deleted]).tasks).toEqual([deleted])})
