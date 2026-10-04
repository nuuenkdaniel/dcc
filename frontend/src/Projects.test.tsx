import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import {Projects} from './Projects'
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
