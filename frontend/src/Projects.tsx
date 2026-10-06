import {useState} from 'react'
import type {Planner,Project,Action} from './usePlanner'
import {formatPlanningMinutes,formatProjectDate} from './projectFormatting'
function projectActionGroups(actions:Action[]){
 const groups=new Map<string,Action[]>()
 for(const action of actions){
  const key=action.needsRescheduling||!action.date?'':action.date
  groups.set(key,[...(groups.get(key)??[]),action])
 }
 return [...groups.entries()].sort(([a],[b])=>!a?1:!b?-1:a.localeCompare(b))
}

export function PlannerStatus({planner:p,showScheduling=true}:{planner:Planner;showScheduling?:boolean}){return <div className="planner-status">{showScheduling&&<SchedulingWarnings planner={p}/>}<p role="status">{p.message}{p.pending>0?` · ${p.pending} saved draft(s)`:''}</p><button type="button" disabled={p.syncing} aria-busy={p.syncing} onClick={()=>void p.sync()}>{p.syncing?'Syncing…':'Sync now'}</button>{p.lastSynced&&!p.syncing&&<small className="local-note"> Last synced {p.lastSynced}</small>}{p.conflict&&<section className="planner-conflict" role="alert"><h3>Review conflicting edits</h3><p>Latest saved version</p><pre>{JSON.stringify(p.latest,null,2)}</pre><p>Your retained draft</p><pre>{JSON.stringify(p.conflict.data,null,2)}</pre><button onClick={()=>p.resolve(true)}>Keep my draft instead</button><button onClick={()=>p.resolve(false)}>Discard my draft</button></section>}</div>}
function SchedulingWarnings({planner:p}:{planner:Planner}){return <>{p.actions.some(a=>a.needsRescheduling&&!a.completed&&!a.dismissed)&&<details className="planner-conflict"><summary>Needs rescheduling · {p.actions.filter(a=>a.needsRescheduling&&!a.completed&&!a.dismissed).reduce((n,a)=>n+a.minutes,0)} min could not fit</summary><p>These steps remain saved, but have no feasible date before their deadline. Reduce scope, adjust the deadline or free calendar time; the morning rollover retries them.</p>{p.actions.filter(a=>a.needsRescheduling&&!a.completed&&!a.dismissed).map(a=><p key={a.id}>{a.title} · {a.minutes} min</p>)}</details>}</>}
export function Projects({planner:p}:{planner:Planner}){
 const [draft,setDraft]=useState<Project|null>(null)
 const [baseVersion,setBaseVersion]=useState(0)
 const [uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState('')
 const newProject=()=>{setBaseVersion(0);setDraft({id:crypto.randomUUID(),title:'',category:'school',description:'',deadline:'',importance:2,remainingMinutes:60,progress:'',status:'active'})}
 const field=(patch:Partial<Project>)=>setDraft(draft?{...draft,...patch}:null)
 const upload=async(file:File)=>{
  setUploading(true);setUploadError('')
  try{
   if(file.size>5*1024*1024)throw Error('Maximum file size is 5 MB')
   let binary='';for(const byte of new Uint8Array(await file.arrayBuffer()))binary+=String.fromCharCode(byte)
   const response=await fetch('/api/v1/planner/material',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,content:btoa(binary)})})
   if(!response.ok)throw Error('Could not read this file')
   const resource=await response.json() as {name:string;text:string}
   field({resources:[...(draft?.resources??[]),resource]})
  }catch(error){setUploadError(error instanceof Error?error.message:'Could not read this file')}finally{setUploading(false)}
 }
 return <section className="content projects-view">
  <header className="topbar"><div><p className="eyebrow">The bigger picture</p><h1>Projects</h1></div><button className="secondary-action" onClick={newProject} disabled={p.disabled}>New project</button></header>
  <PlannerStatus planner={p}/>
  {draft&&<form className="card project-editor" onSubmit={event=>{event.preventDefault();if(p.save('project',draft,baseVersion))setDraft(null)}}>
   <h2>{p.projects.some(project=>project.id===draft.id)?'Edit project':'New project'}</h2>
   <label>Project title<input required maxLength={240} value={draft.title} onChange={event=>field({title:event.target.value})}/></label>
   <label>Due date (optional)<input type="date" value={draft.deadline} onChange={event=>field({deadline:event.target.value})}/></label>
   <details><summary>More options</summary><div className="project-fields">
    <label>Category<select value={draft.category} onChange={event=>field({category:event.target.value})}>{['school','work','personal','club'].map(category=><option key={category}>{category}</option>)}</select></label>
    <label>Importance<select value={draft.importance} onChange={event=>field({importance:Number(event.target.value)})}><option value={1}>Normal</option><option value={2}>Important</option><option value={3}>High</option></select></label>
    <label>Planning allowance (minutes, editable)<input type="number" required min={0} max={100000} value={draft.remainingMinutes} onChange={event=>field({remainingMinutes:Number(event.target.value)})}/></label>
    <label>Progress<textarea maxLength={4000} value={draft.progress} onChange={event=>field({progress:event.target.value})}/></label>
    <label>Project status<select value={draft.status} onChange={event=>field({status:event.target.value})}><option value="active">Active</option><option value="complete">Complete</option><option value="archived">Archived</option></select></label>
   </div></details>
   <label>Instructions<textarea maxLength={12000} value={draft.description} onChange={event=>field({description:event.target.value})}/></label>
   <label>Attach instructions<input type="file" accept=".pdf,.txt,.md" disabled={uploading} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file)}}/></label>
   {draft.resources?.map((resource,index)=><small key={`${resource.name}-${index}`}>{resource.name}</small>)}
   {uploadError&&<p role="alert">{uploadError}</p>}
   <div className="project-buttons"><button type="submit">Save project</button><button type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
  </form>}
  <div className="project-list">
   {p.projects.map(project=>{
    const actions=p.actions.filter(action=>action.projectId===project.id&&!action.dismissed)
    const complete=actions.filter(action=>action.completed).length
    return <article className="card project-card" key={project.id}>
     <header className="project-card-header">
      <div className="project-heading"><div className="project-badges"><span>{project.category}</span><span>{project.status}</span></div><h2>{project.title}</h2><p className="project-deadline">{project.deadline?<>Due <time dateTime={project.deadline}>{formatProjectDate(project.deadline)}</time></>:'No deadline'}</p></div>
      <button className="project-edit" aria-label={`Edit ${project.title}`} onClick={()=>{setBaseVersion(p.versionOf(project.id));setDraft({...project})}}>Edit</button>
     </header>
     <div className="project-progress" aria-label={`${complete} of ${actions.length} generated tasks complete`}>
      <span><strong>{complete}/{actions.length}</strong> generated tasks</span><span><strong>{formatPlanningMinutes(project.remainingMinutes)}</strong> planning allowance</span>
     </div>
     <details className="generated-tasks"><summary>Generated tasks ({actions.length})</summary>
      <div className="generated-task-list">
       {!actions.length&&<p className="project-empty">No tasks have been created for this project yet.</p>}
       {projectActionGroups(actions).map(([date,group])=><section className="task-date-group" key={date||'needs-rescheduling'} aria-labelledby={`${project.id}-${date||'undated'}`}>
        <h3 id={`${project.id}-${date||'undated'}`}>{date?formatProjectDate(date):'Needs rescheduling'}</h3>
        {group.map(action=><div className="generated-task-row" key={action.id}>
         <div><strong>{action.title}</strong>{action.notes&&<details className="task-notes"><summary>Task details</summary><p>{action.notes}</p></details>}</div>
         <small>{formatPlanningMinutes(action.minutes)} · {action.completed?'Complete':'Open'}</small>
        </div>)}
       </section>)}
      </div>
     </details>
     {(project.description||project.resources?.length||project.planSummary||project.planError)&&<details className="project-info"><summary>Project details</summary>
      {project.description&&<section><h3>Description</h3><p>{project.description}</p></section>}
      {!!project.resources?.length&&<section><h3>Resources</h3><ul>{project.resources.map((resource,index)=><li key={`${resource.name}-${index}`}>{resource.name}</li>)}</ul></section>}
      {project.planSummary&&<section><h3>Planner summary</h3><p>{project.planSummary}</p></section>}
      {project.planError&&<p role="alert">{project.planError}</p>}
     </details>}
     <footer className="project-card-footer"><button type="button" disabled={p.disabled||p.status.requested} onClick={()=>void p.refresh()}>Request planning</button></footer>
    </article>
   })}
  </div>
 </section>
}

