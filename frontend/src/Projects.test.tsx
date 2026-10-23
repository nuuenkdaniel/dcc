import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import {Projects} from './Projects'
import {formatPlanningMinutes,formatProjectDate} from './projectFormatting'
import type {Planner} from './usePlanner'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
test('one project creation flow retains instructions and saves a project',()=>{
 const save=vi.fn(()=>true)
 const planner={actions:[],projects:[],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn()} as unknown as Planner
 render(<Projects planner={planner}/> )
 expect(screen.queryByRole('button',{name:'Add assignment'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'New project'}))
 fireEvent.change(screen.getByLabelText('Project title'),{target:{value:'Course work'}})
 expect(screen.getByLabelText('Attach instructions')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Save project'}))
 expect(save).toHaveBeenCalledWith('project',expect.objectContaining({title:'Course work'}),0)
})

test('project labels format dates without timezone drift and describe planning allowance',()=>{
 expect(formatProjectDate('2026-10-08')).toBe('Oct 8, 2026')
 expect(formatProjectDate('2026-10-08T00:00:00-11:00')).toBe('Oct 8, 2026')
 expect(formatProjectDate('')).toBe('No deadline')
 expect(formatPlanningMinutes(45)).toBe('45m')
 expect(formatPlanningMinutes(135)).toBe('2h 15m')
})

test('project editing retains progress and status controls',()=>{
 const save=vi.fn(()=>true)
 const project={id:'project-1',title:'Existing project',category:'work',description:'Notes',deadline:'2026-10-20',importance:2,remainingMinutes:90,progress:'Draft reviewed',status:'active'}
 const planner={actions:[],projects:[project],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn(),versionOf:vi.fn(()=>3)} as unknown as Planner
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByRole('button',{name:'Edit Existing project'}))
 fireEvent.click(screen.getByText('More options',{exact:true}))
 fireEvent.change(screen.getByLabelText('Progress'),{target:{value:'Ready to submit'}})
 fireEvent.change(screen.getByLabelText('Project status'),{target:{value:'complete'}})
 fireEvent.click(screen.getByRole('button',{name:'Save project'}))
 expect(save).toHaveBeenCalledWith('project',expect.objectContaining({progress:'Ready to submit',status:'complete'}),3)
})

const existingProject={id:'11111111-1111-4111-8111-111111111111',title:'Existing project',category:'work',description:'Notes',deadline:'',importance:2,remainingMinutes:90,progress:'',status:'active'}

const archivedProject={...existingProject,id:'archived-project',title:'Archived work',status:'archived',progress:'Outline reviewed',resources:[{name:'Brief.txt',text:'Keep the brief'}],planSummary:'Previous plan'}
const linkedAction={id:'linked-action',projectId:existingProject.id,title:'Generated step',date:'2026-10-10',minutes:30,notes:'Saved task notes',completed:true,dismissed:false}
const archivePlanner=(overrides:Partial<Planner>={})=>({actions:[],projects:[existingProject,archivedProject],status:{},message:'',pending:0,disabled:false,syncing:false,save:vi.fn(()=>true),sync:vi.fn(),versionOf:vi.fn((id:string)=>id===archivedProject.id?17:5),...overrides} as unknown as Planner)

test('archive disclosure is closed after the primary list and counts only archived projects',()=>{
 const completed={...existingProject,id:'completed-project',title:'Completed work',status:'complete'}
 const {container}=render(<Projects planner={archivePlanner({projects:[existingProject,completed,archivedProject]})}/> )
 const primary=container.querySelector('.project-list')!
 expect(within(primary as HTMLElement).getByRole('heading',{name:existingProject.title})).toBeInTheDocument()
 expect(within(primary as HTMLElement).getByRole('heading',{name:completed.title})).toBeInTheDocument()
 expect(within(primary as HTMLElement).queryByText(archivedProject.title)).toBeNull()
 const summary=screen.getByText('Archived projects (1)',{exact:true})
 const disclosure=summary.closest('details')!
 expect(disclosure).not.toHaveAttribute('open')
 expect(primary.nextElementSibling).toBe(disclosure)
 fireEvent.click(summary)
 expect(disclosure).toHaveAttribute('open')
 expect(within(disclosure).getByRole('heading',{name:archivedProject.title})).toBeInTheDocument()
})

