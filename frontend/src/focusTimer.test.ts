import { expect, it } from 'vitest'
import { advanceFocusTimer, type FocusTimerState } from './focusTimer'

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
