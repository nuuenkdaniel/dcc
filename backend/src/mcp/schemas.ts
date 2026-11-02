import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import {TOOLS,DATE_SCHEMA,INSTANT_SCHEMA,type ToolName,type Definition} from './contracts.js'

// The low-level SDK Server accepts JSON Schema directly. Derive structural rules
// from the same allowlists/check metadata as the dispatcher, with no Zod dependency.
// Cross-field ordering/window limits remain authoritative dispatcher checks:
// standard JSON Schema cannot compare two caller-supplied dates or revisions.
export function inputSchema(name:ToolName):Tool['inputSchema'] {
  return schemaForDefinition(name,TOOLS[name])
}
export function schemaForDefinition(name:ToolName,definition:Definition):Tool['inputSchema'] {
  const fields=Object.entries(definition.fields)
  const allOf:Record<string,unknown>[]=[]
  if(definition.patch)allOf.push({anyOf:definition.patch.map(field=>({required:[field]}))})
  if(name==='create_calendar_event'||name==='update_calendar_event')allOf.push({
    if:{properties:{allDay:{const:true}},required:['allDay']},
    then:{properties:{start:DATE_SCHEMA,end:DATE_SCHEMA}},
    else:{properties:{start:INSTANT_SCHEMA,end:INSTANT_SCHEMA}},
  })
  return {
    type:'object',additionalProperties:false,
    properties:Object.fromEntries(fields.map(([field,rule])=>[field,structuredClone(rule.schema)])),
    required:fields.filter(([,rule])=>!rule.optional).map(([field])=>field),
    ...(allOf.length?{allOf}:{}),
    description:'Exact allowlisted fields; no coercion. Dates in 2000–2100. Dispatcher also checks real dates, positive exclusive-end intervals, task read windows <=93 days, event intervals <=31 days, and text length in UTF-16 code units. Explicit revisions and action capabilities are required for edits. No recurrence mutation.',
  }
}
