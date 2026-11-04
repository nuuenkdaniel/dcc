import type {PoolClient} from 'pg'
import {createHash} from 'node:crypto'
import {plainRecord,type Command,type Result} from './contracts.js'
import {validActionData,validPreparationData} from './product-projections.js'
import {examDay,validPreparation,type Preparation} from '../study.js'

type Row={id:string;kind:string;version:number;data:Record<string,unknown>}
// Caller holds the receipt transaction. Domain data and its receipt use one
// commit, the same planner lock and version semantics as ordinary UI mutations.
export async function mutatePlannerEntity(c:PoolClient,{tool,args}:Command):Promise<Result>{
  await c.query('SELECT pg_advisory_xact_lock(817340)')
  const id=String(args.id),row=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[id])).rows[0]
  const creation=tool==='create_daily_action'||tool==='create_preparation',kind=tool.includes('preparation')?'preparation':'action'
  if(creation&&row)return {state:'conflict',code:'already_exists'}
  if(!creation&&(!row||row.kind!==kind))return {state:'rejected',code:'not_found'}
  if(row&&row.version!==args.expectedVersion)return {state:'conflict',code:'revision_mismatch'}
  let data:Record<string,unknown>
  // Stable, backend-owned topic identity is bound to the operation receipt.
  const topicId='mcp_'+createHash('sha256').update(String(args.operationKey)).digest('hex').slice(0,48)
  if(tool==='create_preparation'){
    data={id,title:args.title,startDate:args.startDate,status:'active',progress:args.progress,topics:[{id:topicId,title:args.topicTitle,notes:args.topicNotes,minutes:args.topicMinutes}]}
  }else if(creation){
    const parent=(await c.query<Row>('SELECT id,kind,version,data FROM planner_entities WHERE id=$1 FOR UPDATE',[args.projectId])).rows[0]
    if(!parent||parent.kind!=='project'||parent.data.status!=='active')return {state:'rejected',code:'parent_unavailable'}
    data={id,source:'manual-project',projectId:args.projectId,title:args.title,date:args.date,notes:args.notes,minutes:args.minutes,completed:false,dismissed:false,origin:'hermes'}
  }else{
    data={...row!.data}
    if(data.id!==id)return {state:'rejected',code:'invalid_arguments'}
    if(kind==='action'){
      if(!validActionData(data))return {state:'rejected',code:'invalid_arguments'}
      if(data.source==='manual-project'&&args.feedback!==undefined)return {state:'rejected',code:'invalid_arguments'}
      if(args.date!==undefined&&data.source!=='manual-project'&&args.date!==data.date)return {state:'rejected',code:'forbidden'}
      for(const key of ['title','notes','minutes','date','completed','dismissed','feedback'])if(Object.hasOwn(args,key))data[key]=args[key]
      if(args.title!==undefined&&args.title!==row!.data.title||args.notes!==undefined&&args.notes!==row!.data.notes)data.edited=true
    }else{
      if(!validPreparationData(data))return {state:'rejected',code:'invalid_arguments'}
      if(tool==='insert_preparation_topic'){
        const topics=data.topics as Record<string,unknown>[]
        if(topics.length>=60||topics.some(t=>t.id===topicId)||Number(args.position??topics.length)>topics.length)return {state:'rejected',code:'invalid_arguments'}
        data.topics=[...topics];(data.topics as unknown[]).splice(Number(args.position??topics.length),0,{id:topicId,title:args.title,notes:args.notes,minutes:args.minutes})
      }else if(tool==='remove_preparation_topic'){
        const topics=data.topics as Record<string,unknown>[]
        if(!topics.some(t=>t.id===args.topicId))return {state:'rejected',code:'not_found'}
        if(topics.length<=1)return {state:'rejected',code:'invalid_arguments'}
        data.topics=topics.filter(t=>t.id!==args.topicId)
      }else if(tool==='update_preparation_topic'){
        if(!Array.isArray(data.topics)||!data.topics.some(t=>plainRecord(t)&&t.id===args.topicId))return {state:'rejected',code:'not_found'}
        data.topics=data.topics.map((t:unknown)=>{
          if(!plainRecord(t)||t.id!==args.topicId)return t
          const next={...t}
          for(const key of ['title','notes','minutes'])if(Object.hasOwn(args,key))next[key]=args[key]
          return next
        })
      }else if(tool==='update_preparation')for(const key of ['title','startDate','status','progress'])if(Object.hasOwn(args,key))data[key]=args[key]
    }
  }
  if(kind==='preparation'){
      const state=(await c.query('SELECT snapshot FROM calendar_sync_state WHERE id=1')).rows[0]
      if(tool==='create_preparation'||tool==='relink_preparation'){
        const selected=state?.snapshot?.events?.find((e:{id:string;calendarId:string})=>e.id===args.eventId&&e.calendarId===args.calendarId)
        if(!selected)return {state:'conflict',code:'cache_unavailable'}
        data.event={id:selected.id,calendarId:selected.calendarId,uid:selected.uid,recurrenceId:selected.recurrenceId,start:selected.start,allDay:selected.allDay}
      }
      const event=data.event
      if(!plainRecord(event))return {state:'rejected',code:'invalid_arguments'}
      const linked=(state?.snapshot?.events as {calendarId:string;uid:string;recurrenceId:string|null;start:string;allDay:boolean}[]|undefined)?.find(e=>e.calendarId===event.calendarId&&e.uid===event.uid&&e.recurrenceId===event.recurrenceId)
      if(!linked&&data.status!=='paused')return {state:'conflict',code:'cache_unavailable'}
      if(linked&&String(data.startDate)>=examDay({...linked,id:String(event.id)}))return {state:'rejected',code:'invalid_arguments'}
      if(!validPreparation(data as unknown as Preparation))return {state:'rejected',code:'invalid_arguments'}
  }
  if(!(kind==='action'?validActionData(data):validPreparationData(data)))return {state:'rejected',code:'invalid_arguments'}
  if(row&&JSON.stringify(row.data)===JSON.stringify(data))return {state:'applied',id,version:row.version}
  const changed=creation?await c.query('INSERT INTO planner_entities(id,kind,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING version',[id,kind,data]):await c.query('UPDATE planner_entities SET data=$2,version=version+1 WHERE id=$1 AND kind=$3 AND version=$4 RETURNING version',[id,data,kind,row!.version])
  if(changed.rowCount!==1||changed.rows[0]?.version!==(row?.version??0)+1)throw Error('Planner mutation did not affect one row')
  if(kind==='preparation'){
    const queued=await c.query('UPDATE planner_runs SET requested=true,next_attempt=now() WHERE id=1')
    if(queued.rowCount!==1)throw Error('Planning request not recorded')
  }
  return {state:'applied',id,version:(row?.version??0)+1}
}
