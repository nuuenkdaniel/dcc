// Synthetic pure contract tests; not installed-model or PostgreSQL acceptance.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {interpretTasks,conversationTextFits,nyDate} from '../../src/mcp/conversation-contract.js'
const original='I have an exam coming up for CSE354 I need to study 3 chunks today can you put that in my tasks'
test('three chunks remains three goals; explicit topics or authorized general labels only',()=>{
  assert.equal(interpretTasks(original,[],'2026-11-08').kind,'question')
  const named=interpretTasks(original,['Lectures, practice problems, and review'],'2026-11-08')
  assert.equal(named.kind,'checklist')
  if(named.kind==='checklist')assert.deepEqual(named.checklist.tasks,[
    {title:'CSE354: Lectures',date:'2026-11-08'},
    {title:'CSE354: practice problems',date:'2026-11-08'},
    {title:'CSE354: review',date:'2026-11-08'},
  ])
  assert.equal(interpretTasks(original,['Lectures and review'],'2026-11-08').kind,'question')
  const general=interpretTasks(original,['just general chunks'],'2026-11-08')
  assert.equal(general.kind,'checklist')
  if(general.kind==='checklist')assert.equal(general.checklist.tasks.length,3)
})
test('clear names execute directly, unsupported extra intent cannot claim complete',()=>{
  assert.equal(interpretTasks('Add 3 tasks today: Lectures; practice problems; review',[],'2026-11-08').kind,'checklist')
  assert.equal(interpretTasks('Add 3 tasks today: Lectures; review',[],'2026-11-08').kind,'question')
  assert.equal(interpretTasks('Delete tasks and send email',[],'2026-11-08').kind,'unsupported')
  assert.equal(interpretTasks(original+' Also mark them important.',[],'2026-11-08').kind,'unsupported')
  assert.equal(interpretTasks('Add 3 tasks today: study 2 chunks; review',[],'2026-11-08').kind,'question')
})
test('UTF-16 AND UTF-8 combined caps, no control text; NY date is not the client date',()=>{
  assert.equal(conversationTextFits(['a'.repeat(4000)]),true)
  assert.equal(conversationTextFits(['a'.repeat(4000),'x']),false)
  assert.equal(conversationTextFits(['界'.repeat(3000)]),false)
  assert.equal(conversationTextFits(['bad\u0000']),false)
  assert.equal(conversationTextFits(['\ud800']),false)
  assert.equal(nyDate(Date.parse('2026-11-08T02:00:00Z')),'2026-11-07')
})
