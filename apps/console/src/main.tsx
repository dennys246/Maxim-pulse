import { FacadeProvider, HttpFacade, ThemeProvider } from '@maxim/kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Same-origin: maxim serve hosts the bundle; dev rides the Vite proxy.
const facade = new HttpFacade()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <FacadeProvider facade={facade}>
        <App />
      </FacadeProvider>
    </ThemeProvider>
  </StrictMode>,
)
