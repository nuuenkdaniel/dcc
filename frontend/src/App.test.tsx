import { StrictMode } from 'react'
import type {ReactNode} from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App,{PomodoroView} from './App'
import {BrowserTimerProvider} from './browserTimer'
import {useBrowserTimer} from './timerContext'
import {SyntheticWorkspaceSession} from './test/WorkspaceSession'

vi.mock('./AuthGate',()=>({AuthGate:({children}:{children:ReactNode})=><SyntheticWorkspaceSession>{children}</SyntheticWorkspaceSession>}))

afterEach(() => vi.useRealTimers())
it('manual reorder and resume preserve the current RPC-started clock with queued minis',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000)
  function Rpc(){const port=useBrowserTimer();return <button onClick={()=>{
    const id=crypto.randomUUID()
    expect(port.process({tool:'control_focus_timer',args:{id,operationKey:'dcc_op_'+id,expectedVersion:port.document.version,action:'start'}}).state).toBe('applied')
  }}>RPC start</button>}
  render(<BrowserTimerProvider><PomodoroView/><Rpc/></BrowserTimerProvider>)
  await act(async()=>{await Promise.resolve()})
  fireEvent.click(screen.getByRole('button',{name:'Timer settings'}))
  fireEvent.click(screen.getByRole('button',{name:'RPC start'}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(65000)})
  for(const name of ['Later A','Later B']){
    fireEvent.change(screen.getByLabelText('Mini timer name'),{target:{value:name}})
    fireEvent.click(screen.getByRole('button',{name:'Add mini timer'}))
  }
  const grip=screen.getByRole('button',{name:'Reorder Later B'})
  const hitTestDescriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint')
  let hitTarget=screen.getByRole('button',{name:'Reorder Later A'}).closest('[data-timer-id]')!
  const hitTest=vi.fn((_x:number,_y:number)=>hitTarget)
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:hitTest})
  const readTimer=()=>JSON.parse(sessionStorage.getItem('dcc.focus-timer.tab.v1')!).timer
  try{
    expect(grip).toBeDisabled()
    const running=readTimer()
    fireEvent.keyDown(grip,{key:'ArrowUp'});fireEvent.pointerUp(grip,{clientX:10,clientY:20})
    expect(hitTest).toHaveBeenCalledOnce()
    expect(readTimer()).toEqual(running)
    expect(screen.getByTestId('session-time')).toHaveTextContent('23:55')
    expect(screen.queryByText(/moved to position/)).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Done'}))
    fireEvent.click(screen.getByRole('button',{name:'Pause session'}));fireEvent.click(screen.getByRole('button',{name:'Resume session'}))
    expect(screen.getByTestId('session-time')).toHaveTextContent('23:55')
    expect(screen.getByText('Stay with the task')).toBeVisible()

    // Start a legitimate idle drag, then let RPC change the session before drop.
    // Pointer-up must reach the current-state guard, not just clear an empty drag.
    fireEvent.click(screen.getByRole('button',{name:'Reset session'}))
    fireEvent.click(screen.getByRole('button',{name:'Timer settings'}))
    const dragGrip=screen.getByRole('button',{name:'Reorder Later B'})
    hitTarget=screen.getByRole('button',{name:'Reorder Later A'}).closest('[data-timer-id]')!
    const captureDescriptor=Object.getOwnPropertyDescriptor(dragGrip,'setPointerCapture')
    const capture=vi.fn()
    Object.defineProperty(dragGrip,'setPointerCapture',{configurable:true,value:capture})
    try{
      expect(dragGrip).toBeEnabled()
      fireEvent(dragGrip,new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:10,clientY:20}))
      expect(capture).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button',{name:'RPC start'}))
      await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
      const beforeDrop=readTimer()
      fireEvent(dragGrip,new MouseEvent('pointerup',{bubbles:true,clientX:10,clientY:20}))
      expect(hitTest).toHaveBeenLastCalledWith(10,20)
      expect(hitTest).toHaveBeenCalledTimes(2)
      expect(readTimer()).toEqual(beforeDrop)
      expect(beforeDrop.miniTimers.map((m:{name:string})=>m.name)).toEqual(['Later A','Later B'])
      expect(beforeDrop.running).toBe(true)
      expect(beforeDrop.activeMiniId).toBe(beforeDrop.miniTimers[0].id)
      expect(screen.getByTestId('session-time')).toHaveTextContent('04:59')
      expect(screen.queryByText(/moved to position/)).toBeNull()
    }finally{
      if(captureDescriptor)Object.defineProperty(dragGrip,'setPointerCapture',captureDescriptor)
      else Reflect.deleteProperty(dragGrip,'setPointerCapture')
    }
  }finally{
    if(hitTestDescriptor)Object.defineProperty(document,'elementFromPoint',hitTestDescriptor)
    else Reflect.deleteProperty(document,'elementFromPoint')
  }
})
it('adding the first mini while a default session is paused preserves its elapsed clock',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000)
  render(<BrowserTimerProvider><PomodoroView/></BrowserTimerProvider>)
  await act(async()=>{await Promise.resolve()})
  fireEvent.click(screen.getByRole('button',{name:'Start session'}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(65000)})
  fireEvent.click(screen.getByRole('button',{name:'Pause session'}))
  fireEvent.click(screen.getByRole('button',{name:'Timer settings'}))
  fireEvent.change(screen.getByLabelText('Mini timer name'),{target:{value:'Next session'}})
  fireEvent.click(screen.getByRole('button',{name:'Add mini timer'}))
  expect(screen.getByTestId('session-time')).toHaveTextContent('23:55')
  expect(screen.getByRole('button',{name:'Reorder Next session'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'Done'}));fireEvent.click(screen.getByRole('button',{name:'Resume session'}))
  expect(screen.getByTestId('session-time')).toHaveTextContent('23:55');expect(screen.getByText('Stay with the task')).toBeVisible()
})
it('a manual reorder persistence failure cannot publish a successful move notice',async()=>{
  render(<BrowserTimerProvider><PomodoroView/></BrowserTimerProvider>)
  await act(async()=>{await Promise.resolve()})
  fireEvent.click(screen.getByRole('button',{name:'Timer settings'}))
  for(const name of ['First','Second']){fireEvent.change(screen.getByLabelText('Mini timer name'),{target:{value:name}});fireEvent.click(screen.getByRole('button',{name:'Add mini timer'}))}
  const raw=sessionStorage.getItem('dcc.focus-timer.tab.v1'),original=Storage.prototype.setItem
  const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key==='dcc.focus-timer.tab.v1')throw Error('Synthetic storage failure');original.call(this,key,value)})
  try{fireEvent.keyDown(screen.getByRole('button',{name:'Reorder Second'}),{key:'ArrowUp'});expect(screen.queryByText(/moved to position/)).toBeNull();expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)}finally{storage.mockRestore()}
})

