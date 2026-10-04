import {ManualTaskSync} from './ManualTaskSync'
import {Prices} from './Prices'
import {useMail} from './useMail'
import {EmailSummary} from './EmailSummary'
import {usePlanner,studyCardCount,visiblePlanGroups} from './usePlanner'
import {Projects,ActionCard,StudyCard,PlanControls} from './Projects'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { Login } from './Login'
import { Schedule } from './Schedule'
import { Inbox } from './Inbox'
import { Settings } from './Settings'
import { usePreferences } from './usePreferences'

type Task = { id: string; title: string; date: string; notes: string; completed: boolean; sample?: boolean; important?: boolean }
type PreviewView = 'home' | 'inbox' | 'pomodoro' | 'login' | 'settings' | 'projects' | 'prices'
type MiniTimer = { id: string; name: string; duration: number; remaining: number }

const VIEW_PATHS: Record<PreviewView, string> = {
  home: '/',
  projects: '/projects',
  prices: '/prices',
  inbox: '/inbox',
  pomodoro: '/pomodoro',
  login: '/login',
  settings: '/settings',
}
const viewFromPath = (path: string): PreviewView => {
  const match = (Object.entries(VIEW_PATHS) as [PreviewView, string][]).find(([, route]) => route === path)
  return match?.[0] ?? 'home'
}

const STORAGE_KEY = 'productivity-app.tasks.v1'
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = () => localDate(new Date())
const formatMonth = (date: Date) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date)
const formatDay = (date: string) => new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

const readTasks = (): { tasks: Task[]; error: boolean } => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed) || !parsed.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const task = item as Partial<Task>
      return typeof task.id === 'string' && typeof task.title === 'string' && typeof task.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.date) && typeof task.notes === 'string' && typeof task.completed === 'boolean'
    })) return { tasks: [], error: true }
    return { tasks: parsed, error: false }
  } catch {
    return { tasks: [], error: true }
  }
}

const writeTasks = (tasks: Task[]) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); return true } catch { return false }
}

function calendarDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (start.getDay() + 6) % 7
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
    return { date: localDate(day), day: day.getDate(), current: day.getMonth() === month.getMonth() }
  })
}

function sampleTasks(date: string): Task[] {
  return [
    { id: 'sample-calendar', title: 'Review calendar integration', date, notes: 'Confirm the calendar states and event layout.', completed: false, sample: true },
    { id: 'sample-study', title: 'Study session · operating systems', date, notes: '45 minutes · review scheduling notes and practice questions.', completed: true, sample: true },
  ]
}


function DevToolbar({ view, sampleData, onViewChange, onSampleDataChange }: {
  view: PreviewView
  sampleData: boolean
  onViewChange: (view: PreviewView) => void
  onSampleDataChange: (enabled: boolean) => void
}) {
  return (
    <div className="dev-toolbar" role="toolbar" aria-label="Development tools">
      <div className="dev-toolbar-inner">
        <strong><span aria-hidden="true">◇</span> Development</strong>
        <div className="dev-view-switcher" aria-label="Preview view">
          {(['home', 'inbox', 'pomodoro', 'login'] as const).map((option) => (
            <button key={option} type="button" aria-label={`${option[0].toUpperCase()}${option.slice(1)} view`} aria-pressed={view === option} onClick={() => onViewChange(option)}>
              {option[0].toUpperCase()}{option.slice(1)}
            </button>
          ))}
        </div>
        <label className="dev-toggle"><input type="checkbox" checked={sampleData} onChange={(event) => onSampleDataChange(event.target.checked)} /><span>Sample data</span></label>
        <span className="dev-note">Local preview controls</span>
      </div>
    </div>
  )
}

function NumberStepper({ id, label, actionName, value, min, max, onChange }: {
  id: string
  label: string
  actionName: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  const commit = (candidate: number) => {
    const next = Math.min(max, Math.max(min, candidate || min))
    setDraft(String(next))
    onChange(next)
  }
  const adjustedValue = () => {
    const parsed = Number(draft)
    return draft !== '' && Number.isFinite(parsed) ? parsed : value
  }

  return (
    <div className="number-stepper">
      <label htmlFor={id}>{label}</label>
      <div className="stepper-control">
        <button type="button" aria-label={`Decrease ${actionName}`} disabled={value <= min} onClick={() => commit(adjustedValue() - 1)}>−</button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value
            setDraft(nextDraft)
            const parsed = Number(nextDraft)
            if (nextDraft !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed)
          }}
          onBlur={() => commit(Number(draft))}
        />
        <button type="button" aria-label={`Increase ${actionName}`} disabled={value >= max} onClick={() => commit(adjustedValue() + 1)}>+</button>
      </div>
    </div>
  )
}

