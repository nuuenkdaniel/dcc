import type {Pool} from 'pg'
import type {Command,Result} from './contracts.js'
import {plainRecord} from './contracts.js'
import {validActionData,validPreparationData} from './product-projections.js'
import {boundedPage} from './wire-budget.js'

export async function readProductCache(pool:Pool,{tool,args}:Command):Promise<Result|undefined>{
  const limit=Number(args.limit),offset=Number(args.offset??0)
  const paged=(items:unknown[]):Result=>boundedPage(items,limit,offset)
  if(tool==='list_daily_actions'||tool==='list_preparations'){
    const kind=tool==='list_daily_actions'?'action':'preparation'
    const rows=(await pool.query('SELECT id,kind,version,data FROM planner_entities WHERE kind=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::text IS NULL OR (data->>\'date\'>=$3 AND data->>\'date\'<$4)) ORDER BY id LIMIT $5 OFFSET $6',[kind,args.id??null,tool==='list_daily_actions'?args.from:null,args.to??null,limit+1,offset])).rows
    return paged(rows.map(row=>{
      const d=row.data
      if(tool==='list_daily_actions'){
        if(!validActionData(d)||d.id!==row.id)throw Error('Invalid action data')
        return {id:row.id,title:d.title,date:d.date,notes:d.notes,minutes:d.minutes,completed:d.completed,dismissed:d.dismissed,feedback:d.feedback??'',projectId:d.projectId,source:d.source??'generated',version:row.version}
      }
      if(!validPreparationData(d)||d.id!==row.id||!plainRecord(d.event))throw Error('Invalid preparation')
      const e=d.event
      if(!Array.isArray(d.topics))throw Error('Invalid preparation topics')
      return {id:row.id,title:d.title,event:{id:e.id,calendarId:e.calendarId,uid:e.uid,recurrenceId:e.recurrenceId,start:e.start,allDay:e.allDay},startDate:d.startDate,status:d.status,topics:d.topics.filter((t:unknown)=>args.topicId===undefined||plainRecord(t)&&t.id===args.topicId).map((t:unknown)=>{
        if(!plainRecord(t)||typeof t.notes!=='string')throw Error('Invalid topic')
        const start=Number(args.notesOffset??0),notes=t.notes.slice(start,start+512)
        return {id:t.id,title:t.title,notes,minutes:t.minutes,notesOffset:start,nextNotesOffset:start+notes.length<t.notes.length?start+notes.length:null}
      }),progress:d.progress,version:row.version}
    }))
  }
  if(tool==='search_inbox'){
    const rows=(await pool.query("SELECT id,data->>'sender' AS sender,data->>'subject' AS subject,data->>'receivedAt' AS received_at,account,coalesce(override,(analysis->>'important')::boolean,false) AS important,coalesce(analysis->>'summary','') AS summary FROM mail_messages WHERE ($1='all' OR account=$1) AND position(lower($2) in lower(coalesce(data->>'subject','')||' '||coalesce(data->>'sender','')))>0 AND (NOT $3::boolean OR coalesce(override,(analysis->>'important')::boolean,false)) ORDER BY data->>'receivedAt' DESC,id DESC LIMIT $4 OFFSET $5",[args.account,args.query,args.importantOnly,limit+1,offset])).rows
    return paged(rows.map(r=>({id:r.id,sender:String(r.sender??'').slice(0,500),subject:String(r.subject??'').slice(0,1000),receivedAt:r.received_at,account:r.account,important:r.important===true,summary:String(r.summary).slice(0,500)})))
  }
  if(tool==='get_inbox_message'){
    const row=(await pool.query("SELECT id,substring(coalesce(data->>'body','') from $2 for $3) AS body,length(coalesce(data->>'body','')) AS body_length FROM mail_messages WHERE id=$1",[args.id,offset+1,limit])).rows[0]
    if(!row)return {state:'rejected',code:'not_found'}
    // JavaScript offsets are UTF-16; slicing SQL character offsets would disagree
    // on astral text. Restrict this body API to a stable Unicode codepoint cursor.
    const body=String(row.body),consumed=Array.from(body).length
    return {state:'ok',data:{id:row.id,body,nextOffset:offset+consumed<Number(row.body_length)?offset+consumed:null}}
  }
  if(tool==='list_prices'){
    const rows=(await pool.query('SELECT id,title,target_cents,paused FROM price_items ORDER BY id LIMIT $1 OFFSET $2',[limit+1,offset])).rows
    const ids=rows.slice(0,limit).map(r=>r.id)
    const sources=ids.length?(await pool.query('SELECT item_id,store,status,last_good FROM price_sources WHERE item_id=ANY($1::text[]) ORDER BY item_id,store',[ids])).rows:[]
    return paged(rows.map(r=>({id:r.id,title:r.title,targetCents:r.target_cents,paused:r.paused,sources:sources.filter(s=>s.item_id===r.id).map(s=>({store:s.store,status:s.status,observedAt:s.last_good?.observedAt??null,offers:(Array.isArray(s.last_good?.offers)?s.last_good.offers:[]).slice(0,20).map((o:Record<string,unknown>)=>({condition:o.condition,cents:o.cents,currency:o.currency,eligible:o.eligible,availability:o.availability}))}))})))
  }
  return undefined
}
