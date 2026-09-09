import { CONTRACT_VERSION, FacadeProvider, MockFacade } from '@maxim/kit'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

function renderApp(facade = new MockFacade()) {
  return render(
    <FacadeProvider facade={facade}>
      <App />
    </FacadeProvider>,
  )
}

test('the Demo target guard: over a MockFacade the console NEVER renders a login screen', async () => {
  renderApp()
  expect(await screen.findByLabelText('Say something to Maxim')).toBeInTheDocument()
  expect(screen.queryByText('Sign in to Maxim Console')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Console token')).not.toBeInTheDocument()
})

test('against a bearer backend with no token the console is the paste screen and nothing else', async () => {
  const facade = new MockFacade()
  facade.greeting = { contract_version: CONTRACT_VERSION, auth: 'bearer', pairing: 'none' }
  renderApp(facade)
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(screen.queryByLabelText('Say something to Maxim')).not.toBeInTheDocument()
})

test('console lands on the chat surface flanked by panel rails', async () => {
  renderApp()
  expect(await screen.findByLabelText('Say something to Maxim')).toBeInTheDocument()
  expect(screen.getByLabelText('left panel rail')).toBeInTheDocument()
  expect(screen.getByLabelText('right panel rail')).toBeInTheDocument()
  expect(screen.getByLabelText('Open Bio activity')).toBeInTheDocument()
  expect(screen.getByLabelText('Open Thinking')).toBeInTheDocument()
  expect(screen.getByLabelText(/docs.pymaxim.bio/)).toHaveAttribute(
    'href',
    'https://docs.pymaxim.bio/getting-started/',
  )
  expect(screen.getByLabelText('GitHub')).toHaveAttribute(
    'href',
    'https://github.com/dennys246/Maxim',
  )
})

test('✦ opens the memory panel in the right rail', async () => {
  renderApp()
  await userEvent.click(await screen.findByLabelText('What Maxim remembers'))
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close ✦ What Maxim remembers panel'))
  expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument()
})

test('gear drawer holds setup and dev tools; 🎲 opens the launcher', async () => {
  renderApp()
  await userEvent.click(await screen.findByLabelText('Settings'))
  expect(screen.getByText('Where should Maxim think?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close Settings'))
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(screen.getByRole('dialog', { name: 'Start an Adventure' })).toBeInTheDocument()
})
