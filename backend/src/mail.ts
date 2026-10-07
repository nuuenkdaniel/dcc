import type {Pool} from 'pg'
import type {FastifyInstance} from 'fastify'
import {callCurator} from './planner.js'
import {easternDay} from './planner-policy.js'
import {mailPageRoutes} from './mail-paging.js'
import {createHash} from 'node:crypto'
import {classificationRetryKey,parseClassificationRetry,withoutClassificationRetry,type ClassificationRetry} from './mail-retry.js'
type CuratorCall=(input:unknown)=>Promise<unknown>
type ClassificationCandidate={id:string;data:Record<string,unknown>;retry:unknown;received_at:string}
const htmlLimit=2*1024*1024
export type ClassifyMailOptions={curator?:CuratorCall;now?:()=>Date;random?:()=>number}
export async function cachedMailHtml(pool:Pool,id:string,curator:CuratorCall=callCurator){
 if(!/^[a-f0-9]{64}$/.test(id))return {code:404 as const,error:'Message not found'}
 const row=(await pool.query('SELECT account,data FROM mail_messages WHERE id=$1',[id])).rows[0]
 if(!row)return {code:404 as const,error:'Message not found'}
 const data=row.data as Record<string,unknown>
 const identity=createHash('sha256').update(`${data.account}\0${data.validity}\0${data.uid}`).digest('hex')
 if(data.id!==id||row.account!==data.account||identity!==id||!['personal','school','work'].includes(String(data.account))||!/^\d+$/.test(String(data.uid))||!/^\d+$/.test(String(data.validity)))return {code:409 as const,error:'Cached message identity is invalid; sync again'}
 if(Object.hasOwn(data,'html'))return typeof data.html==='string'?{code:200 as const,html:data.html,hasHtml:true}:{code:200 as const,html:null,hasHtml:false}
 if(data.hasHtml===false)return {code:200 as const,html:null,hasHtml:false}
 const result=await curator({mode:'mail-html',account:data.account,uid:data.uid,validity:data.validity}) as {html?:unknown}
 if(!(typeof result?.html==='string'||result?.html===null))throw Error('Invalid HTML result')
 if(typeof result.html==='string'&&Buffer.byteLength(result.html,'utf8')>htmlLimit)throw Error('HTML exceeds 2 MB limit')
 const saved=await pool.query("UPDATE mail_messages SET data=jsonb_set(data || jsonb_build_object('hasHtml',$5::boolean),'{html}',$6::jsonb,true) WHERE id=$1 AND account=$2 AND data->>'uid'=$3 AND data->>'validity'=$4",[id,data.account,data.uid,data.validity,typeof result.html==='string',JSON.stringify(result.html)])
 if(saved.rowCount!==1)throw Error('Cached message identity changed')
 return {code:200 as const,html:result.html,hasHtml:typeof result.html==='string'}
}
export async function migrateMail(pool:Pool){await pool.query(`CREATE TABLE IF NOT EXISTS mail_messages(id text PRIMARY KEY,account text NOT NULL,data jsonb NOT NULL,analysis jsonb,override boolean,feedback_at timestamptz);CREATE TABLE IF NOT EXISTS mail_state(account text PRIMARY KEY,last_success timestamptz,error text,next_run timestamptz NOT NULL DEFAULT now());INSERT INTO mail_state(account) VALUES('personal'),('school'),('work') ON CONFLICT DO NOTHING;CREATE TABLE IF NOT EXISTS mail_preferences(id int PRIMARY KEY CHECK(id=1),rules text NOT NULL DEFAULT '');INSERT INTO mail_preferences(id) VALUES(1) ON CONFLICT DO NOTHING;`)}
export async function syncMail(pool:Pool,curator:CuratorCall=callCurator){const c=await pool.connect();let locked=false
 try{locked=(await c.query('SELECT pg_try_advisory_lock(817350) ok')).rows[0].ok;if(!locked)return
 for(const account of ['personal','school','work']){
 if(!(await c.query('SELECT next_run<=now() due FROM mail_state WHERE account=$1',[account])).rows[0].due)continue
 try{
 let offset:number|null=0;let expected:number|undefined;const seen=new Set<string>()
 const known=(await c.query("SELECT id FROM mail_messages WHERE account=$1 AND data->>'mimeVersion'='2' AND (data->>'receivedAt')::timestamptz >= now()-interval '32 days'",[account])).rows.map(r=>r.id)
 do{const result=await curator({mode:'mail-sync',account,offset,known}) as {messages:Record<string,unknown>[];next:number|null;total:number}
 if(!Array.isArray(result.messages)||!Number.isInteger(result.total)||result.total<0)throw Error('Invalid mailbox result')
 if(expected!==undefined&&expected!==result.total)throw Error('Mailbox changed during pagination; retry')
 expected=result.total
 for(const m of result.messages){if(typeof m.id!=='string'||!/^[a-f0-9]{64}$/.test(m.id)||m.account!==account)throw Error('Invalid message');seen.add(m.id);if(typeof m.body==='string')await c.query(`INSERT INTO mail_messages(id,account,data) VALUES($1,$2,$3::jsonb-'${classificationRetryKey}') ON CONFLICT(id) DO UPDATE SET data=mail_messages.data || (excluded.data-'${classificationRetryKey}')`,[m.id,account,JSON.stringify(m)]);else await c.query(`UPDATE mail_messages SET data=data || ($2::jsonb-'${classificationRetryKey}') WHERE id=$1`,[m.id,JSON.stringify(m)])}
 if(result.next!==null&&(!Number.isInteger(result.next)||result.next<=offset))throw Error('Invalid pagination');offset=result.next
 }while(offset!==null)
 if(seen.size!==expected)throw Error('Incomplete mailbox sync')
 await c.query("UPDATE mail_state SET last_success=now(),error=NULL,next_run=now()+interval '15 minutes' WHERE account=$1",[account])
 }catch{await c.query("UPDATE mail_state SET error='Sync failed; cached messages retained. Retrying in five minutes.',next_run=now()+interval '5 minutes' WHERE account=$1",[account])}
 }
 }finally{if(locked)await c.query('SELECT pg_advisory_unlock(817350)');c.release()}}
