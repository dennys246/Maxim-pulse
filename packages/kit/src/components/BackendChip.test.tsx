import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade, CONTRACT_VERSION } from '../facade'
import { BackendChip } from './BackendChip'

function renderChip(facade: MockFacade) {
  return render(
    <FacadeProvider facade={facade}>
      <BackendChip />
    </FacadeProvider>,
  )
}

test('shows the branch@sha the server is actually running', async () => {
  const facade = new MockFacade()
  facade.backend = { ...facade.backend, git_branch: 'feat/pkg-aarch64', git_sha: 'deadbeef1234' }
  renderChip(facade)
  expect(await screen.findByText('feat/pkg-aarch64@deadbee')).toBeInTheDocument()
})

test('warns when the server speaks a different contract than this bundle', async () => {
  const facade = new MockFacade()
  facade.backend = { ...facade.backend, contract_version: '9.9.9' }
  renderChip(facade)
  expect(await screen.findByText(new RegExp(`9.9.9 ≠ ${CONTRACT_VERSION}`))).toBeInTheDocument()
})

test('an older backend without /api/identity degrades quietly', async () => {
  const facade = new MockFacade()
  facade.identity = vi.fn().mockRejectedValue(new Error('404'))
  renderChip(facade)
  expect(await screen.findByText('backend: unknown')).toBeInTheDocument()
})
