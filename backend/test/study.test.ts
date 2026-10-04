import {test} from 'node:test'
import assert from 'node:assert/strict'
import {studyCandidates,resolveExam,validateOutline} from '../src/study.js'
const event={id:'old',calendarId:'c',uid:'u',recurrenceId:null,start:'2026-10-12',allDay:true}
const prep={id:'prep',title:'Midterm',event, startDate:'2026-10-03',status:'active',topics:[{id:'t',title:'Logistic regression',notes:'Read supplied slides',minutes:90}],progress:''}
test('exam identity survives moved standalone event and never matches another occurrence',()=>{
 assert.equal(resolveExam(prep,[{...event,id:'new',start:'2026-10-15'}])?.start,'2026-10-15')
 assert.equal(resolveExam({...prep,event:{...event,recurrenceId:'one'}},[{...event,recurrenceId:'two'}]),undefined)
})
test('study waits for start, stops on exam date, revisits weak work and carries unfinished topics',()=>{
 assert.equal(studyCandidates([prep],[event],[], '2026-10-02').length,0)
 assert.equal(studyCandidates([prep],[event],[], '2026-10-12').length,0)
 assert.equal(studyCandidates([prep],[event],[], '2026-10-04').length,1)
 const done={projectId:'prep:t',completed:true,dismissed:false,feedback:'comfortable',minutes:90}
 assert.equal(studyCandidates([prep],[event],[done], '2026-10-04').length,0)
 assert.equal(studyCandidates([prep],[event],[{...done,feedback:'review'}], '2026-10-04').length,1)
})
test('untrusted extraction is bounded and requires valid topic structure',()=>{
 assert.throws(()=>validateOutline({topics:[{title:'Invented',minutes:-1}]}))
 assert.equal(validateOutline({topics:[{title:'Classification',notes:'Source: guide',minutes:45}],progress:'Not yet assessed'}).topics.length,1)
})
