import { StrictMode } from 'react'
import type {ReactNode} from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./AuthGate',()=>({AuthGate:({children}:{children:ReactNode})=>children}))

afterEach(() => vi.useRealTimers())

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
beforeEach(() => {
  window.localStorage.clear()
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

it('creates, expands, completes, and restores a local task', () => {
  const { unmount } = render(<App />)
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Read chapter notes' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  expect(screen.getByText('Read chapter notes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Read chapter notes' }))
  expect(screen.getByPlaceholderText('Add context or notes')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Read chapter notes' }))
  expect(screen.getByText('Completed', { selector: '.task-state' })).toBeInTheDocument()

  unmount()
  render(<App />)
  expect(screen.getByText('Read chapter notes')).toBeInTheDocument()
})

it('shows a quiet empty state without seeded tasks', () => {
  render(<App />)
  expect(screen.getByText('Loading tasks…')).toBeInTheDocument()
  expect(screen.getByText(/saved only in this browser/i)).toBeInTheDocument()
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

it('starts immediately and waits a full second before the first displayed decrement', () => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/pomodoro')
  render(<StrictMode><App /></StrictMode>)

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
