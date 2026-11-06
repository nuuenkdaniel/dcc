import {validateArguments,validEntity,type Arguments,type Command,type Result} from './contracts.js'
import type {Transport} from './dispatcher.js'

// In-memory synthetic fixtures only. No runtime imports, env, filesystem, URLs or network.
export class FakeTransport implements Transport {
  readonly calls:Command[]=[]
  private readonly tasks=new Map<string,Arguments>()
  private readonly projects=new Map<string,Arguments>()
  private readonly events=new Map<string,Arguments>()
  private readonly calendars:Arguments[]=[{id:'Calendar_A',name:'Synthetic calendar',writable:true}]
  constructor(seed:{events?:readonly Arguments[]}={}){
    for(const event of seed.events??[]){
      if(!validEntity('event',event)||event.calendarId!=='Calendar_A'||!/^"fake-[1-9]\d*"$/.test(String(event.etag))||!Number.isSafeInteger(Number(String(event.etag).slice(6,-1))))throw Error('Invalid synthetic event')
      const key=this.eventKey(String(event.calendarId),String(event.id))
      if(this.events.has(key))throw Error('Duplicate synthetic event')
      this.events.set(key,structuredClone(event))
    }
  }
  private eventKey(calendarId:string,eventId:string){return JSON.stringify([calendarId,eventId])}
  async execute(command:Command):Promise<Result> {
    if(['get_focus_timer','control_focus_timer','edit_focus_queue'].includes(command.tool))return {state:'rejected',code:'transport_unconfigured'}
    if(command.tool.includes('preparation')||['list_daily_actions','create_daily_action','update_daily_action','search_inbox','get_inbox_message','list_prices','get_calendar_series'].includes(command.tool))return {state:'rejected',code:'transport_unconfigured'}
    const validated=validateArguments(command.tool,command.args)
    if(!validated.valid)return {state:'rejected',code:validated.code}
    const {tool}=command,args=validated.args
    this.calls.push(structuredClone({tool,args}))
    if(tool==='get_operation_status')return {state:'ok',data:{operationKey:args.operationKey,status:'unknown'}}
    if(tool.startsWith('list_')){
      let items:Arguments[]
      if(tool==='list_calendars')items=this.calendars
      else if(tool==='list_tasks')items=[...this.tasks.values()].filter(t=>String(t.date)>=String(args.from)&&String(t.date)<String(args.to))
      else if(tool==='list_projects')items=[...this.projects.values()]
      else items=[...this.events.values()].filter(e=>e.calendarId===args.calendarId&&Date.parse(String(e.start))<Date.parse(String(args.to))&&Date.parse(String(e.end))>Date.parse(String(args.from)))
      items=[...items].sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0)
      const offset=Number(args.offset??0),end=offset+Number(args.limit)
      return {state:'ok',data:{items:structuredClone(items.slice(offset,end)),nextOffset:end<items.length&&end<=10000?end:null}}
    }
    if(tool.includes('calendar_event'))return this.calendarMutation(tool,args)
    const isTask=tool.includes('task'),store=isTask?this.tasks:this.projects,id=args.id as string
    const old=store.get(id)
    if(tool==='create_task'||tool==='create_project'||tool==='create_assignment'){
      if(old)return {state:'conflict',code:'already_exists'}
      if(isTask&&args.projectId!==undefined){
        const parent=this.projects.get(String(args.projectId))
        if(!parent||parent.archived)return {state:'rejected',code:'parent_unavailable'}
      }
      const entity:Arguments=isTask?{
        id,title:args.title!,date:args.date!,notes:args.notes??'',important:args.important??false,completed:false,deleted:false,version:1,
        ...(args.projectId===undefined?{}:{projectId:args.projectId}),
      }:{id,title:args.title!,description:args.description??'',kind:tool==='create_assignment'?'assignment':'project',status:'active',archived:false,version:1,...(args.deadline===undefined?{}:{deadline:args.deadline})}
      store.set(id,entity)
      return {state:'applied',id,version:1}
    }
    if(!old)return {state:'rejected',code:'not_found'}
    if(old.version!==args.expectedVersion)return {state:'conflict',code:'revision_mismatch'}
    if(isTask&&old.deleted)return {state:'conflict',code:'deleted'}
    if(!isTask&&old.archived&&tool!=='restore_project')return {state:'conflict',code:'archived'}
    const version=Number(old.version)+1,next:Arguments={...old,version}
    if(!Number.isSafeInteger(version))return {state:'conflict',code:'revision_mismatch'}
    if(tool==='update_task'||tool==='update_project'){
      for(const field of isTask?['title','date','notes','important']:['title','description','deadline'])if(Object.hasOwn(args,field))next[field]=args[field]!
    }else if(tool==='set_task_completed')next.completed=args.completed!
    else if(tool==='remove_task')next.deleted=true // A tombstone, never physical deletion.
    else if(tool==='set_project_status')next.status=args.status!
    else if(tool==='archive_project')next.archived=true
    else if(tool==='restore_project')next.archived=false
    store.set(id,next)
    return {state:'applied',id,version}
  }
  private calendarMutation(tool:Command['tool'],args:Arguments):Result {
    const calendar=this.calendars.find(c=>c.id===args.calendarId)
    if(!calendar)return {state:'rejected',code:'not_found'}
    if(!calendar.writable)return {state:'rejected',code:'calendar_read_only'}
    const id=(args.eventId??args.id) as string,key=this.eventKey(String(args.calendarId),id),old=this.events.get(key)
    if(tool==='create_calendar_event'){
      if(old)return {state:'conflict',code:'already_exists'}
    }else{
      if(!old)return {state:'rejected',code:'not_found'}
      // The source record, not just the caller's scope assertion, must be checked.
      if(old.recurring)return {state:'rejected',code:'unsupported_recurrence'}
      if(old.etag!==args.expectedEtag)return {state:'conflict',code:'revision_mismatch'}
      if(old.cancelled)return {state:'conflict',code:'deleted'}
    }
    const revision=old?Number(String(old.etag).slice(6,-1))+1:1,etag=`"fake-${revision}"`
    if(!Number.isSafeInteger(revision))return {state:'conflict',code:'revision_mismatch'}
    const next:Arguments=old?{...old}:{id,calendarId:args.calendarId!,description:'',location:'',cancelled:false,recurring:false}
    if(tool==='cancel_calendar_event')next.cancelled=true
    else for(const field of ['title','start','end','allDay','description','location'])if(Object.hasOwn(args,field))next[field]=args[field]!
    next.etag=etag
    this.events.set(key,next)
    return {state:'applied',id,etag}
  }
}
