// Parent-only isolated acceptance construction. Importing this module does not
// connect a database, start a listener, launch Hermes or read any environment.
// Use an isolated real Pool/provider fixture to obtain real acceptance evidence.
import type {Pool} from 'pg'
import {buildApp} from '../../src/app.js'
import {TaskActions,type TaskBridge} from '../../src/mcp/task-actions.js'
import type {ServiceOptions} from '../../src/mcp/service-transport.js'

export type RuntimeIsolation={database:{host:'127.0.0.1'|'::1';port:number;name:string;disposable:true};syntheticDataOnly:true;model:'gpt-6-luna';modelInvocationApproved:true;calendar:'none'|'synthetic-loopback';calendarOrigins:string[]}
export function validateRuntimeIsolation(pool:Pool,metadata:RuntimeIsolation){
  const db=metadata?.database
  if(!db||!['127.0.0.1','::1'].includes(db.host)||!Number.isInteger(db.port)||db.port<1024||db.port>65535||[3001,5301,5432].includes(db.port)||!/^dcc_qa_[a-z0-9_]{1,48}$/.test(db.name)||db.disposable!==true||metadata.syntheticDataOnly!==true||metadata.model!=='gpt-6-luna'||metadata.modelInvocationApproved!==true)throw Error('Disposable synthetic runtime metadata required')
  // Inspect only public endpoint metadata, never credentials/connection strings.
  if(pool.options.host!==db.host||Number(pool.options.port)!==db.port||pool.options.database!==db.name)throw Error('Pool target does not match isolated metadata')
  if(!['none','synthetic-loopback'].includes(metadata.calendar)||!Array.isArray(metadata.calendarOrigins)||metadata.calendarOrigins.length>4||metadata.calendar==='none'&&metadata.calendarOrigins.length||metadata.calendar==='synthetic-loopback'&&!metadata.calendarOrigins.length)throw Error('Explicit synthetic calendar metadata required')
  for(const origin of metadata.calendarOrigins){const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','[::1]'].includes(url.hostname)||url.origin!==origin||url.username||url.password)throw Error('Calendar fixture must be loopback-only')}
}

export function authenticatedRuntimeFixture(options:{
  isolatedSyntheticOnly:true
  isolation:RuntimeIsolation
  pool:Pool
  origin:string
  bridge:TaskBridge
  now?:()=>number
  calendarSnapshot?:ServiceOptions['calendarSnapshot']
  guardedCalendarWriter?:ServiceOptions['guardedCalendarWriter']
}){
  if(options.isolatedSyntheticOnly!==true||new URL(options.origin).origin!==options.origin)throw Error('Explicit isolated synthetic acceptance required')
  validateRuntimeIsolation(options.pool,options.isolation)
  if(options.isolation.calendar==='none'&&(options.calendarSnapshot||options.guardedCalendarWriter))throw Error('Calendar callbacks require synthetic calendar isolation metadata')
  // Metadata fences accidental targets before construction. It cannot prove that
  // injected executable callbacks obey it; parent must inspect/own those adapters.
  // Deliberately synthetic identities; never use this test factory in deployment.
  const sessions=new Map<string,{identity:string;expires:number}>()
  const actions=new TaskActions({pool:options.pool,actorId:'synthetic-runtime-acceptance',bridge:options.bridge,
    ...(options.now?{now:options.now}:{}),
    ...(options.calendarSnapshot?{calendarSnapshot:options.calendarSnapshot}:{}),
    ...(options.guardedCalendarWriter?{guardedCalendarWriter:options.guardedCalendarWriter}:{})})
  return buildApp({plannerPool:options.pool,taskActions:actions,...(options.calendarSnapshot?{calendarSnapshot:options.calendarSnapshot}:{}),auth:{username:'synthetic-qa',password:'synthetic-isolated-qa-only',origin:options.origin,store:{
    put:async(id,identity,expires)=>{sessions.set(id,{identity,expires})},
    has:async(id,identity)=>{const s=sessions.get(id);return !!s&&s.identity===identity&&s.expires>Date.now()},
    remove:async id=>{sessions.delete(id)},
  }}})
}
