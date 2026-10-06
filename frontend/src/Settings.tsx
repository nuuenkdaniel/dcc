import {EmailSettings} from './EmailSummary'
import {LogoutAction} from './LogoutAction'
import type { usePreferences } from './usePreferences'

export function Settings({ preferences, update, error }: ReturnType<typeof usePreferences>) {
  return <section className="content settings-view"><header className="topbar"><div><p className="eyebrow">Make it yours</p><h1>Settings</h1><p className="subtitle">Preferences for this browser. No account required.</p></div></header>
    <section className="card settings-section"><h2>Profile</h2><label>Display name<input maxLength={80} value={preferences.name} placeholder="What should we call you?" onChange={event => update({ ...preferences, name: event.target.value })} /></label><p className="local-note">A local display name, not an account username.</p></section>
    <section className="card settings-section"><h2>Appearance</h2><p className="local-note">Muted dark palettes</p><div className="theme-options">{['violet', 'blue', 'sage'].map(theme => <button key={theme} aria-pressed={preferences.theme === theme} onClick={() => update({ ...preferences, theme })}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div><label className="motion-option"><input type="checkbox" checked={preferences.reducedMotion} onChange={event => update({ ...preferences, reducedMotion: event.target.checked })} />Reduce motion</label></section>
    <section className="card settings-section"><h2>Account & security</h2><p>Your dcc login is configured in the backend env file. Signing out keeps browser tasks, caches, and drafts intact.</p><LogoutAction className="settings-logout"/><br /><button disabled>Change username</button> <button disabled>Change password</button><p className="local-note">Passwords are sent only when signing in; no passwords are persisted in browser storage.</p></section>
    <p className="local-note" role="status">{error ? 'Preferences could not be saved. Changes apply for this session only.' : 'Preferences are saved automatically in this browser.'}</p>
    <EmailSettings/>
  </section>
}
