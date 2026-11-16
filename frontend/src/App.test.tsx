import { StrictMode } from 'react'
import type {ReactNode} from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App,{PomodoroView} from './App'
import {BrowserTimerProvider} from './browserTimer'
import {useBrowserTimer} from './timerContext'
import {SyntheticWorkspaceSession} from './test/WorkspaceSession'

vi.mock('./AuthGate',()=>({AuthGate:({children}:{children:ReactNode})=><SyntheticWorkspaceSession>{children}</SyntheticWorkspaceSession>}))

afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals()})
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
  expect(screen.getByRole('alert')).toHaveTextContent(/previous device tasks could not be read/i)
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
 const owner='a'.repeat(64)
 const planner={projects:[],preparations:[],actions,status:{}}
 window.localStorage.setItem('dcc.confirmed.planner.'+owner,JSON.stringify(planner))
 vi.stubGlobal('fetch',vi.fn(async (url:string,options?:RequestInit)=>{
  if(url==='/api/v1/workspace/writes'){
   const data=JSON.parse(String(options?.body)).payload.data
   const index=planner.actions.findIndex(entry=>entry.data.id===data.id)
   const entry={kind:'action',version:2,data}
   planner.actions[index]=entry
   return Response.json({state:'saved',entry})
  }
  return Response.json(url.includes('/planner/snapshot')?planner:{})
 }))
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
 await act(async()=>{await Promise.resolve()})
 fireEvent.click(completion)
 await waitFor(()=>expect(within(details).getByText('15 tasks')).toBeInTheDocument())
 expect(within(details).queryByText('Unplaced task 1')).not.toBeInTheDocument()
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

it('shows a quiet empty state without seeded tasks', () => {
  render(<App />)
  expect(screen.getAllByText('Loading tasks…').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button',{name:'Sync tasks'})).toBeNull()
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
