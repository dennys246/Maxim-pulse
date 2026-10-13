import { ConsoleApp } from '@maxim/kit'
import { consoleProfile } from './profile'

/** The Console: the kit's shared shell, configured by this device's profile. */
export default function App() {
  return <ConsoleApp profile={consoleProfile} />
}
