import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.js'
import type { SessionStore } from '../src/auth.js'

const password = randomBytes(24).toString('hex')
test('configured login requires origin and password; sessions revoke on logout', async () => {
 const sessions = new Map<string, {expires:number; identity:string}>()
 const store: SessionStore = {
  async put(id, identity, expires) { sessions.set(id,{identity,expires}) },
  async has(id,identity) { const entry=sessions.get(id); return !!entry && entry.identity===identity && entry.expires>Date.now() },
  async remove(id) { sessions.delete(id) },
 }
 const app = buildApp({ auth: { username:'tester',password,origin:'http://localhost:5173',store }, calendarSnapshot:async()=>({calendars:[],events:[],lastSuccess:null}) })
 try {
  const url='/api/v1/auth/login'; const payload={username:'tester',password}
  assert.equal((await app.inject({method:'POST',url,payload})).statusCode,403)
  const headers={origin:'http://localhost:5173'}
  assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,password:'invalid'}})).statusCode,401)
  const login=await app.inject({method:'POST',url,headers,payload})
   assert.equal(login.statusCode,200)
   assert.match(login.json().workspaceOwner,/^[a-f0-9]{64}$/)
   assert.equal(Object.hasOwn((await app.inject('/api/v1/auth/session')).json(),'workspaceOwner'),false)
  assert.equal((await app.inject('/api/v1/calendar/snapshot')).statusCode,401)
  const cookie=login.cookies[0]!
  assert.equal(cookie.httpOnly,true)
  assert.equal(cookie.sameSite,'Strict')
  const cookies={daymark_session:cookie.value}
  assert.equal((await app.inject({url:'/api/v1/calendar/snapshot',cookies})).statusCode,200)
   const session=(await app.inject({url:'/api/v1/auth/session',cookies})).json()
   assert.equal(session.authenticated,true)
   assert.equal(session.workspaceOwner,login.json().workspaceOwner)
   assert.notEqual(session.workspaceOwner,[...sessions.values()][0]!.identity)
   assert.notEqual(session.workspaceOwner,cookie.value)
  assert.equal([...sessions.keys()][0]===cookie.value,false)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers,cookies})).statusCode,200)
   assert.equal((await app.inject({url:'/api/v1/auth/session',cookies})).json().authenticated,false)
   assert.equal(Object.hasOwn((await app.inject({url:'/api/v1/auth/session',cookies})).json(),'workspaceOwner'),false)
 } finally { await app.close() }
})
test('public workspace owner is stable across logins/password rotation but changes with the configured account',async()=>{
 const owners:string[]=[]
 for(const [username,password] of [['synthetic-a','synthetic-password-one'],['synthetic-a','synthetic-password-two'],['synthetic-b','synthetic-password-one']]){
  const store:SessionStore={put:async()=>{},has:async()=>false,remove:async()=>{}}
  const app=buildApp({auth:{username:username!,password:password!,origin:'http://localhost:5173',store}})
  try{
   const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'http://localhost:5173'},payload:{username,password}})
   assert.equal(login.statusCode,200)
   assert.deepEqual(Object.keys(login.json()).sort(),['authenticated','workspaceOwner'])
   assert.match(login.json().workspaceOwner,/^[a-f0-9]{64}$/)
   owners.push(login.json().workspaceOwner)
  }finally{await app.close()}
 }
 assert.equal(owners[0],owners[1]);assert.notEqual(owners[0],owners[2])
})