it('places the sole Hermes command below the Home header, never in the sidebar',()=>{
 const {container}=render(<App/>)
 const input=screen.getByPlaceholderText('Hermes'),form=input.closest('form')!
 expect(input).toBeVisible()
 expect(form.parentElement).toHaveAttribute('id','home')
 expect(form.previousElementSibling).toHaveClass('topbar')
 expect(form.nextElementSibling).toHaveClass('layout-grid')
 expect(container.querySelector('.sidebar .tell-hermes')).toBeNull()
 expect(container.querySelectorAll('.tell-hermes')).toHaveLength(1)
 fireEvent.click(screen.getByRole('button',{name:'Collapse sidebar'}))
 expect(input).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Inbox'}))
 expect(screen.queryByPlaceholderText('Hermes')).toBeNull()
})

it('selects the local day rather than UTC at night', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 2, 22, 0, 0))
  render(<App />)
  expect(screen.getAllByText('Friday, October 2').length).toBeGreaterThan(0)
})

it('warns instead of crashing when stored records are invalid', () => {
  window.localStorage.setItem('productivity-app.tasks.v1', '[null]')
  render(<App />)
  expect(screen.getByRole('alert')).toHaveTextContent(/stored tasks/i)
})
it('retains but does not display synchronized task tombstones',()=>{
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 window.localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id:'deleted-task',title:'Do not resurrect',date,notes:'',completed:false,deleted:true}]))
 render(<App/>)
 expect(screen.queryByText('Do not resurrect')).not.toBeInTheDocument()
 expect(JSON.parse(window.localStorage.getItem('productivity-app.tasks.v1')!)[0].deleted).toBe(true)
})
it('keeps 16 filtered unplaced tasks in a collapsed native disclosure and updates the count',async()=>{
 const actions=Array.from({length:16},(_,index)=>({kind:'action',version:1,data:{id:`unplaced-${index}`,projectId:'',title:`Unplaced task ${index+1}`,notes:'',minutes:20,date:'',needsRescheduling:true,completed:false,dismissed:false}}))
 window.localStorage.setItem('daymark.planner.v1',JSON.stringify({snapshot:{projects:[],preparations:[],actions,status:{}},pending:[]}))
 render(<App/>)
 const details=screen.getByText('Needs rescheduling').closest('details')!
 expect(details).not.toHaveAttribute('open')
 expect(within(details).getByText('16 tasks')).toBeInTheDocument()
 expect(within(details).getByText('Unplaced task 1')).not.toBeVisible()
 fireEvent.change(screen.getByLabelText('Search tasks'),{target:{value:'Unplaced task 16'}})
 expect(within(details).getByText('1 task')).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Search tasks'),{target:{value:''}})
 fireEvent.click(within(details).getByText('Needs rescheduling'))
 const completion=within(details).getByRole('checkbox',{name:'Complete Unplaced task 1'})
 expect(completion).toBeVisible()
 fireEvent.click(completion)
 await waitFor(()=>expect(within(details).getByText('15 tasks')).toBeInTheDocument())
 expect(within(details).queryByText('Unplaced task 1')).not.toBeInTheDocument()
})
it('persists ordinary deletion as a hidden tombstone and Undo restores deleted false',async()=>{
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 window.localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id:'ordinary',title:'Ordinary task',date,notes:'',completed:false}]))
 render(<App/>)
 fireEvent.click(screen.getByRole('button',{name:'Expand Ordinary task'}))
 fireEvent.click(screen.getByRole('button',{name:'Delete task'}))
 expect(await screen.findByRole('button',{name:'Undo'})).toBeInTheDocument()
 expect(screen.queryByText('Ordinary task')).not.toBeInTheDocument()
 expect(screen.getByText('0',{selector:'.task-count'})).toBeInTheDocument()
 await waitFor(()=>expect(JSON.parse(window.localStorage.getItem('productivity-app.tasks.v1')!)[0].deleted).toBe(true))
 fireEvent.change(screen.getByLabelText('Search tasks'),{target:{value:'Ordinary'}})
 expect(screen.queryByText('Ordinary task')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Undo'}))
 expect(await screen.findByText('Ordinary task')).toBeInTheDocument()
 await waitFor(()=>expect(JSON.parse(window.localStorage.getItem('productivity-app.tasks.v1')!)[0].deleted).toBe(false))
})
it('Undo stages before a delayed local lock, disables duplicate clicks and confirms only after persistence',async()=>{
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id:'undo-local',title:'Undo local',date,notes:'Keep notes',completed:false,important:true,futureMetadata:{synthetic:true}}]))
 render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Expand Undo local'}));fireEvent.click(screen.getByRole('button',{name:'Delete task'}))
 await screen.findByRole('button',{name:'Undo'})
 const removed=JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)[0]
 const locks=navigator.locks,callbacks:(()=>void)[]=[]
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,...args:unknown[])=>{
  const callback=args.at(-1) as ()=>unknown
  if(name!=='daymark.manual-tasks.v1')return Reflect.apply(locks.request,locks,[name,...args])
  return new Promise((resolve,reject)=>callbacks.push(()=>{try{resolve(callback())}catch(error){reject(error)}}))
 }}})
 try{
  const undo=screen.getByRole('button',{name:'Undo'});fireEvent.click(undo);fireEvent.click(undo)
  await waitFor(()=>expect(callbacks).toHaveLength(1))
  expect(screen.getByRole('button',{name:'Restoring…'})).toBeDisabled()
  expect(JSON.parse(sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1')!).expected).toEqual(removed)
  expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([removed])
  expect(screen.queryByRole('button',{name:/^(Expand|Collapse) Undo local$/})).toBeNull()
  await act(async()=>{callbacks[0]();await Promise.resolve()})
  // Undo preserves the previously expanded task ID; the restored row is open.
  const restored=await screen.findByRole('button',{name:'Collapse Undo local'})
  expect(restored).toHaveAttribute('aria-expanded','true')
  expect(screen.getByLabelText('Undo local notes')).toHaveValue('Keep notes')
  expect(screen.getByLabelText('Important',{exact:true})).toBeChecked()
  expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([{...removed,deleted:false}])
  expect(sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1')).toBeNull()
 }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
it('unmount cancels a waiting Undo without clearing it; same verified workspace remount recovers',async()=>{
 const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 localStorage.setItem('productivity-app.tasks.v1',JSON.stringify([{id:'unmount-undo',title:'Unmount Undo',date,notes:'Retain notes',completed:false,important:true}]))
 const first=render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Expand Unmount Undo'}));fireEvent.click(screen.getByRole('button',{name:'Delete task'}));await screen.findByRole('button',{name:'Undo'})
 const removed=JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)[0],locks=navigator.locks,callbacks:(()=>void)[]=[]
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,...args:unknown[])=>name!=='daymark.manual-tasks.v1'?Reflect.apply(locks.request,locks,[name,...args]):new Promise((resolve,reject)=>callbacks.push(()=>{try{resolve((args.at(-1) as ()=>unknown)())}catch(error){reject(error)}}))}})
 try{
  fireEvent.click(screen.getByRole('button',{name:'Undo'}));await waitFor(()=>expect(callbacks).toHaveLength(1))
  const raw=sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1');expect(JSON.parse(raw!).owner).toBe('a'.repeat(64))
  first.unmount();await act(async()=>{callbacks[0]();await Promise.resolve()})
  expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([removed]);expect(sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1')).toBe(raw)
  render(<App/>);await waitFor(()=>expect(callbacks).toHaveLength(2))
  await act(async()=>{callbacks[1]();await Promise.resolve()})
  await screen.findByRole('button',{name:'Expand Unmount Undo'})
  expect(JSON.parse(localStorage.getItem('productivity-app.tasks.v1')!)).toEqual([{...removed,deleted:false}]);expect(sessionStorage.getItem('dcc.manual-tasks.pending-undo.v1')).toBeNull()
 }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
it('retains a new task draft when safe storage locking is unavailable',async()=>{
 const locks=navigator.locks
 Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
 try{
  render(<App/>)
  fireEvent.change(screen.getByLabelText('Task title'),{target:{value:'Keep this draft'}})
  fireEvent.click(screen.getByRole('button',{name:'Add task'}))
  expect(await screen.findByText(/Safe task editing requires browser Web Locks/)).toBeInTheDocument()
  expect(screen.getByLabelText('Task title')).toHaveValue('Keep this draft')
  expect(window.localStorage.getItem('productivity-app.tasks.v1')).toBeNull()
 }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})

it('moves between months and returns to today', () => {
  render(<App />)
  const month = screen.getByRole('heading', { level: 2, name: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date()) })
  const initial = month.textContent
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  expect(month.textContent).not.toBe(initial)
  fireEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(month.textContent).toBe(new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date()))
})

