import { FacadeProvider, MockFacade } from '@maxim/kit'
import { render, screen } from '@testing-library/react'
import App from './App'

test('reachy main page mounts: chip + three actions + memory', async () => {
  render(
    <FacadeProvider facade={new MockFacade()}>
      <App />
    </FacadeProvider>,
  )
  expect(screen.getByText('Maxim on Reachy')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Adventure/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Talk/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Rest/ })).toBeInTheDocument()
  expect(screen.getByText(/What Maxim remembers about you/)).toBeInTheDocument()
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
})
