import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

window.addEventListener('error', (e) => {
  console.error('APP ERROR:', e.error?.message, '\n', e.error?.stack)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED:', e.reason?.message, '\n', e.reason?.stack)
})
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
