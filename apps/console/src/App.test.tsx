import { FacadeProvider, MockFacade } from '@maxim/kit'
import { render, screen } from '@testing-library/react'
import App from './App'

test('console shell mounts (viz chunk stays unloaded)', () => {
  render(
    <FacadeProvider facade={new MockFacade()}>
      <App />
    </FacadeProvider>,
  )
  expect(screen.getByText('Maxim Console')).toBeInTheDocument()
  expect(screen.getByText(/Load graph preview/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
})
