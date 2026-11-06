import {test} from 'node:test'
import assert from 'node:assert/strict'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv'
import {TOOLS,validateArguments,type ToolName} from '../../src/mcp/contracts.js'
import {inputSchema} from '../../src/mcp/schemas.js'
import {parseMode} from '../../src/mcp/stdio.js'

test('discovery schemas derive required fields and strict allowlists from domain rules without coercion',()=>{
  const provider=new AjvJsonSchemaValidator()
  for(const name of Object.keys(TOOLS) as ToolName[]){
    const schema=inputSchema(name),fields=TOOLS[name].fields
    assert.deepEqual(Object.keys(schema.properties??{}).sort(),Object.keys(fields).sort())
    assert.equal(schema.additionalProperties,false)
    const validate=provider.getValidator(schema)
    const required=Object.entries(fields).filter(([,field])=>!field.optional).map(([key])=>key)
    assert.deepEqual([...(schema.required??[])].sort(),required.sort(),name)
    assert.equal(validate({}).valid,required.length===0,name)
    for(const value of [{url:'https://example.invalid'},{unknown:true},null,[],{limit:'1'}]){
      const before=structuredClone(value)
      assert.equal(validate(value).valid,false,name)
      assert.deepEqual(value,before,'no unknown-field removal or coercion: '+name)
    }
  }
  const validate=provider.getValidator(inputSchema('create_task'))
  const task={operationKey:'schema_synthetic_task_01',id:'Legacy.Task_AbC%2F',title:'Synthetic item',date:'2026-11-01'}
  for(const args of [task,{...task,date:'2028-02-29'},{...task,notes:'Synthetic\nnotes',important:true}]){
    assert.equal(validate(args).valid,true)
    assert.equal(validateArguments('create_task',args).valid,true)
  }
  for(const args of [{...task,date:'2026-02-30'},{...task,date:'1999-01-01'},{...task,date:'2101-01-01'},{...task,title:' '},{...task,important:'true'},{...task,title:'x'.repeat(241)},{...task,id:' spaced '},{...task,id:'Task_A\n'},{...task,operationKey:task.operationKey+'\n'},{...task,operationKey:'short'},{...task,notes:'bad\u0000text'},{...task,expectedVersion:1}]){
    const before=structuredClone(args)
    assert.equal(validate(args).valid,false,JSON.stringify(args))
    assert.deepEqual(args,before,'schema validation does not coerce or strip keys')
    assert.equal(validateArguments('create_task',args).valid,false)
  }
})

test('synthetic modes require an exact trusted launch opt-in, never environment or tool arguments',()=>{
  assert.equal(parseMode([]),'unconfigured')
  for(const mode of ['read','parser','planner','extraction','action-test'])assert.equal(parseMode([`--synthetic-${mode}`]),`synthetic-${mode}`)
  for(const args of [['--production'],['--synthetic-action'],['--synthetic-read','--synthetic-action-test'],['--synthetic-action-test=true'],['synthetic-action-test'],['--unconfigured']])assert.throws(()=>parseMode(args))
})

test('schemas require revisions, nonempty patches, strong ETags and explicit single-event time shape',()=>{
  const provider=new AjvJsonSchemaValidator()
  const task={operationKey:'schema_synthetic_task_01',id:'Task_A',expectedVersion:1,title:'Edited'}
  const validate=provider.getValidator(inputSchema('update_task'))
  assert.equal(validate(task).valid,true)
  const {title:_title,...empty}=task
  for(const args of [empty,{...task,expectedVersion:0},{...task,expectedVersion:'1'},{...task,completed:true}])assert.equal(validate(args).valid,false)
  const event={operationKey:'schema_synthetic_event_01',calendarId:'Calendar_A',eventId:'Event_A',expectedEtag:'"fake-1"',scope:'single',title:'Synthetic event',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',allDay:false}
  const check=provider.getValidator(inputSchema('update_calendar_event'))
  assert.equal(check(event).valid,true)
  assert.equal(check({...event,allDay:true,start:'2026-11-01',end:'2026-11-02'}).valid,true)
  for(const args of [{...event,scope:'series'},{...event,scope:undefined},{...event,recurrenceId:'2026-11-01'},{...event,expectedEtag:'*'},{...event,expectedEtag:'W/"fake-1"'},{...event,allDay:true},{...event,start:'2026-11-01T10:00:00+01:00'}])assert.equal(check(args).valid,false)
})
