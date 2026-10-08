import {useEffect,useRef,useState} from 'react'
import type {Planner,Project,Action} from './usePlanner'
import {formatPlanningMinutes,formatProjectDate} from './projectFormatting'
import {protectedFetch} from './auth'
function projectActionGroups(actions:Action[]){
 const groups=new Map<string,Action[]>()
 for(const action of actions){
  const key=action.needsRescheduling||!action.date?'':action.date
  groups.set(key,[...(groups.get(key)??[]),action])
 }
 return [...groups.entries()].sort(([a],[b])=>!a?1:!b?-1:a.localeCompare(b))
}
type Suggestion={id:string;selected:boolean;title:string;date:string;minutes:number;notes:string}
const emptyManual=(projectId:string):Action=>({id:crypto.randomUUID(),source:'manual-project',projectId,title:'',date:'',minutes:30,notes:'',completed:false,dismissed:false})
const validSuggestion=(suggestion:Suggestion)=>{
 if(!suggestion.title.trim()||suggestion.title.length>240||!/^\d{4}-\d{2}-\d{2}$/.test(suggestion.date)||!Number.isInteger(suggestion.minutes)||suggestion.minutes<5||suggestion.minutes>180||suggestion.notes.length>4000)return false
 const parsed=new Date(suggestion.date+'T00:00:00Z')
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===suggestion.date
}

function ManualActionForm({draft,setDraft,onSave,onCancel,submitLabel='Save task'}:{draft:Action;setDraft:(value:Action)=>void;onSave:()=>void;onCancel:()=>void;submitLabel?:string}){
 return <form className="project-editor project-task-form" onSubmit={event=>{event.preventDefault();onSave()}}>
  <label>Task title<input required maxLength={240} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
  <div className="project-fields"><label>Task date<input required type="date" value={draft.date} onChange={event=>setDraft({...draft,date:event.target.value})}/></label><label>Minutes<input required type="number" min={5} max={180} value={draft.minutes} onChange={event=>setDraft({...draft,minutes:Number(event.target.value)})}/></label></div>
  <label>Notes<textarea maxLength={4000} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
  <div className="project-buttons"><button type="submit">{submitLabel}</button><button type="button" onClick={onCancel}>Cancel</button></div>
 </form>
}

function ProjectTaskRow({action,planner:p}:{action:Action;planner:Planner}){
 const [editing,setEditing]=useState<Action|null>(null)
 if(action.source!=='manual-project')return <div className="generated-task-row"><div><strong>{action.title}</strong><span className="task-origin">Hermes</span>{action.notes&&<details className="task-notes"><summary>Task details</summary><p>{action.notes}</p></details>}</div><small>{formatPlanningMinutes(action.minutes)} · {action.completed?'Complete':'Open'}</small></div>
 return <div className="generated-task-row custom-project-task"><div><label className="project-task-title"><input type="checkbox" aria-label={`Complete ${action.title}`} checked={action.completed} onChange={()=>p.save('action',{...action,completed:!action.completed})}/><strong>{action.title}</strong></label><span className="task-origin">{action.origin==='hermes'?'Custom via Hermes':'Custom'}</span>{action.notes&&<details className="task-notes"><summary>Task details</summary><p>{action.notes}</p></details>}</div><div className="project-task-meta"><small>{formatPlanningMinutes(action.minutes)} · {action.completed?'Complete':'Open'}</small><button type="button" onClick={()=>setEditing({...action})}>Edit</button></div>{editing&&<ManualActionForm draft={editing} setDraft={setEditing} submitLabel="Save changes" onCancel={()=>setEditing(null)} onSave={()=>{if(p.save('action',{...editing,completed:action.completed,dismissed:action.dismissed},p.versionOf(action.id)))setEditing(null)}}/>}{editing&&<button type="button" className="dismiss-project-task" onClick={()=>{p.save('action',{...action,dismissed:true});setEditing(null)}}>Dismiss task</button>}</div>
}

