export type MiniTimer = { id: string; name: string; duration: number; remainingMs: number }

export type FocusTimerState = {
  phase: 'focus' | 'break'
  sessionRemainingMs: number
  running: boolean
  miniTimers: MiniTimer[]
  activeMiniId: string | null
}

export function advanceFocusTimer(
  state: FocusTimerState,
  elapsedMs: number,
  focusDurationMs: number,
  breakDurationMs: number,
): FocusTimerState {
  if (!state.running || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return state

  let next = state
  let elapsed = elapsedMs

  while (next.running) {
    if (elapsed < next.sessionRemainingMs) {
      const sessionRemainingMs = next.sessionRemainingMs - elapsed
      const miniTimers = next.phase === 'focus' && next.activeMiniId
        ? next.miniTimers.map(timer => timer.id === next.activeMiniId ? { ...timer, remainingMs: sessionRemainingMs } : timer)
        : next.miniTimers
      return { ...next, sessionRemainingMs, miniTimers }
    }

    elapsed -= next.sessionRemainingMs

    if (next.phase === 'focus') {
      const completedIndex = next.activeMiniId
        ? next.miniTimers.findIndex(timer => timer.id === next.activeMiniId)
        : -1
      const miniTimers = completedIndex >= 0
        ? next.miniTimers.map((timer, index) => index === completedIndex ? { ...timer, remainingMs: 0 } : timer)
        : next.miniTimers
      const followingTimer = completedIndex >= 0 ? miniTimers[completedIndex + 1] : undefined

      next = followingTimer
        ? { ...next, miniTimers, activeMiniId: followingTimer.id, sessionRemainingMs: followingTimer.remainingMs }
        : { ...next, phase: 'break', miniTimers, activeMiniId: null, sessionRemainingMs: breakDurationMs }
    } else {
      const miniTimers = next.miniTimers.map(timer => ({ ...timer, remainingMs: timer.duration * 1000 }))
      return {
        ...next,
        phase: 'focus',
        running: false,
        activeMiniId: null,
        miniTimers,
        sessionRemainingMs: (miniTimers[0]?.duration ?? 0) * 1000 || focusDurationMs,
      }
    }

    if (elapsed === 0) return next
  }

  return next
}
