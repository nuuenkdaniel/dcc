import { useEffect, useState } from 'react'

type Preferences = { name: string; theme: string; reducedMotion: boolean }
const defaults: Preferences = { name: '', theme: 'violet', reducedMotion: false }
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('daymark.preferences.v1') ?? '{}')
      return { name: typeof saved?.name === 'string' ? saved.name : '', theme: ['violet', 'blue', 'sage'].includes(saved?.theme) ? saved.theme : 'violet', reducedMotion: saved?.reducedMotion === true }
    } catch { return defaults }
  })
  const [error, setError] = useState(false)
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.reducedMotion = String(preferences.reducedMotion)
  }, [preferences])
  const update = (next: Preferences) => {
    setPreferences(next)
    try { localStorage.setItem('daymark.preferences.v1', JSON.stringify(next)); setError(false) } catch { setError(true) }
  }
  return { preferences, update, error }
}