function PomodoroView() {
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [phase, setPhase] = useState<'focus' | 'break'>('focus')
  const [sessionRemaining, setSessionRemaining] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [miniTimers, setMiniTimers] = useState<MiniTimer[]>([])
  const [activeMiniId, setActiveMiniId] = useState<string | null>(null)
  const [miniName, setMiniName] = useState('')
  const [miniMinutes, setMiniMinutes] = useState(5)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<{ left: number; top: number; width: number; height: number; offsetX: number; offsetY: number; target: string | null } | null>(null)
  const clearDrag = () => { setDragging(null); setDragPreview(null) }
  const [orderNotice, setOrderNotice] = useState('')
  const canReorder = phase === 'focus' && !activeMiniId && miniTimers.every(timer => timer.remaining === timer.duration)
  const moveTimer = (id: string, target: string) => {
    if (!canReorder || id === target) return
    const from = miniTimers.findIndex(timer => timer.id === id)
    const to = miniTimers.findIndex(timer => timer.id === target)
    if (from < 0 || to < 0) return
    const next = [...miniTimers]
    const [timer] = next.splice(from, 1)
    next.splice(to, 0, timer)
    setMiniTimers(next)
    setSessionRemaining(next[0].duration)
    setOrderNotice(`${timer.name} moved to position ${to + 1}`)
  }

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => {
      setSessionRemaining((remaining) => {
        if (remaining > 1) {
          if (phase === 'focus' && activeMiniId) {
            setMiniTimers((timers) => timers.map((timer) => timer.id === activeMiniId ? { ...timer, remaining: Math.max(0, timer.remaining - 1) } : timer))
          }
          return remaining - 1
        }

        if (phase === 'focus') {
          if (activeMiniId) {
            const currentIndex = miniTimers.findIndex((timer) => timer.id === activeMiniId)
            const nextTimer = miniTimers[currentIndex + 1]
            setMiniTimers((timers) => timers.map((timer) => timer.id === activeMiniId ? { ...timer, remaining: 0 } : timer))
            if (nextTimer) {
              setActiveMiniId(nextTimer.id)
              return nextTimer.remaining
            }
          }
          setPhase('break')
          setActiveMiniId(null)
          return breakMinutes * 60
        }

        setPhase('focus')
        setRunning(false)
        setActiveMiniId(null)
        setMiniTimers((timers) => timers.map((timer) => ({ ...timer, remaining: timer.duration })))
        return miniTimers[0]?.duration ?? focusMinutes * 60
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [running, activeMiniId, phase, breakMinutes, focusMinutes, miniTimers])

  const addMiniTimer = () => {
    const name = miniName.trim()
    const minutes = Math.min(120, Math.max(1, miniMinutes))
    if (!name) return
    const timer = { id: `${Date.now()}-${Math.random()}`, name, duration: minutes * 60, remaining: minutes * 60 }
    if (miniTimers.length === 0 && phase === 'focus' && !running) setSessionRemaining(timer.duration)
    setMiniTimers((timers) => [...timers, timer])
    setMiniName('')
  }

  const setDuration = (kind: 'focus' | 'break', value: number) => {
    const maximum = kind === 'focus' ? 180 : 60
    const minutes = Math.min(maximum, Math.max(1, value || 1))
    if (kind === 'focus') {
      setFocusMinutes(minutes)
      if (phase === 'focus' && !running && miniTimers.length === 0) setSessionRemaining(minutes * 60)
    } else {
      setBreakMinutes(minutes)
      if (phase === 'break' && !running) setSessionRemaining(minutes * 60)
    }
  }

  const resetSession = () => {
    setRunning(false)
    setPhase('focus')
    setActiveMiniId(null)
    setSessionRemaining(miniTimers[0]?.duration ?? focusMinutes * 60)
    setMiniTimers((timers) => timers.map((timer) => ({ ...timer, remaining: timer.duration })))
  }

  const toggleSession = () => {
    if (running) {
      setRunning(false)
      return
    }
    if (phase === 'focus' && miniTimers.length > 0 && !activeMiniId) {
      const nextTimer = miniTimers.find((timer) => timer.remaining > 0) ?? miniTimers[0]
      setActiveMiniId(nextTimer.id)
      setSessionRemaining(nextTimer.remaining || nextTimer.duration)
    }
    setRunning(true)
  }

  const phaseLabel = phase === 'focus' ? 'Focus' : 'Break'
  const activeMini = miniTimers.find((timer) => timer.id === activeMiniId)
  const currentDuration = phase === 'break' ? breakMinutes * 60 : activeMini?.duration ?? miniTimers[0]?.duration ?? focusMinutes * 60

  return (
    <section className="content focus-view" id="pomodoro">
      <header className="topbar focus-header"><div><p className="eyebrow">Deep work</p><h1>Focus session</h1></div></header>
      <section className={`card focus-panel ${phase === 'break' ? 'break-phase' : ''}`} aria-labelledby="focus-clock-heading">
        <div className="focus-panel-top">
          <div><p className="eyebrow">Current phase</p><h2 id="focus-clock-heading">{phaseLabel}</h2></div>
          <button className="settings-button" type="button" aria-label="Timer settings" onClick={() => { setRunning(false); setSettingsOpen(true) }}>⚙</button>
        </div>
        <output className="focus-time" data-testid="session-time" aria-live="off">{formatTime(sessionRemaining)}</output>
        <p className="focus-status">{running ? activeMini ? activeMini.name : phase === 'break' ? 'Take a breath' : 'Stay with the task' : sessionRemaining === 0 ? `${phaseLabel} complete` : `Ready for ${phase === 'focus' ? 'focus' : 'a break'}`}</p>
        <div className="focus-actions"><button className="primary-action" type="button" disabled={sessionRemaining === 0} onClick={toggleSession}>{running ? 'Pause session' : sessionRemaining < currentDuration ? 'Resume session' : 'Start session'}</button><button className="secondary-action" type="button" aria-label="Reset session" onClick={resetSession}>Reset</button></div>

        {miniTimers.length > 0 && <div className="focus-steps" aria-label="Mini timers"><div className="focus-steps-heading"><span>Focus sequence</span><small>{miniTimers.filter((timer) => timer.remaining === 0).length}/{miniTimers.length} complete</small></div>{miniTimers.map((timer) => {
          const active = timer.id === activeMiniId
          return <article className={`mini-timer ${active ? 'active' : ''}`} key={timer.id}><div><strong>{timer.name}</strong><span>{active ? 'Active focus' : timer.remaining === 0 ? 'Complete' : 'Ready'}</span></div><output data-testid="mini-time">{formatTime(timer.remaining)}</output></article>
        })}</div>}
      </section>

      {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><section className="timer-dialog" role="dialog" aria-modal="true" aria-labelledby="timer-setup-heading">
        <div className="dialog-heading"><div><p className="eyebrow">Pomodoro</p><h2 id="timer-setup-heading">Timer setup</h2></div><button type="button" aria-label="Close timer settings" onClick={() => setSettingsOpen(false)}>×</button></div>
        <div className="duration-settings"><NumberStepper id="focus-minutes" label="Focus timer (minutes)" actionName="focus timer" value={focusMinutes} min={1} max={180} onChange={(value) => setDuration('focus', value)} /><NumberStepper id="break-minutes" label="Break timer (minutes)" actionName="break timer" value={breakMinutes} min={1} max={60} onChange={(value) => setDuration('break', value)} /></div>
        <div className="dialog-divider" />
        <div className="dialog-section-heading"><div><p className="eyebrow">Optional</p><h3>Mini timers</h3></div><span className="task-count">{miniTimers.length}</span></div>
        <form className="mini-form" onSubmit={(event) => { event.preventDefault(); addMiniTimer() }}><label htmlFor="mini-name">Mini timer name</label><input id="mini-name" value={miniName} onChange={(event) => setMiniName(event.target.value)} placeholder="e.g. Outline the chapter" /><div className="mini-duration-row"><NumberStepper id="mini-minutes" label="Mini timer minutes" actionName="mini timer" value={miniMinutes} min={1} max={120} onChange={setMiniMinutes} /><button type="submit">Add mini timer</button></div></form>
        {miniTimers.length > 0 && <><p className="local-note">{canReorder ? 'Drag the grip to reorder, or focus it and use ↑ / ↓.' : 'Reset the session to change its order.'}</p><div className="settings-mini-list">{miniTimers.map((timer, index) => <div key={timer.id} data-timer-id={timer.id} className={dragging === timer.id ? 'timer-dragging' : dragPreview?.target === timer.id ? (index < miniTimers.findIndex(item => item.id === dragging) ? 'timer-drop-before' : 'timer-drop-after') : ''}>
          <button type="button" className="timer-grip" aria-label={`Reorder ${timer.name}`} title="Drag to reorder · ↑ / ↓" disabled={!canReorder}
            onPointerDown={event => { if (event.button !== 0) return; const rect = event.currentTarget.closest('[data-timer-id]')!.getBoundingClientRect(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(timer.id); setDragPreview({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, target: null }) }}
            onPointerMove={event => { if (!dragPreview || dragging !== timer.id) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timer-id]')?.dataset.timerId ?? null; setDragPreview({ ...dragPreview, left: event.clientX - dragPreview.offsetX, top: event.clientY - dragPreview.offsetY, target }) }}
            onPointerUp={event => { const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timer-id]')?.dataset.timerId; if (dragging && target) moveTimer(timer.id, target); clearDrag() }}
            onPointerCancel={clearDrag}
            onLostPointerCapture={clearDrag}
            onKeyDown={event => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); const target = miniTimers[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) moveTimer(timer.id, target.id) }}><svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true" fill="currentColor">{[5, 10, 15].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}</svg></button>
          <span>{timer.name}</span><small>{formatTime(timer.duration)}</small><button type="button" aria-label={`Remove ${timer.name}`} onClick={() => { setMiniTimers((timers) => timers.filter((item) => item.id !== timer.id)); if (activeMiniId === timer.id) setActiveMiniId(null) }}>Remove</button></div>)}</div><p className="sr-only" role="status">{orderNotice}</p></>}
        {dragging && dragPreview && <div aria-hidden="true" data-testid="timer-drag-preview" className="timer-drag-preview" style={{ left: dragPreview.left, top: dragPreview.top, width: dragPreview.width, height: dragPreview.height }}><span>{miniTimers.find(timer => timer.id === dragging)?.name}</span><span>{formatTime(miniTimers.find(timer => timer.id === dragging)?.duration ?? 0)}</span></div>}
        <button className="dialog-done" type="button" onClick={() => setSettingsOpen(false)}>Done</button>
      </section></div>}
      <p className="focus-footnote">Timer state is local to this page for now.</p>
    </section>
  )
}

export default function App() {
  const mail=useMail()
  const preferencesState = usePreferences()
  const planner = usePlanner()
  const [initial] = useState(readTasks)
  const [tasks, setTasks] = useState<Task[]>(initial.tasks)
  const [readError, setReadError] = useState(initial.error)
  const [selectedDate, setSelectedDate] = useState(today)
  const [month, setMonth] = useState(() => { const date = new Date(); date.setDate(1); return date })
  const [title, setTitle] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const [previewView, setPreviewView] = useState<PreviewView>(() => viewFromPath(window.location.pathname))
  const [showSampleData, setShowSampleData] = useState(false)
  const [taskFilter, setTaskFilter] = useState('All')
  const [taskSearch, setTaskSearch] = useState('')
  const [deletedTask, setDeletedTask] = useState<Task | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const navigate = (view: PreviewView) => {
    const path = VIEW_PATHS[view]
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPreviewView(view)
  }

  useEffect(() => {
    const followHistory = () => setPreviewView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', followHistory)
    return () => window.removeEventListener('popstate', followHistory)
  }, [])

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      const result = readTasks()
      setReadError(result.error)
      if (!result.error) setTasks(result.tasks)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  const days = useMemo(() => calendarDays(month), [month])
  const displayedTasks = [...tasks, ...(showSampleData ? sampleTasks(selectedDate) : [])]
  const curatedCount = studyCardCount(planner.actions.filter(a=>a.date===selectedDate&&!a.dismissed))
  const selectedTasks = displayedTasks.filter((task) => task.date === selectedDate)
  const planGroups = visiblePlanGroups(planner,selectedDate,taskFilter,taskSearch)
  const visibleTasks = selectedTasks.filter(task => (!taskSearch || task.title.toLowerCase().includes(taskSearch.toLowerCase())) && (taskFilter === 'All' || (taskFilter === 'Open' && !task.completed) || (taskFilter === 'Completed' && task.completed) || (taskFilter === 'Important' && task.important))).sort((a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)))
  const updateTasks = (next: Task[]) => {
    if (readError) return
    setTasks(next)
    setStorageWarning(!writeTasks(next))
  }
  const addTask = () => {
    const clean = title.trim()
    if (!clean) return
    updateTasks([...tasks, { id: `${Date.now()}-${Math.random()}`, title: clean, date: selectedDate, notes: '', completed: false }])
    setTitle('')
  }
  const updateTask = (id: string, update: Partial<Task>) => updateTasks(tasks.map((task) => task.id === id ? { ...task, ...update } : task))

  const sidebar = (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <nav aria-label="Main navigation">
        <button type="button" aria-label="Home" title={sidebarCollapsed ? 'Home' : undefined} className={`nav-item ${previewView === 'home' ? 'active' : ''}`} onClick={() => navigate('home')}><span className="nav-icon">⌂</span><span className="nav-label">Home</span></button>
        <button type="button" aria-label="Inbox" title={sidebarCollapsed ? 'Inbox' : undefined} className={`nav-item ${previewView === 'inbox' ? 'active' : ''}`} onClick={() => navigate('inbox')}><span className="nav-icon">▣</span><span className="nav-label">Inbox</span></button>
        <button type="button" aria-label="Focus" title={sidebarCollapsed ? 'Focus' : undefined} className={`nav-item ${previewView === 'pomodoro' ? 'active' : ''}`} onClick={() => navigate('pomodoro')}><span className="nav-icon">◷</span><span className="nav-label">Focus</span></button>
        <button type="button" aria-label="Projects" title="Projects" className={`nav-item ${previewView === 'projects' ? 'active' : ''}`} onClick={()=>navigate('projects')}><span className="nav-icon">◫</span><span className="nav-label">Projects</span></button>
        <button type="button" aria-label="Price tracker" title="Price tracker" className={`nav-item ${previewView === 'prices' ? 'active' : ''}`} onClick={()=>navigate('prices')}><span className="nav-icon">◇</span><span className="nav-label">Prices</span></button>
      </nav>
      <div className="sidebar-utilities">
      <button type="button" className={`nav-item settings-nav ${previewView === 'settings' ? 'active' : ''}`} aria-label="Settings" title="Settings" onClick={() => navigate('settings')}><svg className="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-3Z"/><circle cx="12" cy="11" r="3"/></svg><span className="nav-label">Settings</span></button>
      <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>{sidebarCollapsed ? '›' : '‹'}</button>
      </div>
      <div className="sidebar-foot"><span className="status-dot" /> Local workspace<br /><small>Calendar status in Schedule</small></div>
    </aside>
  )

  return (
    <>
      {import.meta.env.DEV && <DevToolbar view={previewView} sampleData={showSampleData} onViewChange={navigate} onSampleDataChange={setShowSampleData} />}
      {previewView === 'login' ? (
        <Login onContinue={()=>navigate('home')} />
      ) : (
        <main className="app-shell">
          {sidebar}
          {previewView === 'prices' ? <Prices/> : previewView === 'projects' ? <Projects planner={planner}/> : previewView === 'settings' ? <Settings {...preferencesState} /> : previewView === 'inbox' ? (
            <Inbox mail={mail} />
          ) : previewView === 'pomodoro' ? (
            <PomodoroView />
          ) : (
            <section className="content" id="home">
              <header className="topbar"><div><p className="eyebrow">Personal workspace</p><h1>{preferencesState.preferences.name.trim() ? `${preferencesState.preferences.name.trim()}’s day` : 'Your day, at a glance.'}</h1></div><div className="date-chip">{formatDay(selectedDate)}</div></header>
              <div className="layout-grid">
                <section className="card calendar-card" aria-labelledby="calendar-heading">
                  <div className="section-heading"><div><p className="eyebrow">Planning</p><h2 id="calendar-heading">{formatMonth(month)}</h2></div><div className="calendar-actions"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">←</button><button className="today-button" onClick={() => { const now = new Date(); now.setDate(1); setMonth(now); setSelectedDate(today()) }}>Today</button><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">→</button></div></div>
                  <div className="weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
                  <div className="calendar-grid">{days.map(({ date, day, current }) => <button key={date} className={`calendar-day ${current ? '' : 'outside'} ${date === selectedDate ? 'selected' : ''}`} onClick={() => setSelectedDate(date)} aria-pressed={date === selectedDate} aria-current={date === today() ? 'date' : undefined} aria-label={formatDay(date)}><span>{day}</span></button>)}</div>
                  <Schedule planner={planner} date={selectedDate} />
                </section>
                <section className="card tasks-card" aria-labelledby="tasks-heading"><ManualTaskSync tasks={tasks} onApply={updateTasks}/>
                  <div className="section-heading"><div><p className="eyebrow">{formatDay(selectedDate)}</p><h2 id="tasks-heading">Daily plan</h2></div><span className="task-count">{selectedTasks.length+curatedCount}</span></div>
                  <form className="task-form" onSubmit={(event) => { event.preventDefault(); addTask() }}><label htmlFor="task-title">Task title</label><div className="form-row"><input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a daily action…" /><button type="submit" disabled={readError}>Add task</button></div></form>
                  <div className="task-filters"><div className="filter-tabs">{['All', 'Open', 'Important', 'Completed'].map(filter => <button key={filter} aria-pressed={taskFilter === filter} onClick={() => setTaskFilter(filter)}>{filter}</button>)}</div><input aria-label="Search tasks" placeholder="Search tasks" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} /></div>
                  <div className="task-list">{planGroups.map(group=>(group[0].preparationId||group[0].assignmentStep)?<StudyCard key={group[0].preparationId??group[0].projectId} actions={group} planner={planner}/>:<ActionCard key={group[0].id} action={group[0]} planner={planner}/>)}{visibleTasks.length === 0 && planGroups.length === 0 ? <div className="empty-state"><span className="empty-icon">○</span><p>{selectedTasks.length+curatedCount ? 'No matching tasks' : 'No tasks for this day'}</p><small>Start with one clear, achievable step.</small></div> : visibleTasks.map((task) => <article className={`task-card ${task.completed ? 'completed' : ''} ${task.sample ? 'sample' : ''}`} key={task.id}><div className="task-summary"><input type="checkbox" checked={task.completed} disabled={task.sample} onChange={() => updateTask(task.id, { completed: !task.completed })} aria-label={`Complete ${task.title}`} /><button className="task-title" aria-expanded={expanded === task.id} onClick={() => setExpanded(expanded === task.id ? null : task.id)} aria-label={`${expanded === task.id ? 'Collapse' : 'Expand'} ${task.title}`}>{task.title}</button><span className="task-state">{task.sample ? 'Sample' : task.completed ? 'Completed' : task.important ? 'Important' : 'Open'}</span></div>{expanded === task.id && <div className="task-details"><div className="task-edit-grid"><label>Name<input aria-label={`${task.title} name`} value={task.title} disabled={task.sample || readError} onChange={event => { if (event.target.value.trim()) updateTask(task.id, { title: event.target.value }) }} /></label></div><label className="priority-toggle"><input type="checkbox" checked={Boolean(task.important)} disabled={task.sample || readError} onChange={event => updateTask(task.id, { important: event.target.checked })} />Important</label><textarea aria-label={`${task.title} notes`} value={task.notes} disabled={task.sample} placeholder="Add context or notes" onChange={(event) => updateTask(task.id, { notes: event.target.value })} /><button className="delete-task" disabled={task.sample || readError} onClick={() => { setDeletedTask(task); updateTasks(tasks.filter(item => item.id !== task.id)) }}>Delete task</button></div>}</article>)}</div>
                  {deletedTask && <div className="undo-message" role="status">Task removed. <button onClick={() => { updateTasks([...tasks, deletedTask]); setDeletedTask(null) }}>Undo</button></div>}
                  {showSampleData && <p className="sample-note">Sample cards are temporary and cannot change your saved tasks.</p>}
                  {readError && <p role="alert" className="storage-warning">Stored tasks could not be read. Editing is paused to protect existing data; recover browser storage before continuing.</p>}
                  {storageWarning && <p className="storage-warning" role="alert">This browser could not save changes. Your tasks may be lost when you close this tab.</p>}
                  <PlanControls planner={planner}/>
                </section>
              </div>
              <EmailSummary mail={mail}/>
            </section>
          )}
        </main>
      )}
    </>
  )
}
