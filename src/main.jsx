import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DefeatAlertApp from './defeat-alert/DefeatAlertApp.jsx'

const isDefeatAlertApp = import.meta.env.VITE_APP_MODE === 'defeat' || window.location.pathname.startsWith('/defeat-alert')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isDefeatAlertApp ? <DefeatAlertApp /> : <App />}
  </StrictMode>,
)
