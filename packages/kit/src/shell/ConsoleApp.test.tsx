import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CORE_PANELS } from '../components/panels'
import { FacadeProvider } from '../facade/context'
import { MockFacade } from '../facade/mock'
import { ConsoleApp } from './ConsoleApp'
import type { DeviceProfile } from './profile'

function profile(over: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    id: 'test-device',
    panels: CORE_PANELS,
    rails: { left: true, right: true },
    actions: [
      { id: 'logs', label: 'Logs', content: '≡', opens: 'logs' },
      { id: 'memory', label: 'What Maxim remembers', content: '✦', togglesPanel: 'memory' },
    ],
    links: [{ label: 'Docs', href: 'https://docs.pymaxim.bio/', content: '?' }],
    drawers: [
      {
        id: 'logs',
        title: 'Logs',
        requires: ['runs'],
        missing: 'Run history needs a backend speaking console contract 0.6.0.',
        render: () => <p>the run list</p>,
      },
    ],
    ...over,
  }
}

function renderApp(p: DeviceProfile, facade = new MockFacade()) {
  return render(
    <FacadeProvider facade={facade}>
      <ConsoleApp profile={p} />
    </FacadeProvider>,
  )
}

test('a profile drives the top bar: actions in order, then links', async () => {
  renderApp(profile())
  expect(await screen.findByLabelText('Logs')).toBeInTheDocument()
  expect(screen.getByLabelText('What Maxim remembers')).toBeInTheDocument()
  expect(screen.getByLabelText('Docs')).toHaveAttribute('href', 'https://docs.pymaxim.bio/')
})

test('a surface whose seam the backend lacks EXPLAINS itself instead of rendering blank', async () => {
  // MockFacade's identity declares talk/adventure/sim, not `runs` — an older backend.
  renderApp(profile())
  await userEvent.click(await screen.findByLabelText('Logs'))
  expect(screen.getByRole('status')).toHaveTextContent(
    'needs a backend speaking console contract 0.6.0',
  )
  expect(screen.queryByText('the run list')).not.toBeInTheDocument()
})

test('the same surface renders once the backend declares the seam live', async () => {
  const facade = new MockFacade()
  facade.backend = {
    ...facade.backend,
    seams: [...(facade.backend.seams ?? []), { name: 'runs', live: true, detail: null }],
  }
  renderApp(profile(), facade)
  await userEvent.click(await screen.findByLabelText('Logs'))
  expect(await screen.findByText('the run list')).toBeInTheDocument()
})

test('a seam declared but NOT live is treated as missing (strict)', async () => {
  const facade = new MockFacade()
  facade.backend = {
    ...facade.backend,
    seams: [{ name: 'runs', live: false, detail: 'closed in sandbox mode' }],
  }
  renderApp(profile(), facade)
  await userEvent.click(await screen.findByLabelText('Logs'))
  expect(screen.queryByText('the run list')).not.toBeInTheDocument()
})

test('rails follow the profile', async () => {
  renderApp(profile({ rails: { left: false, right: true } }))
  expect(await screen.findByLabelText('right panel rail')).toBeInTheDocument()
  expect(screen.queryByLabelText('left panel rail')).not.toBeInTheDocument()
})
