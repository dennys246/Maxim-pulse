import {
  AuthSession,
  AuthSessionProvider,
  FacadeProvider,
  HttpFacade,
  ThemeProvider,
} from '@maxim/kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Same kit, same token flow as the Console (contract 0.4.0): the bootstrap's
// `build_app` demands the console token; a `/#token=<t>` link signs this
// device in once, the paste screen covers the rest.
const auth = new AuthSession()
auth.bootstrapFromLocation()

// Same-origin: the ReachyMiniApp bootstrap serves this bundle next to the facade.
//
// tier: 'clean' — this shell renders conversation and memory, no bio-tier
// surface, so the Pi never ships the idle loop's ~2/sec hippocampus+scn
// chatter over the socket (~87% of the stream). Meta-kinds (run lifecycle,
// identity, dropped) bypass the filter server-side, so TurnStatus and the
// BackendChip keep working.
const facade = new HttpFacade({ auth, subscribe: { tier: 'clean' } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthSessionProvider session={auth}>
        <FacadeProvider facade={facade}>
          <App />
        </FacadeProvider>
      </AuthSessionProvider>
    </ThemeProvider>
  </StrictMode>,
)