export function ActionCard({action,planner:p}:{action:Action;planner:Planner}){
 const [draft,setDraft]=useState<Action|null>(null)
 const [baseVersion,setBaseVersion]=useState(0)
 return <article className={`task-card ${action.completed?'completed':''}`}><div className="task-summary"><input type="checkbox" aria-label={`Complete ${action.title}`} checked={action.completed} onChange={()=>p.save('action',{...action,completed:!action.completed})}/><button className="task-title" onClick={()=>{setBaseVersion(p.versionOf(action.id));setDraft(draft?null:action)}}>{action.title}</button><small>{action.minutes} min</small></div><p className="curated-source">Hermes · {p.preparations.find(x=>x.id===action.preparationId)?.title??p.projects.find(x=>x.id===action.projectId)?.title??'Project'}</p>{action.preparationId&&action.completed&&<label className="study-feedback">How did it go? <select aria-label={`Study feedback for ${action.title}`} value={action.feedback??''} onChange={e=>p.save('action',{...action,feedback:e.target.value})}><option value="">Optional feedback</option><option value="comfortable">Comfortable</option><option value="review">Needs review</option></select></label>}{draft&&<form className="project-editor action-editor" onSubmit={e=>{e.preventDefault();if(p.save('action',{...draft,completed:action.completed,dismissed:action.dismissed},baseVersion))setDraft(null)}}><label>Action title<input required maxLength={240} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>Action notes<textarea maxLength={4000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><div className="project-buttons"><button type="submit">Save action</button><button type="button" onClick={()=>p.save('action',{...action,dismissed:true})}>Dismiss action</button></div></form>}</article>
}
export function StudyCard({actions,planner:p}:{actions:Action[];planner:Planner}){
 const [open,setOpen]=useState(false)
 const [editing,setEditing]=useState<{action:Action;version:number}|null>(null)
 const assignment=!!actions[0]?.assignmentStep
 const title=assignment?(p.projects.find(x=>x.id===actions[0]?.projectId)?.title??'Assignment'):(p.preparations.find(x=>x.id===actions[0]?.preparationId)?.title??'Exam')
 const complete=actions.every(a=>a.completed)
 return <article className={`task-card ${complete?'completed':''}`}><div className="task-summary"><input type="checkbox" aria-label={`Complete study for ${title}`} checked={complete} onChange={()=>{for(const a of actions)p.save('action',{...a,completed:!complete})}}/><button className="task-title" aria-expanded={open} onClick={()=>setOpen(!open)}>{assignment?'Work on':'Study for'} {title}</button><small>{actions.reduce((n,a)=>n+a.minutes,0)} min</small></div>{open&&<div className="study-subtasks"><div className="study-task-options"><button type="button" className="study-priority" aria-label={`Mark study for ${title} important`} aria-pressed={actions.some(a=>a.important)} onClick={()=>{const important=!actions.some(a=>a.important);for(const a of actions)p.save('action',{...a,important})}}><span aria-hidden="true">{actions.some(a=>a.important)?'★':'☆'}</span> {actions.some(a=>a.important)?'Important':'Mark important'}</button></div>{actions.map(a=><div key={a.id} className="study-subtask"><label><input type="checkbox" checked={a.completed} onChange={()=>p.save('action',{...a,completed:!a.completed})}/><span>{a.title}</span><small>{a.minutes} min</small></label><p>{a.notes}</p><button type="button" className="subtask-edit" onClick={()=>setEditing({action:{...a},version:p.versionOf(a.id)})}>Edit step</button>{editing?.action.id===a.id&&<form className="project-editor" onSubmit={e=>{e.preventDefault();if(p.save('action',{...editing.action,completed:a.completed,feedback:a.feedback,dismissed:a.dismissed},editing.version))setEditing(null)}}><label>Step title<input required maxLength={240} value={editing.action.title} onChange={e=>setEditing({...editing,action:{...editing.action,title:e.target.value}})}/></label><label>Step notes<textarea maxLength={4000} value={editing.action.notes} onChange={e=>setEditing({...editing,action:{...editing.action,notes:e.target.value}})}/></label><button type="submit">Save step</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button></form>}{a.completed&&!assignment&&<select aria-label={`Study feedback for ${a.title}`} value={a.feedback??''} onChange={e=>p.save('action',{...a,feedback:e.target.value})}><option value="">Optional feedback</option><option value="comfortable">Comfortable</option><option value="review">Needs review</option></select>}</div>)}</div>}</article>
}
export function PlanControls({planner:p}:{planner:Planner}){
 const [requesting,setRequesting]=useState(false)
 const timestamp=p.status.last_success
 const validTime=timestamp&&Number.isFinite(Date.parse(timestamp))
 return <details className="planner-details"><summary>Planning & sync{p.status.error?' · needs attention':p.status.requested?' · generating…':''}</summary>
  <div className="planning-control-row"><div><strong>Daily planning</strong><p>Ask Hermes to reconsider today’s work. This does not rebuild every assignment.</p></div><button className="secondary-action" type="button" disabled={p.disabled||requesting||p.status.requested} aria-busy={requesting} onClick={async()=>{setRequesting(true);try{await p.refresh()}finally{setRequesting(false)}}}>{requesting?'Requesting…':p.status.requested?'Planning queued…':'Replan today'}</button></div>
  {p.status.error&&<p role="alert" className="planner-error">Planning failed: {p.status.error}</p>}
  {p.status.requested&&<p className="local-note" role="status">Waiting for the planner. Your saved tasks remain available.</p>}
  <section className="planning-sync-section" aria-label="Data synchronization"><strong>Data sync</strong><p className="planning-hint">Sync saved projects and tasks—not a capacity check or a new plan.</p><PlannerStatus planner={p} showScheduling={false}/></section>
  <SchedulingWarnings planner={p}/>
  {p.status.summary&&<details className="planner-history"><summary>Last planner explanation</summary><div className="planner-history-meta">{validTime?<time dateTime={timestamp}>{new Date(timestamp).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})} ET</time>:'Generation time unavailable'}</div><p>{p.status.summary}</p><p className="planning-hint">Historical context, not a live capacity check. Assignment breakdowns and later scheduling changes are tracked separately.</p></details>}
  <details className="planner-storage-note"><summary>Storage & scheduling limits</summary><p>Study plans and project tasks sync with the backend. Manual tasks are saved only in this browser and are not counted in the scheduling budget.</p></details>
 </details>
}