export async function classifyMail(pool:Pool,options:ClassifyMailOptions={}){
 const curator=options.curator??callCurator,now=options.now??(()=>new Date()),random=options.random??Math.random
 const c=await pool.connect();let locked=false
 try{locked=(await c.query('SELECT pg_try_advisory_lock(817351) ok')).rows[0].ok;if(!locked)return
 const current=now();if(!Number.isFinite(current.getTime()))throw Error('Invalid classifier clock')
 const today=easternDay(current);let cursor:[string,string]|null=null,row:ClassificationCandidate|undefined
 do {
  const candidates=(await c.query(`SELECT id,data-'html'-'${classificationRetryKey}' AS data,data->'${classificationRetryKey}' AS retry,data->>'receivedAt' AS received_at FROM mail_messages WHERE analysis IS NULL AND ((data->>'receivedAt')::timestamptz AT TIME ZONE 'America/New_York' >= $1::date OR data?'${classificationRetryKey}') AND ($2::text IS NULL OR (data->>'receivedAt',id)<($2,$3)) ORDER BY data->>'receivedAt' DESC,id DESC LIMIT 100`,[today,cursor?.[0]??null,cursor?.[1]??null])).rows as ClassificationCandidate[]
  row=candidates.find(candidate=>{const retry=parseClassificationRetry(candidate.retry);return !retry||Date.parse(retry.nextAttemptAt)<=current.getTime()})
  if(row||candidates.length<100)break
  const last=candidates.at(-1)!;cursor=[last.received_at,last.id]
 } while(true)
 if(!row)return
 const rules=(await c.query('SELECT rules FROM mail_preferences WHERE id=1')).rows[0].rules
 const examples=(await c.query('SELECT data->>\'sender\' sender,data->>\'subject\' subject,override important FROM mail_messages WHERE override IS NOT NULL ORDER BY feedback_at DESC LIMIT 20')).rows
 try {
  const result=await curator({mode:'mail-classify',rules,feedback:examples,messages:[{id:row.id,account:row.data.account,sender:row.data.sender,subject:row.data.subject,body:(row.data.body as string).slice(0,10000)}]}) as {messages:{id:string;important:boolean;summary:string;reason:string}[]}
  const message=result.messages?.[0]
  if(!Array.isArray(result.messages)||result.messages.length!==1||!message||message.id!==row.id||typeof message.important!=='boolean'||typeof message.summary!=='string'||message.summary.length>500||typeof message.reason!=='string'||message.reason.length>500)throw Error('Invalid classification')
  await c.query(`UPDATE mail_messages SET analysis=$2,data=data-'${classificationRetryKey}' WHERE id=$1`,[message.id,message])
  return 'classified' as const
 } catch(error) {
  const previous=parseClassificationRetry(row.retry),attempts=(previous?.attempts??0)+1
  const maximum=6*60*60*1000,base=Math.min(maximum,30_000*2**Math.min(attempts-1,10))
  const sample=random();if(!Number.isFinite(sample)||sample<0||sample>1)throw Error('Invalid classifier random source',{cause:error})
  const delay=Math.min(maximum,base+Math.floor(base*.2*sample))
  const retry:ClassificationRetry={version:1,attempts,nextAttemptAt:new Date(current.getTime()+delay).toISOString()}
  await c.query(`UPDATE mail_messages SET data=jsonb_set(data,'{${classificationRetryKey}}',$2::jsonb,true) WHERE id=$1 AND analysis IS NULL`,[row.id,JSON.stringify(retry)])
  return 'deferred' as const
 }
 }finally{if(locked)await c.query('SELECT pg_advisory_unlock(817351)');c.release()}}