it('creates, expands, completes, and restores a local task', async () => {
  const { unmount } = render(<App />)
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Read chapter notes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  expect(screen.getByText('Read chapter notes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Read chapter notes' }))
  expect(screen.getByPlaceholderText('Add context or notes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Read chapter notes' }))
  expect(screen.getByText('Completed', { selector: '.task-state' })).toBeInTheDocument()

  await waitFor(()=>expect(JSON.parse(window.localStorage.getItem('productivity-app.tasks.v1')??'[]')).toEqual(expect.arrayContaining([expect.objectContaining({title:'Read chapter notes',completed:true})])))

  unmount()
  render(<App />)
  expect(screen.getByText('Read chapter notes')).toBeInTheDocument()
})

it('shows a quiet empty state without seeded tasks', () => {
  render(<App />)
  expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
  expect(screen.getByText(/manual tasks save locally first and sync/i)).toBeInTheDocument()
})

it('switches between development page previews', () => {
  render(<App />)
  expect(screen.getByRole('toolbar', { name: 'Development tools' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Inbox view' }))
  expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Daily plan' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Home view' }))
  expect(screen.getByRole('heading', { name: 'Daily plan' })).toBeInTheDocument()
})

it('retains logout in development tools and Settings, but not Schedule', () => {
  render(<App />)
  const schedule = screen.getByRole('region', { name: 'Schedule' })
  expect(within(schedule).queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out / test login' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.getByRole('button', { name: /^Sign out$/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out / test login' })).toBeInTheDocument()
})

