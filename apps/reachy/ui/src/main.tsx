import { FacadeProvider, HttpFacade, ThemeProvider } from '@maxim/kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Same-origin: the ReachyMiniApp bootstrap serves this bundle next to the facade.
//
// tier: 'clean' — this shell renders conversation and memory, no bio-tier
// surface, so the Pi never ships the idle loop's ~2/sec hippocampus+scn
// chatter over the socket (~87% of the stream). Meta-kinds (run lifecycle,
// identity, dropped) bypass the filter server-side, so TurnStatus and the
// BackendChip keep working.
const facade = new HttpFacade({ subscribe: { tier: 'clean' } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <FacadeProvider facade={facade}>
        <App />
      </FacadeProvider>
    </ThemeProvider>
  </StrictMode>,
)
