import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import {Projects} from './Projects'
import {formatPlanningMinutes,formatProjectDate} from './projectFormatting'
import type {Planner} from './usePlanner'
afterEach(cleanup)
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