it('collapses the sidebar without removing navigation', () => {
  render(<App />)
  const sidebar = screen.getByRole('complementary')

  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
  expect(sidebar).toHaveClass('collapsed')
  expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Focus' }))
  expect(window.location.pathname).toBe('/pomodoro')
  expect(screen.getByRole('heading', { name: 'Focus session' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
  expect(sidebar).not.toHaveClass('collapsed')
})

it('uses page URLs and responds to browser history navigation', () => {
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: 'Pomodoro view' }))
  expect(window.location.pathname).toBe('/pomodoro')
  expect(screen.getByRole('heading', { name: 'Focus session' })).toBeInTheDocument()

  window.history.pushState({}, '', '/inbox')
  fireEvent(window, new PopStateEvent('popstate'))
  expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()

  window.history.pushState({}, '', '/')
  fireEvent(window, new PopStateEvent('popstate'))
  expect(screen.getByRole('heading', { name: 'Daily plan' })).toBeInTheDocument()
})

it('loads a page directly from its URL', () => {
  window.history.replaceState({}, '', '/pomodoro')
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Focus session' })).toBeInTheDocument()
})

it('previews isolated sample tasks without writing them to local storage', () => {
  render(<App />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sample data' }))
  expect(screen.getByText('Review calendar integration')).toBeInTheDocument()
  expect(window.localStorage.getItem('productivity-app.tasks.v1')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sample data' }))
  expect(screen.queryByText('Review calendar integration')).not.toBeInTheDocument()
})

it('runs mini focus sessions in order and breaks after the last one', () => {
  vi.useFakeTimers()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Pomodoro view' }))
  fireEvent.click(screen.getByRole('button', { name: 'Timer settings' }))

  fireEvent.change(screen.getByLabelText('Mini timer name'), { target: { value: 'Outline chapter' } })
  fireEvent.change(screen.getByLabelText('Mini timer minutes'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add mini timer' }))
  fireEvent.change(screen.getByLabelText('Mini timer name'), { target: { value: 'Practice questions' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add mini timer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  expect(screen.getByTestId('session-time')).toHaveTextContent('01:00')
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(screen.getByText('Outline chapter', { selector: '.focus-status' })).toBeInTheDocument()

  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('Complete')).toBeInTheDocument()
  expect(screen.getByText('Practice questions', { selector: '.focus-status' })).toBeInTheDocument()
  expect(screen.getByTestId('session-time')).toHaveTextContent('01:00')
  expect(screen.queryByText('Break', { selector: '#focus-clock-heading' })).not.toBeInTheDocument()

  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('Break', { selector: '#focus-clock-heading' })).toBeInTheDocument()
  expect(screen.getByTestId('session-time')).toHaveTextContent('05:00')
})

it('starts immediately once owned and waits a full second before the first displayed decrement', async() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/pomodoro')
  render(<StrictMode><App /></StrictMode>)
  await act(async()=>{await Promise.resolve()})
  expect(screen.getByRole('button',{name:'Start session'})).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument()
  expect(screen.getByText('Stay with the task', { selector: '.focus-status' })).toBeInTheDocument()
  expect(screen.getByTestId('session-time')).toHaveTextContent('25:00')

  act(() => vi.advanceTimersByTime(999))
  expect(screen.getByTestId('session-time')).toHaveTextContent('25:00')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('session-time')).toHaveTextContent('24:59')
})

it('preserves fractional elapsed time through a pause and resume', () => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/pomodoro')
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  act(() => vi.advanceTimersByTime(400))
  fireEvent.click(screen.getByRole('button', { name: 'Pause session' }))
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByTestId('session-time')).toHaveTextContent('25:00')

  fireEvent.click(screen.getByRole('button', { name: 'Resume session' }))
  act(() => vi.advanceTimersByTime(599))
  expect(screen.getByTestId('session-time')).toHaveTextContent('25:00')
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByTestId('session-time')).toHaveTextContent('24:59')
})

