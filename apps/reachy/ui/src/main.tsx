import { FacadeProvider, HttpFacade, ThemeProvider } from '@maxim/kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Same-origin: the ReachyMiniApp bootstrap serves this bundle next to the facade.
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
