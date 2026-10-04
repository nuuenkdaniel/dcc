import type {FastifyInstance} from 'fastify'
import type {Pool} from 'pg'
import {easternDay} from './planner-policy.js'
export function decodeMailCursor(value?:string):[string,string]|null {
 if(!value)return null
 if(value.length>1000)throw Error('Invalid cursor')
 const data:unknown=JSON.parse(Buffer.from(value,'base64url').toString())
 if(!Array.isArray(data)||data.length!==2||typeof data[0]!=='string'||!Number.isFinite(Date.parse(data[0]))||typeof data[1]!=='string'||data[1].length>100)throw Error('Invalid cursor')
 return [data[0],data[1]]
}
export function mailPageRoutes(app:FastifyInstance,pool:Pool){
 app.get<{Querystring:{cursor?:string;q?:string;account?:string;important?:string}}>('/api/v1/mail/page',async(req,reply)=>{
  let cursor:[string,string]|null;try{cursor=decodeMailCursor(req.query.cursor)}catch{return reply.code(400).send({error:'Invalid cursor'})}
  const q=req.query.q||'';const account=req.query.account||'all';if(q.length>200||!['all','personal','school','work'].includes(account))return reply.code(400).send({error:'Invalid filter'})
  const where=`($1='all' OR account=$1) AND ($2='' OR position(lower($2) in lower(coalesce(data->>'subject','')||' '||coalesce(data->>'sender','')))>0) AND (NOT $3::boolean OR coalesce(override,(analysis->>'important')::boolean,false))`
  const args=[account,q,req.query.important==='true']
  const rows=(await pool.query(`SELECT data-'body' AS data,analysis,override FROM mail_messages WHERE ${where} AND ($4::text IS NULL OR (data->>'receivedAt',id)<($4,$5)) ORDER BY data->>'receivedAt' DESC,id DESC LIMIT 101`,[...args,cursor?.[0]??null,cursor?.[1]??null])).rows
  const messages=rows.slice(0,100);const last=messages.at(-1)
  const today=easternDay(new Date())
  return {messages,nextCursor:rows.length>100&&last?Buffer.from(JSON.stringify([last.data.receivedAt,last.data.id])).toString('base64url'):null,total:Number((await pool.query(`SELECT count(*) count FROM mail_messages WHERE ${where}`,args)).rows[0].count),accounts:(await pool.query('SELECT account,last_success,error FROM mail_state ORDER BY account')).rows,today,briefing:(await pool.query(`SELECT data-'body' AS data,analysis,override FROM mail_messages WHERE (data->>'receivedAt')::timestamptz AT TIME ZONE 'America/New_York' >= $1::date AND (data->>'receivedAt')::timestamptz AT TIME ZONE 'America/New_York' < $1::date+interval '1 day' AND coalesce(override,(analysis->>'important')::boolean,false) ORDER BY data->>'receivedAt' DESC,id DESC`,[today])).rows}
 })
 app.get<{Params:{id:string}}>('/api/v1/mail/message/:id',async(req,reply)=>{const row=(await pool.query('SELECT data FROM mail_messages WHERE id=$1',[req.params.id])).rows[0];return row?{id:row.data.id,body:row.data.body||''}:reply.code(404).send({error:'Message not found'})})
}
