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
  void navigator.serviceWorker.register('/workspace-offline.js')
    .then(() => navigator.serviceWorker.ready)
    .then(registration => registration.active?.postMessage('retain-workspace-shell'))
    .catch(() => {})
}
