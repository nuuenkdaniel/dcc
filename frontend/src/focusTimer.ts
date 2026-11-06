export type MiniTimer = { id: string; name: string; duration: number; remainingMs: number }

export type FocusTimerState = {
  phase: 'focus' | 'break'
  sessionRemainingMs: number
  running: boolean
  miniTimers: MiniTimer[]
  activeMiniId: string | null
  sessionStarted?: boolean
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
        sessionStarted: false,
        miniTimers,
        sessionRemainingMs: (miniTimers[0]?.duration ?? 0) * 1000 || focusDurationMs,
      }
    }

    // Completed/zero-remaining following steps must not leave a running zero
    // clock at an exact boundary. Continue until a positive phase or stop.
    if (elapsed === 0 && next.sessionRemainingMs > 0) return next
  }

  return next
}

// Queue selection belongs to a fresh/reset session, never a running or paused
// session. Older documents infer started state conservatively from elapsed time.
export function startFocusTimer(state:FocusTimerState,focusDurationMs:number):FocusTimerState {
  if(state.running)return state
  const fresh=state.sessionStarted===false||state.sessionStarted===undefined&&state.phase==='focus'&&state.sessionRemainingMs===(state.miniTimers[0]?.remainingMs??focusDurationMs)
  const mini=fresh&&state.phase==='focus'&&!state.activeMiniId?state.miniTimers.find(m=>m.remainingMs>0):undefined
  return {...state,...(mini?{activeMiniId:mini.id,sessionRemainingMs:mini.remainingMs}:{}),running:true,sessionStarted:true}
}
export function canReorderFocusTimers(state:FocusTimerState){
  return state.phase==='focus'&&!state.running&&!state.activeMiniId&&state.sessionStarted!==true&&state.miniTimers.every(m=>m.remainingMs===m.duration*1000)
}
export function reorderFocusTimers(state:FocusTimerState,id:string,target:string):FocusTimerState {
  if(!canReorderFocusTimers(state)||id===target)return state
  const from=state.miniTimers.findIndex(m=>m.id===id),to=state.miniTimers.findIndex(m=>m.id===target)
  if(from<0||to<0)return state
  const miniTimers=[...state.miniTimers], [mini]=miniTimers.splice(from,1)
  miniTimers.splice(to,0,mini)
  return {...state,miniTimers,sessionRemainingMs:miniTimers[0].remainingMs}
}
