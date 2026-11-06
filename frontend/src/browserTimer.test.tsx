import {act,fireEvent,render,screen} from '@testing-library/react'
import {beforeEach,afterEach,expect,test,vi} from 'vitest'
import {BrowserTimerProvider} from './browserTimer'
import {useBrowserTimer} from './timerContext'
import {applyTimerCommand,freshTimer,restoreTimerDocument,type TimerDocument} from './timerState'
import {runTimerCampaign} from './timerCampaign'
import {TellHermes} from './TellHermes'
import {protectedFetch} from './auth'
import {advanceFocusTimer} from './focusTimer'
import {AuthGate} from './AuthGate'
import {StrictMode} from 'react'
vi.mock('./auth',()=>({protectedFetch:vi.fn(),AUTH_REQUIRED_EVENT:'dcc-auth-required'}))
const id='12345678-1234-4234-a234-123456789abc'
function command(action:string,version=1,extra:Record<string,unknown>={}){return {tool:'control_focus_timer',args:{id,operationKey:'dcc_op_'+id,expectedVersion:version,action,...extra}}}
beforeEach(()=>{sessionStorage.clear();localStorage.clear();vi.mocked(protectedFetch).mockReset()})
afterEach(()=>vi.useRealTimers())
test('timer commands preserve elapsed progress and exact persisted replay never restarts a timer',()=>{
  const started=applyTimerCommand(freshTimer(1000),command('start'),1000)
  expect(started.result.state).toBe('applied')
  const advanced:TimerDocument={...started.document,timer:advanceFocusTimer(started.document.timer,65000,1500000,300000),updatedAt:66000}
  const reloaded=JSON.parse(JSON.stringify(advanced)) as TimerDocument
  const replay=applyTimerCommand(reloaded,command('start'),66000)
  expect(replay.document.timer.sessionRemainingMs).toBe(1435000)
  expect(replay.result).toEqual(started.result)
  expect(applyTimerCommand(reloaded,command('reset'),66000).result).toEqual({state:'rejected',code:'forbidden'})
  const pause=command('pause',2);pause.args.operationKey='dcc_op_22345678-1234-4234-a234-123456789abc'
  const paused=applyTimerCommand(reloaded,pause,66000)
  expect(paused.document.timer.running).toBe(false)
  expect(advanceFocusTimer(paused.document.timer,60000,1500000,300000).sessionRemainingMs).toBe(1435000)
  const resume=command('resume',3);resume.args.operationKey='dcc_op_32345678-1234-4234-a234-123456789abc'
  const resumed=applyTimerCommand(paused.document,resume,126000)
  expect(resumed.document.timer.running).toBe(true)
  expect(resumed.document.timer.sessionRemainingMs).toBe(1435000)
})
test('stale versions and malformed commands do not alter browser timer state',()=>{
  const d=freshTimer(1000)
  for(const c of [command('javascript'),command('start',2),command('configure',1,{focusMinutes:0}),command('pause',1,{phase:'break'}),{tool:'shell',args:{}}]){
    const result=applyTimerCommand(d,c,1000)
    expect(result.result.state).not.toBe('applied');expect(result.document).toBe(d)
  }
})
test.each(['start','resume'])('%s preserves a running and paused default session after queue insertion and reload',action=>{
  for(const running of [true,false]){
  let d=applyTimerCommand(freshTimer(1000),command('start'),1000).document
  d={...d,timer:{...advanceFocusTimer(d.timer,65000,1500000,300000),running},updatedAt:66000}
  const miniId='22345678-1234-4234-a234-123456789abc'
  d=applyTimerCommand(d,{tool:'edit_focus_queue',args:{id:miniId,operationKey:'dcc_op_'+miniId,expectedVersion:d.version,action:'add',name:'Later step',minutes:5}},66000).document
  expect(d.timer.sessionRemainingMs).toBe(1435000)
  d=restoreTimerDocument(JSON.parse(JSON.stringify(d)),67000).document
  const run=command(action,d.version);run.args.operationKey='dcc_op_32345678-1234-4234-a234-123456789abc'
  d=applyTimerCommand(d,run,67000).document
  const remaining=running?1434000:1435000
  expect(d.timer).toMatchObject({running:true,activeMiniId:null,sessionRemainingMs:remaining})
  d={...d,timer:{...d.timer,running:false}}
  const resumed=command(action,d.version);resumed.args.operationKey='dcc_op_42345678-1234-4234-a234-123456789abc'
  expect(applyTimerCommand(d,resumed,68000).document.timer).toMatchObject({running:true,activeMiniId:null,sessionRemainingMs:remaining})
  }
})
test('receipt-only recovery never executes an absent operation, including after journal compaction',()=>{
  const original=freshTimer(1000),op=command('start')
  expect(applyTimerCommand(original,op,1000,true)).toEqual({document:original,result:{state:'uncertain',operationKey:op.args.operationKey}})
  const applied=applyTimerCommand(original,op,1000)
  const restored=restoreTimerDocument(JSON.parse(JSON.stringify(applied.document)),66000)
  const recovered=applyTimerCommand(restored.document,op,66000,true)
  expect(recovered.result).toEqual(applied.result)
  expect(recovered.document.timer.sessionRemainingMs).toBe(1435000)
  for(const seed of [20261105,20261106])expect(runTimerCampaign(seed).operations).toBe(256)
})
test('stored clock rejects zero duration/invalid data, pauses backwards time, and handles exact/large elapsed boundaries',()=>{
  const running={...freshTimer(1000),timer:{...freshTimer(1000).timer,running:true}}
  expect(()=>restoreTimerDocument({...running,focusMinutes:0},2000)).toThrow()
  expect(()=>restoreTimerDocument({...running,updatedAt:NaN},2000)).toThrow()
  const backwards=restoreTimerDocument(running,0)
  expect(backwards.document.timer.running).toBe(false);expect(backwards.warning).toMatch(/backwards/)
  const boundary=restoreTimerDocument(running,1501000)
  expect(boundary.document.timer.phase).toBe('break');expect(boundary.document.timer.sessionRemainingMs).toBe(300000)
  const complete=restoreTimerDocument(running,1801000)
  expect(complete.document.timer.running).toBe(false);expect(complete.document.timer.phase).toBe('focus')
  expect(restoreTimerDocument(running,Number.MAX_SAFE_INTEGER).document.timer.running).toBe(false)
})
test('configure focus/break and mini queue add/move/remove preserve identities and refuse active reorder',()=>{
  let d=freshTimer(1000),counter=0
  const run=(tool:string,fields:Record<string,unknown>)=>{
    const operationId=String(++counter).padStart(8,'0')+'-1234-4234-a234-123456789abc'
    const applied=applyTimerCommand(d,{tool,args:{id:operationId,operationKey:'dcc_op_'+operationId,expectedVersion:d.version,...fields}},1000)
    if(applied.result.state==='applied')d=applied.document
    return applied.result
  }
  expect(run('control_focus_timer',{action:'configure',focusMinutes:40,breakMinutes:10}).state).toBe('applied')
  expect(d.timer.sessionRemainingMs).toBe(2400000)
  run('edit_focus_queue',{action:'add',name:'Read notes',minutes:5})
  run('edit_focus_queue',{action:'add',name:'Implement exercise',minutes:10})
  const [first,second]=d.timer.miniTimers.map(m=>m.id)
  run('edit_focus_queue',{action:'move',miniId:second,beforeId:first})
  expect(d.timer.miniTimers.map(m=>m.id)).toEqual([second,first])
  run('control_focus_timer',{action:'start'})
  expect(d.timer.activeMiniId).toBe(second)
  expect(run('edit_focus_queue',{action:'move',miniId:first,beforeId:second}).state).toBe('conflict')
  run('control_focus_timer',{action:'reset'})
  run('edit_focus_queue',{action:'remove',miniId:first})
  expect(d.timer.miniTimers.map(m=>m.id)).toEqual([second])
})
function Clock(){const {document}=useBrowserTimer();return <output aria-label="Actual timer">{document.timer.running?'running':'paused'}:{document.timer.sessionRemainingMs}</output>}
test('a duplicate-tab Web Lock refusal quarantines copied running storage, including manual controls and reload',async()=>{
  vi.useFakeTimers();vi.setSystemTime(66000)
  const copied=applyTimerCommand(freshTimer(1000),command('start'),1000).document
  const raw=JSON.stringify(copied)
  sessionStorage.setItem('dcc.focus-timer.tab.v1',raw);sessionStorage.setItem('dcc.hermes.tab.v1',id)
  const locks=navigator.locks
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,callback:(lock:null)=>Promise<void>)=>callback(null)}})
  function Probe(){const port=useBrowserTimer();return <><Clock/><p>{port.warning}</p><button onClick={()=>port.setTimer(t=>({...t,running:false}))}>Manual pause</button><button onClick={()=>expect(port.process(command('reset',2))).toEqual({state:'rejected',code:'forbidden'})}>RPC</button></>}
  try{
    const view=render(<BrowserTimerProvider><Probe/></BrowserTimerProvider>)
    await act(async()=>{await Promise.resolve()})
    expect(screen.getByText(/another tab owns/i)).toBeVisible()
    fireEvent.click(screen.getByText('Manual pause'));fireEvent.click(screen.getByText('RPC'))
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)
    expect(screen.getByLabelText('Actual timer')).toHaveTextContent('paused:1500000')
    view.unmount();render(<BrowserTimerProvider><Probe/></BrowserTimerProvider>)
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)
  }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('rendered natural prompt -> browser command -> ACK -> receipt changes actual timer, not just model prose',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
  const locks=navigator.locks
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,callback:(lock:object)=>Promise<void>)=>callback({})}})
  let pending:unknown[]=[];let finish:(r:Response)=>void=()=>{};let submitted=false
  vi.mocked(protectedFetch).mockImplementation(async(input,init)=>{
    const path=String(input),body=JSON.parse(String(init?.body??'{}'))
    if(path.endsWith('action-capabilities'))return new Response('{"productActions":true}')
    if(path.endsWith('/actions')){submitted=true;expect(body.tabId).toMatch(/^[a-f0-9-]{36}$/);pending=[{nonce:'a'.repeat(64),expiresAt:Date.now()+10000,command:command('start')}];return new Promise(r=>{finish=r})}
    if(path.endsWith('timer-bridge')){
      if(body.ack){expect(body.ack.result).toEqual({state:'applied',id,version:2});pending=[];finish(new Response(JSON.stringify({message:'Browser acknowledged.',summary:{phase:'completed',outcome:'effects_recorded',effects:[{tool:'control_focus_timer',state:'applied',id,version:2}],pending:0,reads:[]}})))}
      return new Response(JSON.stringify({commands:pending}))
    }
    throw Error('Unexpected synthetic request')
  })
  try{
    render(<BrowserTimerProvider><TellHermes onCreated={vi.fn()}/><Clock/></BrowserTimerProvider>)
    await act(async()=>{await vi.advanceTimersByTimeAsync(0)})
    const prompt=screen.getByPlaceholderText('Hermes')
    fireEvent.change(prompt,{target:{value:'Start my Pomodoro focus session'}});fireEvent.submit(prompt.closest('form')!)
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(submitted).toBe(true);expect(screen.getByLabelText('Actual timer')).toHaveTextContent('running:')
    expect(document.getElementById(prompt.getAttribute('aria-describedby')!)).toHaveTextContent('DCC actions saved.')
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
    expect(Number(screen.getByLabelText('Actual timer').textContent!.split(':')[1])).toBeLessThan(1500000)
  }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('pending ownership is inert, unmount ignores a late grant, and reacquisition reconciles persisted elapsed once',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000)
  const locks=navigator.locks,raw=JSON.stringify(applyTimerCommand(freshTimer(1000),command('start'),1000).document)
  sessionStorage.setItem('dcc.focus-timer.tab.v1',raw);sessionStorage.setItem('dcc.hermes.tab.v1',id)
  const callbacks:((lock:object|null)=>Promise<void>)[]=[]
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,_o:unknown,cb:(lock:object|null)=>Promise<void>)=>{callbacks.push(cb)}}})
  function Probe(){const p=useBrowserTimer();return <><Clock/><p>{p.warning}</p><button onClick={p.retryOwnership}>Retry ownership</button><button onClick={()=>p.setTimer(t=>({...t,running:false}))}>Pause</button></>}
  try{
    const first=render(<BrowserTimerProvider><Probe/></BrowserTimerProvider>)
    fireEvent.click(screen.getByText('Pause'))
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)
    first.unmount();await callbacks[0]({}) // AuthGate unmount has the same cleanup.
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)
    const second=render(<BrowserTimerProvider><Probe/></BrowserTimerProvider>)
    await act(async()=>{await callbacks[1](null)})
    expect(screen.getByText(/Another tab owns/)).toBeVisible()
    fireEvent.click(screen.getByText('Retry ownership'))
    let held:Promise<void>|undefined
    await act(async()=>{await Promise.resolve();held=callbacks[2]({});await Promise.resolve()})
    expect(screen.getByLabelText('Actual timer')).toHaveTextContent('running:1499000')
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
    expect(JSON.parse(sessionStorage.getItem('dcc.focus-timer.tab.v1')!).timer.sessionRemainingMs).toBe(1498000)
    expect(JSON.parse(sessionStorage.getItem('dcc.focus-timer.tab.v1')!).receipts).toEqual(JSON.parse(raw).receipts)
    second.unmount();await held
  }finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('missing Web Locks differs from denied ownership and never overwrites copied storage',async()=>{
  const locks=navigator.locks,raw=JSON.stringify(freshTimer(1000))
  sessionStorage.setItem('dcc.focus-timer.tab.v1',raw)
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
  function Probe(){const p=useBrowserTimer();return <p>{p.warning}</p>}
  try{render(<BrowserTimerProvider><Probe/></BrowserTimerProvider>);expect(screen.getByText(/Web Locks unavailable/)).toBeVisible();expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)}finally{Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('StrictMode waits for a stale browser request to release before requesting the same identity again',async()=>{
  const locks=navigator.locks
  const requests:{callback:(lock:object|null)=>Promise<void>;complete:()=>void}[]=[]
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<void>)=>new Promise<void>(complete=>{requests.push({callback,complete})})}})
  function Probe(){const p=useBrowserTimer();return <output aria-label="Ownership">{p.owned?'owned':'quarantined'}</output>}
  const view=render(<StrictMode><BrowserTimerProvider><Probe/></BrowserTimerProvider></StrictMode>)
  try{
    expect(requests).toHaveLength(1)
    expect(screen.getByLabelText('Ownership')).toHaveTextContent('quarantined')
    await act(async()=>{await requests[0].callback({});requests[0].complete();await Promise.resolve()})
    expect(requests).toHaveLength(2)
    expect(screen.getByLabelText('Ownership')).toHaveTextContent('quarantined')
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBeNull()
    let held:Promise<void>|undefined
    await act(async()=>{held=requests[1].callback({});await Promise.resolve()})
    expect(screen.getByLabelText('Ownership')).toHaveTextContent('owned')
    view.unmount();await held;requests[1].complete()
  }finally{view.unmount();for(const request of requests)request.complete();Object.defineProperty(navigator,'locks',{configurable:true,value:locks})}
})
test('authentication expiry unmounts the owned clock, releases its lock and preserves receipt storage',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000)
  const locks=navigator.locks,released=vi.fn(),route=window.location.pathname
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({authenticated:true,configured:true})))
  const raw=JSON.stringify(applyTimerCommand(freshTimer(1000),command('start'),1000).document)
  sessionStorage.setItem('dcc.focus-timer.tab.v1',raw)
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_n:string,_o:unknown,cb:(lock:object)=>Promise<void>)=>{await cb({});released()}}})
  try{
    render(<AuthGate><BrowserTimerProvider><Clock/></BrowserTimerProvider></AuthGate>)
    await act(async()=>{await vi.advanceTimersByTimeAsync(0)})
    expect(screen.getByLabelText('Actual timer')).toHaveTextContent('running:1500000')
    await act(async()=>{window.dispatchEvent(new Event('dcc-auth-required'));await Promise.resolve()})
    expect(screen.queryByLabelText('Actual timer')).toBeNull();expect(released).toHaveBeenCalledOnce()
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(sessionStorage.getItem('dcc.focus-timer.tab.v1')).toBe(raw)
  }finally{fetch.mockRestore();Object.defineProperty(navigator,'locks',{configurable:true,value:locks});window.history.replaceState({},'',route)}
})
