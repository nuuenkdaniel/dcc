// Pure synthetic source regressions only. No listeners/browser/PG/model/imports
// of executable opt-in runner entrypoints.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ICAL from 'ical.js'
import {staticAsset} from '../acceptance/static-app.js'
import {EASTERN_ZONE,expanded,allowedResource,putStatus} from '../acceptance/calendar-provider.js'
import {JourneyRuntime} from '../acceptance/journey-runtime.js'
import {buildScopedEventResource,type EventChange} from '../../src/calendar-write.js'
import {clarification,validClarification} from '../../src/mcp/clarification.js'

test('QA static/resource paths reject traversal, credentials/query tricks and private files',()=>{
  assert.equal(staticAsset('/pomodoro'),'index.html')
  assert.equal(staticAsset('/assets/index-abcd.js'),'assets/index-abcd.js')
  for(const path of ['/assets/../private.js','/assets/%2e%2e/private.js','/.env','/api/v1/auth/session','//assets/index.js','/assets/file.js.map','/assets/x.js?private','/assets/x.js\n'])assert.equal(staticAsset(path),null)
  assert.equal(allowedResource('/school/1234.ics'),true)
  for(const path of ['/school/../work/event.ics','/school/%2e%2e/x.ics','http://example.invalid/school/x.ics','/personal/x.ics','/work/x.ics?redirect','/work/x.ics\n'])assert.equal(allowedResource(path),false)
})
test('synthetic HTTP provider requires exactly conditional create/update semantics',()=>{
  const resource={body:'synthetic',etag:'"one"'}
  assert.equal(putStatus(undefined,undefined,'*'),201)
  assert.equal(putStatus(resource,'"one"',undefined),204)
  for(const pair of [[undefined,undefined],['"stale"',undefined],['"one"','*']] as const)assert.equal(putStatus(resource,pair[0],pair[1]),412)
  assert.equal(putStatus(undefined,'"one"',undefined),412)
})
const create:EventChange={id:'12345678-1234-4234-a234-123456789abc',scope:'series',title:'Synthetic weekly',start:'2026-11-02T14:00:00Z',end:'2026-11-02T15:00:00Z',allDay:false,description:'Synthetic',location:'QA room',timezone:'America/New_York',rrule:'FREQ=WEEKLY;COUNT=4',rdates:['2026-11-04T14:00:00Z'],exdates:['2026-11-23T14:00:00Z']}
test('real ICAL snapshot expansion preserves named-zone identities, RDATE/EXDATE and cancelled/shifted exceptions',()=>{
  const body=buildScopedEventResource(create,undefined,EASTERN_ZONE)
  const initial=expanded(body,'synthetic-school','http://127.0.0.1:18535/school/test.ics','"one"')
  assert.equal(initial.length,4)
  assert.equal(initial[0]!.start,'2026-11-02T14:00:00.000Z')
  assert.equal(initial[0]!.recurrenceId,'2026-11-02T09:00:00')
  assert.ok(initial.some(e=>e.start==='2026-11-04T14:00:00.000Z'))
  assert.ok(!initial.some(e=>e.start.startsWith('2026-11-23')))
  const uid=initial[0]!.uid
  const {timezone:_zone,rrule:_rule,rdates:_dates,exdates:_excluded,...editFields}=create
  const shifted=buildScopedEventResource({...editFields,id:'22345678-1234-4234-a234-123456789abc',scope:'single',uid,recurrenceId:'2026-11-09T09:00:00',start:'2026-11-09T15:00:00Z',end:'2026-11-09T16:00:00Z'},body)
  const cancelled=buildScopedEventResource({id:'32345678-1234-4234-a234-123456789abc',scope:'single',operation:'delete',uid,recurrenceId:'2026-11-16T09:00:00',title:create.title,start:'2026-11-16T14:00:00Z',end:'2026-11-16T15:00:00Z',allDay:false,description:'Synthetic',location:'QA room'},shifted)
  const final=expanded(cancelled,'synthetic-school','http://127.0.0.1:18535/school/test.ics','"three"')
  assert.equal(final.length,3)
  const original=initial.find(e=>e.recurrenceId==='2026-11-09T09:00:00')!,edit=final.find(e=>e.recurrenceId===original.recurrenceId)!
  assert.equal(edit.id,original.id);assert.equal(edit.uid,uid);assert.equal(edit.start,'2026-11-09T15:00:00.000Z')
  assert.ok(!final.some(e=>e.recurrenceId==='2026-11-16T09:00:00'))
  const root=new ICAL.Component(ICAL.parse(cancelled))
  assert.equal(root.getFirstSubcomponent('vtimezone')!.toString(),new ICAL.Component(ICAL.parse(EASTERN_ZONE)).toString())
  assert.throws(()=>buildScopedEventResource({id:'42345678-1234-4234-a234-123456789abc',uid,scope:'series',title:create.title,start:'2026-11-02',end:'2026-11-03',allDay:true,description:'',location:''},cancelled))
})
test('DST envelope checks are exact server questions, not claimed model interpretation',()=>{
  for(const reason of ['dst_gap','dst_fold'] as const){const value=clarification(reason);assert.equal(validClarification(value),true);assert.equal(validClarification({...value,question:'Invented question'}),false)}
})
test('journey model bound refuses an eleventh call or task-only mode before any spawn',async()=>{
  const runtime=new JourneyRuntime(new AbortController().signal)
  const input={mode:'product-action' as const,prompt:'Synthetic',callbackCapability:'a'.repeat(64),expiresAt:Date.now()+120000}
  await assert.rejects(runtime.invoke({...input,mode:'task-action'},new AbortController().signal))
  assert.equal(runtime.calls,0)
  runtime.calls=10
  await assert.rejects(runtime.invoke(input,new AbortController().signal))
  assert.equal(runtime.calls,10)
})
test('core runner strips the inet CIDR display only, retaining exact target/version/empty guards',async()=>{
  const source=await readFile(new URL('../acceptance/authenticated-runtime.ts',import.meta.url),'utf8')
  assert.ok(source.includes('host(inet_server_addr()) AS host'))
  assert.ok(!source.includes('inet_server_addr()::text'))
  assert.ok(source.includes("actual.port===18533&&actual.host==='127.0.0.1'&&actual.version>=170000&&actual.version<180000"))
  assert.ok(source.includes('check((await rows()).length===0)'))
})
