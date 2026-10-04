import { createHash, randomBytes, scryptSync, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
export interface SessionStore {
 put(id:string, identity:string, expires:number):Promise<void>
 has(id:string, identity:string):Promise<boolean>
 remove(id:string):Promise<void>
}
export type AuthConfig={username:string;password:string;origin:string;store:SessionStore}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
const derive=promisify(scrypt)
export async function registerAuth(app:FastifyInstance, config?:AuthConfig) {
 await app.register(cookie)
 await app.register(rateLimit,{global:false})
 const salt=randomBytes(32)
 const expected=config ? scryptSync(config.password,salt,64):null
 const identity=config ? digest(config.username+'\0'+config.password):''
 const authenticated=async (request:FastifyRequest)=>{
  const token=request.cookies.daymark_session
  return !!config && !!token && /^[a-f0-9]{64}$/.test(token) && await config.store.has(digest(token),identity)
 }
 app.addHook('onRequest',async (request,reply)=>{
  if(request.url.startsWith('/api/')) reply.header('Cache-Control','no-store')
  if(!['GET','HEAD','OPTIONS'].includes(request.method) && request.url.startsWith('/api/')) {
   if(!config) return reply.code(503).send({error:'Authentication is not configured'})
   if(request.headers.origin!==config.origin) return reply.code(403).send({error:'Origin not permitted'})
  }
  if((request.url.startsWith('/api/v1/calendar') || request.url.startsWith('/api/v1/planner') || request.url.startsWith('/api/v1/mail') || request.url.startsWith('/api/v1/prices')) && !(await authenticated(request))) return reply.code(401).send({error:'Sign in required'})
 })
 app.get('/api/v1/auth/session',async request=>({authenticated:await authenticated(request),configured:!!config}))
 app.post<{Body:{username:string;password:string}}>('/api/v1/auth/login',{
  config:{rateLimit:{max:5,timeWindow:'1 minute'}},
  schema:{body:{type:'object',required:['username','password'],additionalProperties:false,properties:{username:{type:'string',maxLength:256},password:{type:'string',maxLength:1024}}}},
 },async(request,reply)=>{
  if(!config || !expected) return reply.code(503).send({error:'Authentication is not configured'})
  const actual=await derive(request.body.password,salt,64) as Buffer
  if(!timingSafeEqual(actual,expected) || request.body.username!==config.username) return reply.code(401).send({error:'Invalid login'})
  const old=request.cookies.daymark_session
  if(old) await config.store.remove(digest(old))
  const token=randomBytes(32).toString('hex')
  await config.store.put(digest(token),identity,Date.now()+86400000)
  reply.setCookie('daymark_session',token,{path:'/',httpOnly:true,sameSite:'strict',secure:config.origin.startsWith('https:'),maxAge:86400})
  return {authenticated:true}
 })
 app.post('/api/v1/auth/logout',async(request,reply)=>{
  const token=request.cookies.daymark_session
  if(token && config) await config.store.remove(digest(token))
  reply.clearCookie('daymark_session',{path:'/'})
  return {authenticated:false}
 })
}
