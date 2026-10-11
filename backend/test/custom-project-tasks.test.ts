import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {Pool} from 'pg'
import {isAutomatedAction,previewCustomProjectTasks,saveEntity,scheduledActionMinutes,validateCustomProjectSuggestions} from '../src/planner.js'
import {buildApp} from '../src/app.js'

type Row={kind:string;version:number;data:Record<string,unknown>}
function plannerPool(rows:Map<string,Row>){
 const calls:string[]=[]
 const client={
  async query(sql:string,values:unknown[]=[]){
   calls.push(sql)
   if(sql.startsWith('SELECT kind,version,data FROM planner_entities WHERE id=')){const row=rows.get(String(values[0]));return {rows:row?[row]:[]}}
   if(sql.includes("WHERE id=$1 AND kind='project'")){const row=rows.get(String(values[0]));return {rows:row?.kind==='project'?[{id:values[0],data:row.data}]:[]}}
   if(sql.startsWith('INSERT INTO planner_entities')){const id=String(values[0]),old=rows.get(id);rows.set(id,{kind:String(values[1]),version:(old?.version??0)+1,data:values[2] as Record<string,unknown>});return {rows:[]}}
   return {rows:[]}
  },
  release(){},
 }
 return {pool:{connect:async()=>client,query:client.query.bind(client)} as unknown as Pool,calls}
}

const project=(id:string)=>({id,title:'Custom task project',category:'personal',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'})
const action=(id:string,projectId:string)=>({id,source:'manual-project',projectId,title:'Draft outline',date:'2026-10-10',minutes:30,notes:'Cover the first section',completed:false,dismissed:false})

test('manual project actions require a real date and existing project while generated-source creation stays blocked',async()=>{
 const projectId=randomUUID(),rows=new Map<string,Row>([[projectId,{kind:'project',version:1,data:project(projectId)}]])
 const {pool,calls}=plannerPool(rows),id=randomUUID()
 assert.equal((await saveEntity(pool,'action',0,{...action(id,projectId),date:'2026-02-30'})).code,400)
 assert.equal((await saveEntity(pool,'action',0,action(id,randomUUID()))).code,400)
 assert.equal((await saveEntity(pool,'action',0,{...action(id,projectId),source:'generated'})).code,400)
 assert.equal((await saveEntity(pool,'action',0,action(id,projectId))).code,200)
 assert.ok(calls.findIndex(sql=>sql.includes('pg_advisory_xact_lock'))<calls.findIndex(sql=>sql.includes("kind='project'")))
 const edit={...action(id,projectId),date:'2026-10-12',minutes:45,notes:'Keep my notes',completed:true}
 assert.equal((await saveEntity(pool,'action',1,edit)).code,200)
 assert.equal(rows.get(id)?.data.date,'2026-10-12')
 assert.equal((await saveEntity(pool,'action',2,{...edit,source:'assignment'})).code,400)
})

test('manual project actions are excluded from automated source matching and mutation selection',()=>{
 assert.equal(isAutomatedAction({source:'manual-project'}),false)
 assert.equal(isAutomatedAction({assignmentStep:true}),true)
 assert.equal(isAutomatedAction({}),true)
})

test('automated planning budget reserves all non-dismissed dated actions including manual project work',()=>{
 const day='2026-10-10'
 assert.equal(scheduledActionMinutes([
  {date:day,minutes:45,source:'manual-project',dismissed:false},
  {date:day,minutes:30,dismissed:false},
  {date:day,minutes:20,source:'manual-project',dismissed:true},
  {date:'2026-10-11',minutes:60,source:'manual-project',dismissed:false},
 ],day),75)
})

test('custom Hermes preview is bounded, date-valid, project-scoped and never writes',async()=>{
 const projectId=randomUUID(),rows=new Map<string,Row>([[projectId,{kind:'project',version:1,data:project(projectId)}]])
 const {pool,calls}=plannerPool(rows)
 const suggestions=await previewCustomProjectTasks(pool,{projectId,prompt:'Plan Oct 10 through Oct 12',dateWindow:{start:'2026-10-10',end:'2026-10-12'}},async input=>{
  const request=input as {mode:string;timezone:string;referenceDate:string;project:{id:string}}
  assert.equal(request.mode,'custom-project-tasks')
  assert.equal(request.timezone,'America/New_York')
  assert.match(request.referenceDate,/^\d{4}-\d{2}-\d{2}$/)
  assert.equal(request.project.id,projectId)
  return {suggestions:[{title:'Outline',date:'2026-10-10',minutes:25,notes:'Use project context'}]}
 })
 assert.deepEqual(suggestions,{suggestions:[{title:'Outline',date:'2026-10-10',minutes:25,notes:'Use project context'}]})
 assert.equal(calls.some(sql=>/INSERT|UPDATE|DELETE/.test(sql)),false)
 assert.throws(()=>validateCustomProjectSuggestions({suggestions:[{title:'Bad date',date:'2026-02-30',minutes:30,notes:''}]},{start:'2026-02-01',end:'2026-03-01'}))
 assert.throws(()=>validateCustomProjectSuggestions({suggestions:[{title:'Outside',date:'2026-10-13',minutes:30,notes:''}]},{start:'2026-10-10',end:'2026-10-12'}))
})

test('custom preview retains existing session and same-origin protection',async()=>{
 const pool={query(){throw Error('Unauthenticated request reached planner')}} as unknown as Pool
 const app=buildApp({plannerPool:pool,auth:{username:'test',password:'test-only',origin:'https://dcc.invalid',store:{async put(){},async has(){return false},async remove(){}}}})
 try{
  const payload={projectId:randomUUID(),prompt:'Plan Oct 10'}
  assert.equal((await app.inject({method:'POST',url:'/api/v1/planner/custom-project-preview',headers:{origin:'https://other.invalid'},payload})).statusCode,403)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/planner/custom-project-preview',headers:{origin:'https://dcc.invalid'},payload})).statusCode,401)
 }finally{await app.close()}
})