test('archive saves only the project status with its current optimistic version',()=>{
 const project={...existingProject,resources:[{name:'Notes.txt',text:'Original instructions'}],progress:'In progress',planSummary:'Keep this plan'}
 const action=Object.freeze({...linkedAction})
 const planner=archivePlanner({projects:[project],actions:[action]})
 const {container,rerender}=render(<Projects planner={planner}/>)
 // Read the version at click time, rather than retaining an earlier render's version.
 vi.mocked(planner.versionOf).mockReturnValue(9)
 fireEvent.click(screen.getByRole('button',{name:'Archive project'}))
 expect(planner.versionOf).toHaveBeenCalledWith(project.id)
 expect(planner.save).toHaveBeenCalledExactlyOnceWith('project',{...project,status:'archived'},9)
 expect(planner.actions[0]).toBe(action)
 expect(action).toEqual(linkedAction)
 planner.projects=[{...project,status:'archived'}]
 rerender(<Projects planner={planner}/>)
 expect(container.querySelector('.project-list')).not.toHaveTextContent(project.title)
 expect(screen.getByText('Archived projects (1)')).toBeInTheDocument()
})

test('restore saves active with the archived project exact current version and returns it to the primary list',()=>{
 const planner=archivePlanner({projects:[archivedProject]})
 const {container,rerender}=render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByText('Archived projects (1)'))
 vi.mocked(planner.versionOf).mockReturnValue(23)
 fireEvent.click(screen.getByRole('button',{name:'Restore project'}))
 expect(planner.versionOf).toHaveBeenCalledWith(archivedProject.id)
 expect(planner.save).toHaveBeenCalledExactlyOnceWith('project',{...archivedProject,status:'active'},23)
 planner.projects=[{...archivedProject,status:'active'}]
 rerender(<Projects planner={planner}/>)
 expect(container.querySelector('.project-list')).toHaveTextContent(archivedProject.title)
 expect(screen.getByText('Archived projects (0)')).toBeInTheDocument()
})

test('archived cards retain task history and project details without Add task or Ask Hermes',()=>{
 const planner=archivePlanner({projects:[archivedProject],actions:[{...linkedAction,projectId:archivedProject.id}]})
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByText('Archived projects (1)'))
 const card=screen.getByRole('heading',{name:archivedProject.title}).closest('article')!
 expect(within(card).queryByRole('button',{name:'Add task'})).toBeNull()
 expect(within(card).queryByRole('button',{name:'Ask Hermes'})).toBeNull()
 fireEvent.click(within(card).getByText('Project tasks (1)'))
 expect(within(card).getByText('Generated step')).toBeInTheDocument()
 expect(within(card).getByText('1/1')).toBeInTheDocument()
 fireEvent.click(within(card).getByText('Task details'))
 expect(within(card).getByText('Saved task notes')).toBeInTheDocument()
 fireEvent.click(within(card).getByText('Project details'))
 for(const text of ['Notes','Brief.txt','Previous plan'])expect(within(card).getByText(text)).toBeInTheDocument()
 expect(planner.save).not.toHaveBeenCalled()
})

test('empty archive remains discoverable with calm copy',()=>{
 render(<Projects planner={archivePlanner({projects:[]})}/> )
 const summary=screen.getByText('Archived projects (0)')
 expect(summary.closest('details')).not.toHaveAttribute('open')
 fireEvent.click(summary)
 expect(screen.getByText('No archived projects yet.')).toBeInTheDocument()
})

test('archive and restore respect disabled planner controls',()=>{
 render(<Projects planner={archivePlanner({disabled:true})}/> )
 expect(screen.getByRole('button',{name:'Archive project'})).toBeDisabled()
 fireEvent.click(screen.getByText('Archived projects (1)'))
 expect(screen.getByRole('button',{name:'Restore project'})).toBeDisabled()
})

