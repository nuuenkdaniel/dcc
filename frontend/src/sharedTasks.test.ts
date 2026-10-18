import {test,expect} from 'vitest'
import {equalSharedTask,validSharedTask,mergeTasks,type SharedTask} from './sharedTasks'
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

const recurrence={version:1,kind:'template',frequency:'weekly',weekday:5,startDate:'2026-10-02',paused:false}
const template=()=>({...t('weekly'),recurrence,extension:{b:2,a:1}})
test('validates exact weekly template and independent occurrence contracts',()=>{
 expect(validSharedTask(template())).toBe(true)
 expect(validSharedTask({...t('occ.weekly.2026-10-09'),date:'2026-10-12',completed:true,deleted:true,recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}})).toBe(true)
})
test.each([null,{}, {...recurrence,version:2},{...recurrence,weekday:7},{...recurrence,weekday:1.5},{...recurrence,paused:'false'},{...recurrence,startDate:'2026-02-30'},{...recurrence,extra:true},{...recurrence,frequency:'daily'}, {version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}])('rejects malformed recurrence or mismatched occurrence identity %j',value=>{
 expect(validSharedTask({...t('weekly'),recurrence:value})).toBe(false)
})
test('compares all additive fields independent of JSON object key order',()=>{
 const old=template()
 expect(equalSharedTask(old,{...old,recurrence:{...recurrence,paused:true}})).toBe(false)
 expect(equalSharedTask(old,{...old,extension:{a:1,b:2}})).toBe(true)
 expect(equalSharedTask(old,{...old,extension:{a:2,b:2}})).toBe(false)
})
test('recurrence-only concurrent updates conflict and independent remote update survives',()=>{
 const old=template(),mine={...old,recurrence:{...recurrence,paused:true}},remote={...old,recurrence:{...recurrence,weekday:3}}
 expect(mergeTasks([old],[mine],[remote]).conflicts).toEqual(['weekly'])
 expect(mergeTasks([old],[old],[remote]).tasks).toEqual([remote])
})
test('stripped recurrence fails closed even when resolving conflicts',()=>{
 const old=template(),stripped=t('weekly','old client edit')
 expect(()=>mergeTasks([old],[stripped],[old],'local')).toThrow(/recurrence/i)
 expect(()=>mergeTasks([],[stripped],[old],'local')).toThrow(/recurrence/i)
})
test('legacy projections do not discard unrelated additive fields during merge',()=>{
 const old={...t('a'),extension:{keep:true}},edited=t('a','old client edit')
 expect(mergeTasks([old],[edited],[old]).tasks).toEqual([{...old,title:edited.title}])
})
test('kind changes cannot downgrade occurrence metadata',()=>{
 const old={...t('occ.weekly.2026-10-09'),recurrence:{version:1,kind:'occurrence',templateId:'weekly',sourceDate:'2026-10-09'}}
 expect(()=>mergeTasks([old],[{...old,recurrence}],[old])).toThrow(/recurrence/i)
})
