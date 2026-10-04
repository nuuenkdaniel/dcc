import {test} from 'node:test'
import assert from 'node:assert/strict'
import {budgetForDay,validatePlan} from '../src/planner-policy.js'
test('budget protects rest and subtracts overlapping events once',()=>{
 const now=new Date('2026-10-05T10:00:00Z')
 const events=[{start:'2026-10-05T13:00:00Z',end:'2026-10-05T15:00:00Z',allDay:false},{start:'2026-10-05T14:00:00Z',end:'2026-10-05T16:00:00Z',allDay:false}]
 assert.equal(budgetForDay(now,events).minutes,330)
 assert.equal(budgetForDay(new Date('2026-10-05T23:00:00Z'),[]).minutes,0)
 assert.equal(budgetForDay(now,[{start:'2026-10-05',end:'2026-10-06',allDay:true}]).minutes,0)
})
test('reject model references, duplicate projects and over-budget output',()=>{
 const projects=[{id:'p',remainingMinutes:60}]
 const action={projectId:'p',title:'Read chapter one',notes:'Review examples',minutes:30}
 assert.equal(validatePlan({actions:[action],summary:'One focused step'},projects,60).actions.length,1)
 for(const actions of [[{...action,projectId:'unknown'}],[action,action],[{...action,minutes:90}]])assert.throws(()=>validatePlan({actions,summary:''},projects,60))
})
