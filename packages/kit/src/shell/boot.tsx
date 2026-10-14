import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthSessionProvider } from '../components/AuthGate'
import { ThemeProvider } from '../design/ThemeProvider'
import { AuthSession } from '../facade/auth'
import { FacadeProvider } from '../facade/context'
import { HttpFacade } from '../facade/http'
import { ConsoleApp } from './ConsoleApp'
import type { DeviceProfile } from './profile'

/**
 * bootConsole — everything a device's `main.tsx` used to repeat.
 *
 * The console token (contract 0.4.0): `maxim serve` prints a `/#token=<t>` URL;
 * the fragment is consumed HERE — stored for this device, stripped from the
 * address bar — before anything talks to the backend. One session object feeds
 * both the facade (Bearer header + ws subprotocol) and the AuthGate.
 *
 * Same-origin: the backend hosts the bundle (`maxim serve`, or a device's own
 * bootstrap); dev rides the Vite proxy.
 */
export function bootConsole(
  profile: DeviceProfile,
  root: HTMLElement | null = document.getElementById('root'),
) {
  if (root === null) throw new Error('bootConsole: no #root element to mount into')
  const auth = new AuthSession()
  auth.bootstrapFromLocation()
  const facade = new HttpFacade({
    auth,
    subscribe: profile.subscribe,
    liveHealth: profile.health === true,
  })
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <AuthSessionProvider session={auth}>
          <FacadeProvider facade={facade}>
            <ConsoleApp profile={profile} />
          </FacadeProvider>
        </AuthSessionProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}
