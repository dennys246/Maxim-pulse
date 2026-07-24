import { render, screen } from '@testing-library/react'
import App from './App'

test('console shell mounts (viz chunk stays unloaded)', () => {
  render(<App />)
  expect(screen.getByText('Maxim Console')).toBeInTheDocument()
  expect(screen.getByText(/Load graph preview/)).toBeInTheDocument()
})