it('does not recreate the running interval on timer renders', () => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/pomodoro')
  const intervalSpy = vi.spyOn(window, 'setInterval')
  render(<App />)

  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  const intervalsAfterStart = intervalSpy.mock.calls.length
  act(() => vi.advanceTimersByTime(2000))
  expect(intervalSpy).toHaveBeenCalledTimes(intervalsAfterStart)
  intervalSpy.mockRestore()
})

it('pauses and resets the ordered mini focus sequence', () => {
  vi.useFakeTimers()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Pomodoro view' }))
  fireEvent.click(screen.getByRole('button', { name: 'Timer settings' }))
  fireEvent.change(screen.getByLabelText('Mini timer name'), { target: { value: 'Read notes' } })
  fireEvent.change(screen.getByLabelText('Mini timer minutes'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add mini timer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByTestId('session-time')).toHaveTextContent('04:59')
  expect(screen.getByTestId('mini-time')).toHaveTextContent('04:59')

  fireEvent.click(screen.getByRole('button', { name: 'Pause session' }))
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByTestId('session-time')).toHaveTextContent('04:59')

  fireEvent.click(screen.getByRole('button', { name: 'Reset session' }))
  expect(screen.getByTestId('session-time')).toHaveTextContent('05:00')
  expect(screen.getByTestId('mini-time')).toHaveTextContent('05:00')
  expect(screen.getByText('Ready', { selector: '.mini-timer span' })).toBeInTheDocument()
})

it('configures a break in the compact timer settings and starts it after focus', () => {
  vi.useFakeTimers()
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Pomodoro view' }))

  expect(screen.queryByLabelText('Focus session minutes')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Timer settings' }))
  expect(screen.getByRole('dialog', { name: 'Timer setup' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Increase break timer' }))
  expect(screen.getByLabelText('Break timer (minutes)')).toHaveValue(6)
  fireEvent.click(screen.getByRole('button', { name: 'Decrease break timer' }))
  expect(screen.getByLabelText('Break timer (minutes)')).toHaveValue(5)

  const focusInput = screen.getByLabelText('Focus timer (minutes)')
  fireEvent.change(focusInput, { target: { value: '' } })
  expect(focusInput).toHaveValue(null)
  fireEvent.change(focusInput, { target: { value: '40' } })
  expect(focusInput).toHaveValue(40)

  fireEvent.change(focusInput, { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Break timer (minutes)'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))

  expect(screen.getByTestId('session-time')).toHaveTextContent('01:00')
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('Break')).toBeInTheDocument()
  expect(screen.getByTestId('session-time')).toHaveTextContent('02:00')
})
