import { ConsoleApp } from '@maxim/kit'
import { reachyProfile } from './profile'

/** The robot page: the kit's shared console shell, configured by the Reachy profile. */
export default function App() {
  return <ConsoleApp profile={reachyProfile} />
}
