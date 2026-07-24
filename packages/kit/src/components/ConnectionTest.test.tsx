import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade } from '../facade'
import { FacadeError } from '../facade/http'
import { ConnectionTest } from './ConnectionTest'

function renderWithFacade(facade: MockFacade, ui: React.ReactElement) {
  return render(<FacadeProvider facade={facade}>{ui}</FacadeProvider>)
}

test('ok probe renders the message and notifies the parent', async () => {
  const facade = new MockFacade()
  facade.probeResult = {
    status: 'ok',
    outcome: 'ok',
    message: 'leader reachable',
    latency_ms: 41.8,
  }
  const onResult = vi.fn()
  renderWithFacade(
    facade,
    <ConnectionTest request={{ url: 'http://leader:8099' }} onResult={onResult} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  expect(await screen.findByText(/leader reachable/)).toBeInTheDocument()
  expect(screen.getByText(/42 ms/)).toBeInTheDocument()
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok' }))
  expect(facade.requests[0]).toEqual({
    endpoint: '/api/probe',
    body: { url: 'http://leader:8099' },
  })
})

test('fail probe renders the fix hint', async () => {
  const facade = new MockFacade()
  facade.probeResult = {
    status: 'fail',
    outcome: 'unreachable',
    message: 'connection refused',
    fix_hint: 'Is the leader running? Try: maxim doctor',
  }
  renderWithFacade(facade, <ConnectionTest request={{ url: 'http://leader:8099' }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  expect(await screen.findByText(/connection refused/)).toBeInTheDocument()
  expect(screen.getByText(/Is the leader running/)).toBeInTheDocument()
})

test('501 renders as not-available-yet, not an error', async () => {
  const facade = new MockFacade()
  facade.probe = vi.fn().mockRejectedValue(new FacadeError(501, 'PROBE not landed', '/api/probe'))
  renderWithFacade(facade, <ConnectionTest request={{ url: 'http://x' }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  expect(await screen.findByText(/isn’t available yet/)).toBeInTheDocument()
  expect(screen.queryByText(/Test failed to run/)).not.toBeInTheDocument()
})