test('project footer creates one dated manual action through the planner queue',()=>{
 const save=vi.fn(()=>true)
 vi.stubGlobal('crypto',{randomUUID:vi.fn(()=> '22222222-2222-4222-8222-222222222222')})
 const planner={actions:[],projects:[existingProject],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn(),versionOf:vi.fn(()=>1)} as unknown as Planner
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByRole('button',{name:'Add task'}))
 fireEvent.change(screen.getByLabelText('Task title'),{target:{value:'Write project outline'}})
 fireEvent.change(screen.getByLabelText('Task date'),{target:{value:'2026-10-10'}})
 fireEvent.change(screen.getByLabelText('Minutes'),{target:{value:'45'}})
 fireEvent.change(screen.getByLabelText('Notes'),{target:{value:'Keep this custom'}})
 fireEvent.click(screen.getByRole('button',{name:'Save task'}))
 expect(save).toHaveBeenCalledTimes(1)
 expect(save).toHaveBeenCalledWith('action',{id:'22222222-2222-4222-8222-222222222222',source:'manual-project',projectId:existingProject.id,title:'Write project outline',date:'2026-10-10',minutes:45,notes:'Keep this custom',completed:false,dismissed:false},0)
})

test('Hermes suggestions remain previews until selected and confirmed',async()=>{
 const save=vi.fn(()=>true)
 vi.stubGlobal('crypto',{randomUUID:vi.fn(()=> '33333333-3333-4333-8333-333333333333')})
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({suggestions:[{title:'Review draft',date:'2026-10-12',minutes:30,notes:'Check structure'}]})}))
 const planner={actions:[],projects:[existingProject],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn(),versionOf:vi.fn(()=>1)} as unknown as Planner
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByRole('button',{name:'Ask Hermes'}))
 fireEvent.change(screen.getByLabelText('What should Hermes help plan?'),{target:{value:'Plan work for Oct 10 and Oct 12'}})
 fireEvent.click(screen.getByRole('button',{name:'Preview suggestions'}))
 expect(await screen.findByDisplayValue('Review draft')).toBeInTheDocument()
 expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Save selected'}))
 await waitFor(()=>expect(save).toHaveBeenCalledWith('action',expect.objectContaining({id:'33333333-3333-4333-8333-333333333333',source:'manual-project',origin:'hermes',projectId:existingProject.id,date:'2026-10-12'}),0))
})

test('Hermes preview errors preserve the custom prompt without saving',async()=>{
 const save=vi.fn(()=>true)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'Preview unavailable'})}))
 const planner={actions:[],projects:[existingProject],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn(),versionOf:vi.fn(()=>1)} as unknown as Planner
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByRole('button',{name:'Ask Hermes'}))
 const prompt=screen.getByLabelText('What should Hermes help plan?')
 fireEvent.change(prompt,{target:{value:'Please use Oct 10 and Oct 12'}})
 fireEvent.click(screen.getByRole('button',{name:'Preview suggestions'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable')
 expect(prompt).toHaveValue('Please use Oct 10 and Oct 12')
 expect(save).not.toHaveBeenCalled()
})

test('multiple selected suggestions queue from one render and partial local failures remain retryable without duplicates',async()=>{
 const ids=['33333333-3333-4333-8333-333333333331','33333333-3333-4333-8333-333333333332']
 vi.stubGlobal('crypto',{randomUUID:vi.fn(()=>ids.shift()!)})
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({suggestions:[{title:'First task',date:'2026-10-10',minutes:30,notes:''},{title:'Second task',date:'2026-10-12',minutes:45,notes:''}]})}))
 let secondAttempts=0
 const save=vi.fn((_kind:string,data:unknown)=>{const action=data as {title:string};return action.title==='First task'||++secondAttempts>1})
 const planner={actions:[],projects:[existingProject],status:{},message:'',pending:0,disabled:false,syncing:false,save,sync:vi.fn(),versionOf:vi.fn(()=>1)} as unknown as Planner
 render(<Projects planner={planner}/>)
 fireEvent.click(screen.getByRole('button',{name:'Ask Hermes'}))
 fireEvent.change(screen.getByLabelText('What should Hermes help plan?'),{target:{value:'Two dates'}})
 fireEvent.click(screen.getByRole('button',{name:'Preview suggestions'}))
 expect(await screen.findByDisplayValue('First task')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Save selected'}))
 expect(save).toHaveBeenCalledTimes(2)
 expect(screen.queryByDisplayValue('First task')).not.toBeInTheDocument()
 expect(screen.getByDisplayValue('Second task')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Save selected'}))
 expect(save).toHaveBeenCalledTimes(3)
 expect(save.mock.calls.filter(([,data])=>(data as {title:string}).title==='First task')).toHaveLength(1)
 expect(screen.queryByDisplayValue('Second task')).not.toBeInTheDocument()
})