function ProjectCard({project,planner:p,onEdit}:{project:Project;planner:Planner;onEdit:()=>void}){
 const actions=p.actions.filter(action=>action.projectId===project.id&&!action.dismissed)
 const complete=actions.filter(action=>action.completed).length
 const [manual,setManual]=useState<Action|null>(null),[asking,setAsking]=useState(false)
 const [prompt,setPrompt]=useState(''),[windowStart,setWindowStart]=useState(''),[windowEnd,setWindowEnd]=useState('')
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]),[previewing,setPreviewing]=useState(false),[previewError,setPreviewError]=useState('')
 const previewRequest=useRef<{id:number;controller:AbortController}|null>(null),requestId=useRef(0)
 const queuedSuggestionIds=useRef(new Set<string>())
 const cancelPreview=()=>{requestId.current++;previewRequest.current?.controller.abort();previewRequest.current=null;setPreviewing(false)}
 useEffect(()=>()=>cancelPreview(),[])
 const preview=async()=>{
  cancelPreview();setPreviewError('');setPreviewing(true)
  const id=++requestId.current,controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),150000);previewRequest.current={id,controller}
  try{
   const dateWindow=windowStart||windowEnd?{start:windowStart,end:windowEnd}:undefined
   const response=await protectedFetch('/api/v1/planner/custom-project-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,prompt,...(dateWindow?{dateWindow}:{})}),signal:controller.signal})
   const result=await response.json() as {suggestions?:Omit<Suggestion,'id'|'selected'>[];error?:string}
   if(id!==requestId.current)return
   if(!response.ok||!Array.isArray(result.suggestions))throw Error(result.error??'Could not preview suggestions')
   setSuggestions(result.suggestions.map(item=>({...item,id:crypto.randomUUID(),selected:true})))
  }catch(error){if(id===requestId.current&&!(error instanceof DOMException&&error.name==='AbortError'))setPreviewError(error instanceof Error?error.message:'Could not preview suggestions')}
  finally{window.clearTimeout(timer);if(id===requestId.current){previewRequest.current=null;setPreviewing(false)}}
 }
 const saveSuggestions=()=>{
  const saved=new Set<string>()
  for(const suggestion of suggestions){
   if(!suggestion.selected||queuedSuggestionIds.current.has(suggestion.id))continue
   if(p.save('action',{id:suggestion.id,source:'manual-project',origin:'hermes',projectId:project.id,title:suggestion.title,date:suggestion.date,minutes:suggestion.minutes,notes:suggestion.notes,completed:false,dismissed:false},0)){queuedSuggestionIds.current.add(suggestion.id);saved.add(suggestion.id)}
  }
  setSuggestions(current=>current.filter(suggestion=>!saved.has(suggestion.id)&&!queuedSuggestionIds.current.has(suggestion.id)))
 }
 return <article className="card project-card">
  <header className="project-card-header"><div className="project-heading"><div className="project-badges"><span>{project.category}</span><span>{project.status}</span></div><h2>{project.title}</h2><p className="project-deadline">{project.deadline?<>Due <time dateTime={project.deadline}>{formatProjectDate(project.deadline)}</time></>:'No deadline'}</p></div><button className="project-edit" aria-label={`Edit ${project.title}`} onClick={onEdit}>Edit</button></header>
  <div className="project-progress" aria-label={`${complete} of ${actions.length} project tasks complete`}><span><strong>{complete}/{actions.length}</strong> project tasks</span><span><strong>{formatPlanningMinutes(project.remainingMinutes)}</strong> planning allowance</span></div>
  <details className="generated-tasks"><summary>Project tasks ({actions.length})</summary><div className="generated-task-list">{!actions.length&&<p className="project-empty">No tasks have been created for this project yet.</p>}{projectActionGroups(actions).map(([date,group])=><section className="task-date-group" key={date||'needs-rescheduling'} aria-labelledby={`${project.id}-${date||'undated'}`}><h3 id={`${project.id}-${date||'undated'}`}>{date?formatProjectDate(date):'Needs rescheduling'}</h3>{group.map(action=><ProjectTaskRow action={action} planner={p} key={action.id}/>)}</section>)}</div></details>
  {(project.description||project.resources?.length||project.planSummary||project.planError)&&<details className="project-info"><summary>Project details</summary>{project.description&&<section><h3>Description</h3><p>{project.description}</p></section>}{!!project.resources?.length&&<section><h3>Resources</h3><ul>{project.resources.map((resource,index)=><li key={`${resource.name}-${index}`}>{resource.name}</li>)}</ul></section>}{project.planSummary&&<section><h3>Planner summary</h3><p>{project.planSummary}</p></section>}{project.planError&&<p role="alert">{project.planError}</p>}</details>}
  {manual&&<ManualActionForm draft={manual} setDraft={setManual} onCancel={()=>setManual(null)} onSave={()=>{if(p.save('action',manual,0))setManual(null)}}/>}
  {asking&&<section className="project-editor hermes-project-prompt"><label>What should Hermes help plan?<textarea required maxLength={4000} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="For example: Suggest tasks for Oct 10 and Oct 12"/></label><details><summary>Optional date window</summary><div className="project-fields"><label>Window start<input type="date" value={windowStart} onChange={event=>setWindowStart(event.target.value)}/></label><label>Window end<input type="date" value={windowEnd} onChange={event=>setWindowEnd(event.target.value)}/></label></div></details><div className="project-buttons"><button type="button" disabled={previewing||!prompt.trim()||Boolean(windowStart)!==Boolean(windowEnd)} onClick={()=>void preview()}>{previewing?'Previewing…':'Preview suggestions'}</button>{previewing&&<button type="button" onClick={cancelPreview}>Cancel preview</button>}<button type="button" onClick={()=>{cancelPreview();setAsking(false)}}>Close</button></div>{previewError&&<p role="alert">{previewError}</p>}{suggestions.length>0&&<div className="suggestion-list">{suggestions.map((suggestion,index)=><fieldset key={suggestion.id}><legend><label><input type="checkbox" checked={suggestion.selected} onChange={event=>setSuggestions(items=>items.map(item=>item.id===suggestion.id?{...item,selected:event.target.checked}:item))}/> Suggestion {index+1}</label></legend><label>Suggestion title<input required maxLength={240} value={suggestion.title} onChange={event=>setSuggestions(items=>items.map(item=>item.id===suggestion.id?{...item,title:event.target.value}:item))}/></label><div className="project-fields"><label>Suggestion date<input required type="date" value={suggestion.date} onChange={event=>setSuggestions(items=>items.map(item=>item.id===suggestion.id?{...item,date:event.target.value}:item))}/></label><label>Suggestion minutes<input required type="number" min={5} max={180} value={suggestion.minutes} onChange={event=>setSuggestions(items=>items.map(item=>item.id===suggestion.id?{...item,minutes:Number(event.target.value)}:item))}/></label></div><label>Suggestion notes<textarea maxLength={4000} value={suggestion.notes} onChange={event=>setSuggestions(items=>items.map(item=>item.id===suggestion.id?{...item,notes:event.target.value}:item))}/></label></fieldset>)}<button type="button" disabled={!suggestions.some(item=>item.selected)||suggestions.some(item=>item.selected&&!validSuggestion(item))} onClick={saveSuggestions}>Save selected</button></div>}</section>}
  <footer className="project-card-footer"><button type="button" disabled={p.disabled} onClick={()=>{setAsking(false);cancelPreview();setManual(emptyManual(project.id))}}>Add task</button><button type="button" disabled={p.disabled} onClick={()=>{setManual(null);setAsking(true)}}>Ask Hermes</button></footer>
 </article>
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
   const response=await protectedFetch('/api/v1/planner/material',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,content:btoa(binary)})})
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
   <label>Attach instructions<input className="project-file-input" type="file" accept=".pdf,.txt,.md" disabled={uploading} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file)}}/></label>
   {draft.resources?.map((resource,index)=><small key={`${resource.name}-${index}`}>{resource.name}</small>)}
   {uploadError&&<p role="alert">{uploadError}</p>}
   <div className="project-buttons project-form-actions"><button className="project-form-save" type="submit">Save project</button><button className="project-form-cancel" type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
  </form>}
  <div className="project-list">
   {p.projects.map(project=><ProjectCard key={project.id} project={project} planner={p} onEdit={()=>{setBaseVersion(p.versionOf(project.id));setDraft({...project})}}/>)}
  </div>
 </section>
}

