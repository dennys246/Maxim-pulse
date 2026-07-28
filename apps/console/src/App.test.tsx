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

test('console lands on the chat surface with the top-right cluster', () => {
  renderApp()
  expect(screen.getByLabelText('Say something to Maxim')).toBeInTheDocument()
  expect(screen.getByLabelText('Models')).toBeInTheDocument()
  expect(screen.getByLabelText('What Maxim remembers')).toBeInTheDocument()
  expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  expect(screen.getByLabelText(/docs.pymaxim.bio/)).toHaveAttribute(
    'href',
    'https://docs.pymaxim.bio/getting-started/',
  )
  expect(screen.getByLabelText('GitHub')).toHaveAttribute(
    'href',
    'https://github.com/dennys246/Maxim',
  )
})

test('gear drawer holds setup, campaign path, and dev tools; ✦ opens memory', async () => {
  renderApp()
  await userEvent.click(screen.getByLabelText('Settings'))
  expect(screen.getByText('Where should Maxim think?')).toBeInTheDocument()
  expect(screen.getByLabelText(/Campaign YAML/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close Settings'))
  await userEvent.click(screen.getByLabelText('What Maxim remembers'))
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
})
