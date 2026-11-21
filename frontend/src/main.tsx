import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Bump the URL when the worker changes so a cached script cannot delay rollout.
  void navigator.serviceWorker.register('/workspace-offline.js?v=2')
    .then(() => navigator.serviceWorker.ready)
    .then(registration => registration.active?.postMessage('retain-workspace-shell'))
    .catch(() => {})
}