export function ActionCard({action,planner:p}:{action:Action;planner:Planner}){
 const [draft,setDraft]=useState<Action|null>(null)
 const [baseVersion,setBaseVersion]=useState(0)
  const source=action.source==='manual-project'?(action.origin==='hermes'?'Custom via Hermes':'Custom'):'Hermes'
  return <article className={`task-card ${action.completed?'completed':''}`}><div className="task-summary"><input type="checkbox" aria-label={`Complete ${action.title}`} checked={action.completed} onChange={()=>p.save('action',{...action,completed:!action.completed})}/><button className="task-title" onClick={()=>{setBaseVersion(p.versionOf(action.id));setDraft(draft?null:action)}}>{action.title}</button><small>{action.minutes} min</small></div><p className="curated-source">{source} · {p.preparations.find(x=>x.id===action.preparationId)?.title??p.projects.find(x=>x.id===action.projectId)?.title??'Project'}</p>{action.preparationId&&action.completed&&<label className="study-feedback">How did it go? <select aria-label={`Study feedback for ${action.title}`} value={action.feedback??''} onChange={e=>p.save('action',{...action,feedback:e.target.value})}><option value="">Optional feedback</option><option value="comfortable">Comfortable</option><option value="review">Needs review</option></select></label>}{draft&&<form className="project-editor action-editor" onSubmit={e=>{e.preventDefault();if(p.save('action',{...draft,completed:action.completed,dismissed:action.dismissed},baseVersion))setDraft(null)}}><label>Action title<input required maxLength={240} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>{action.source==='manual-project'&&<div className="project-fields"><label>Action date<input required type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label><label>Action minutes<input required type="number" min={5} max={180} value={draft.minutes} onChange={e=>setDraft({...draft,minutes:Number(e.target.value)})}/></label></div>}<label>Action notes<textarea maxLength={4000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><div className="project-buttons"><button type="submit">Save action</button><button type="button" onClick={()=>p.save('action',{...action,dismissed:true})}>Dismiss action</button></div></form>}</article>
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
  <details className="planner-storage-note"><summary>Storage & scheduling limits</summary><p>Study plans and project tasks sync with the backend. Manual tasks save locally first and sync with the backend when connected; they are not counted in the scheduling budget.</p></details>
 </details>
}