export function mailRoutes(app:FastifyInstance,pool:Pool,curator:CuratorCall=callCurator){
 mailPageRoutes(app,pool)
 app.get('/api/v1/mail/snapshot',async()=>({messages:(await pool.query(`SELECT data-'html'-'${classificationRetryKey}' AS data,analysis,override FROM mail_messages ORDER BY data->>'receivedAt' DESC`)).rows.map(row=>({...row,data:withoutClassificationRetry(row.data)})),accounts:(await pool.query('SELECT account,last_success,error FROM mail_state ORDER BY account')).rows,today:easternDay(new Date())}))
 app.post('/api/v1/mail/refresh',async()=>{await pool.query("UPDATE mail_state SET next_run=now() WHERE last_success IS NULL OR last_success<now()-interval '30 seconds'");return {queued:true}})
 app.get('/api/v1/mail/preferences',async()=>(await pool.query('SELECT rules FROM mail_preferences WHERE id=1')).rows[0])
 app.post<{Body:{rules:string}}>('/api/v1/mail/preferences',async(req,reply)=>{if(typeof req.body?.rules!=='string'||req.body.rules.length>4000)return reply.code(400).send({error:'Rules must be at most 4,000 characters'});await pool.query('UPDATE mail_preferences SET rules=$1 WHERE id=1',[req.body.rules]);await pool.query(`UPDATE mail_messages SET analysis=NULL,data=data-'${classificationRetryKey}' WHERE override IS NULL AND (data->>'receivedAt')::timestamptz AT TIME ZONE 'America/New_York' >= $1::date`,[easternDay(new Date())]);return {saved:true}})
 app.post<{Body:{id:string;important:boolean|null}}>('/api/v1/mail/feedback',async(req,reply)=>{if(typeof req.body?.id!=='string'||!(req.body.important===null||typeof req.body.important==='boolean'))return reply.code(400).send({error:'Invalid feedback'});const r=await pool.query('UPDATE mail_messages SET override=$2,feedback_at=now() WHERE id=$1',[req.body.id,req.body.important]);return r.rowCount?{saved:true}:reply.code(404).send({error:'Message not found'})})
 app.get<{Params:{id:string}}>('/api/v1/mail/html/:id',async(req,reply)=>{try{const result=await cachedMailHtml(pool,req.params.id,curator);return reply.code(result.code).send(result.code===200?{html:result.html,hasHtml:result.hasHtml}:{error:result.error})}catch{return reply.code(502).send({error:'Formatted message unavailable. The cached text is unchanged.'})}})
 app.get<{Params:{id:string;part:string}}>('/api/v1/mail/attachment/:id/:part',async(req,reply)=>{
 const row=(await pool.query('SELECT data FROM mail_messages WHERE id=$1',[req.params.id])).rows[0];if(!row||!row.data.attachments.some((a:{part:string})=>a.part===req.params.part))return reply.code(404).send({error:'Attachment not in cached message'})
 try{const file=await callCurator({mode:'mail-attachment',account:row.data.account,uid:row.data.uid,validity:row.data.validity,part:req.params.part}) as {name:string;content:string};const bytes=Buffer.from(file.content,'base64');if(bytes.length>25*1024*1024)throw Error('Too large');return reply.header('Content-Type','application/octet-stream').header('X-Content-Type-Options','nosniff').header('Content-Disposition',`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name.replace(/[\r\n]/g,''))}`).send(bytes)}catch{return reply.code(502).send({error:'Download failed. The message may have moved, or exceeds the 25 MB download limit.'})}
 })
}
