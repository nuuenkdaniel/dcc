import type {ReactNode} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {beforeEach,expect,it,vi} from 'vitest'
import App from './App'

const mocks=vi.hoisted(()=>({useMail:vi.fn()}))
vi.mock('./AuthGate',()=>({AuthGate:({children}:{children:ReactNode})=>children}))
vi.mock('./useMail',()=>({
 useMail:mocks.useMail,
 accountLabel:(value:string)=>value,
 isImportant:()=>false,
 receivedToday:()=>false,
}))

beforeEach(()=>{
 window.history.replaceState({},'','/')
 mocks.useMail.mockReset().mockReturnValue({snapshot:{messages:[],accounts:[],today:''},message:'',busy:false,refresh:vi.fn(),feedback:vi.fn()})
})

it('enables mail networking only where mail is rendered',()=>{
 render(<App/>)
 expect(mocks.useMail).toHaveBeenLastCalledWith(true)
 fireEvent.click(screen.getByRole('button',{name:'Inbox'}))
 expect(mocks.useMail).toHaveBeenLastCalledWith(true)
 fireEvent.click(screen.getByRole('button',{name:'Focus'}))
 expect(mocks.useMail).toHaveBeenLastCalledWith(false)
 fireEvent.click(screen.getByRole('button',{name:'Home'}))
 expect(mocks.useMail).toHaveBeenLastCalledWith(true)
})
