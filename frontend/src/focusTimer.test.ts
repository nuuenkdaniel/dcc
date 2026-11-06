import { expect, it } from 'vitest'
import { advanceFocusTimer, startFocusTimer, reorderFocusTimers, type FocusTimerState } from './focusTimer'

const runningSequence = (): FocusTimerState => ({
  phase: 'focus',
  sessionRemainingMs: 1000,
  running: true,
  activeMiniId: 'first',
  miniTimers: [
    { id: 'first', name: 'First', duration: 1, remainingMs: 1000 },
    { id: 'second', name: 'Second', duration: 1, remainingMs: 1000 },
  ],
})

it('advances from controlled elapsed time without rounding away fractions', () => {
  const first = advanceFocusTimer(runningSequence(), 400, 2000, 500)
  expect(first.sessionRemainingMs).toBe(600)
  expect(first.miniTimers[0].remainingMs).toBe(600)

  const resumed = advanceFocusTimer({ ...first, running: true }, 600, 2000, 500)
  expect(resumed.activeMiniId).toBe('second')
  expect(resumed.sessionRemainingMs).toBe(1000)
})

it('catches up across ordered focus timers and the break exactly once', () => {
  const duringBreak = advanceFocusTimer(runningSequence(), 2250, 2000, 500)
  expect(duringBreak.phase).toBe('break')
  expect(duringBreak.sessionRemainingMs).toBe(250)
  expect(duringBreak.miniTimers.map(timer => timer.remainingMs)).toEqual([0, 0])

  const stopped = advanceFocusTimer(duringBreak, 250, 2000, 500)
  expect(stopped).toMatchObject({ phase: 'focus', running: false, activeMiniId: null, sessionRemainingMs: 1000 })
  expect(stopped.miniTimers.map(timer => timer.remainingMs)).toEqual([1000, 1000])
})

it('does not advance a paused timer', () => {
  const paused = { ...runningSequence(), running: false }
  expect(advanceFocusTimer(paused, 5000, 2000, 500)).toBe(paused)
})
it('rechecks a stale reorder against current running state without resetting elapsed progress',()=>{
  const state:FocusTimerState={phase:'focus',running:true,activeMiniId:null,sessionRemainingMs:1435000,sessionStarted:true,miniTimers:[{id:'a',name:'A',duration:60,remainingMs:60000},{id:'b',name:'B',duration:120,remainingMs:120000}]}
  expect(reorderFocusTimers(state,'b','a')).toBe(state)
  expect(startFocusTimer(state,1500000)).toBe(state)
  const paused={...state,running:false}
  expect(startFocusTimer(paused,1500000)).toEqual({...state,running:true})
})
it('skips an already-completed following step at an exact boundary instead of persisting a running zero clock',()=>{
  const source=runningSequence()
  source.miniTimers[1].remainingMs=0
  const next=advanceFocusTimer(source,1000,2000,500)
  expect(next).toMatchObject({phase:'break',running:true,activeMiniId:null,sessionRemainingMs:500})
  expect(next.miniTimers.map(t=>t.remainingMs)).toEqual([0,0])
})
