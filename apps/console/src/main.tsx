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

// The console token (contract 0.4.0): `maxim serve` prints a `/#token=<t>`
// URL; the fragment is consumed here — stored for this device, stripped from
// the address bar — before anything talks to the backend. One session object
// feeds both the facade (Bearer header + ws subprotocol) and the AuthGate.
const auth = new AuthSession()
auth.bootstrapFromLocation()

// Same-origin: maxim serve hosts the bundle; dev rides the Vite proxy.
const facade = new HttpFacade({ auth })

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
