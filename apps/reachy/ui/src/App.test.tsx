import { render, screen } from '@testing-library/react'
import App from './App'

test('reachy shell mounts', () => {
  render(<App />)
  expect(screen.getByText('Maxim on Reachy')).toBeInTheDocument()
})
