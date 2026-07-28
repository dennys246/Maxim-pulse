import { FacadeProvider, MockFacade } from '@maxim/kit'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

function renderApp() {
  return render(
    <FacadeProvider facade={new MockFacade()}>
      <App />
    </FacadeProvider>,
  )
}

test('console lands on the chat surface flanked by panel rails', () => {
  renderApp()
  expect(screen.getByLabelText('Say something to Maxim')).toBeInTheDocument()
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
  await userEvent.click(screen.getByLabelText('What Maxim remembers'))
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close ✦ What Maxim remembers panel'))
  expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument()
})

test('gear drawer holds setup and dev tools; 🎲 opens the launcher', async () => {
  renderApp()
  await userEvent.click(screen.getByLabelText('Settings'))
  expect(screen.getByText('Where should Maxim think?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close Settings'))
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(screen.getByRole('dialog', { name: 'Start an Adventure' })).toBeInTheDocument()
})
