import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade } from '../facade'
import { FacadeError } from '../facade/http'
import type { ModelInfo } from '../facade/types'
import { SetupWizard } from './SetupWizard'

const cloudModel: ModelInfo = {
  name: 'claude-sonnet-5',
  backend: 'anthropic',
  cloud: true,
  downloaded: false,
  ready: true,
}

function renderWizard(facade: MockFacade, onComplete = vi.fn()) {
  render(
    <FacadeProvider facade={facade}>
      <SetupWizard onComplete={onComplete} />
    </FacadeProvider>,
  )
  return onComplete
}

test('welcome offers one jargon-free choice: mesh vs cloud', () => {
  renderWizard(new MockFacade())
  expect(screen.getByText(/Private & free/)).toBeInTheDocument()
  expect(screen.getByText(/connect a cloud key/i)).toBeInTheDocument()
  for (const jargon of ['lane', 'placement', 'profile', 'tier']) {
    expect(screen.queryByText(new RegExp(jargon, 'i'))).not.toBeInTheDocument()
  }
})

test('mesh path: Save is gated on a passing test, then writes through SETUP', async () => {
  const facade = new MockFacade()
  facade.probeResult = { status: 'ok', outcome: 'ok', message: 'leader reachable' }
  const onComplete = renderWizard(facade)

  await userEvent.click(screen.getByText(/Private & free/))
  await userEvent.type(screen.getByLabelText('Address'), 'http://leader:8099')
  await userEvent.type(screen.getByLabelText('Access key'), 'sekrit')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText(/leader reachable/)
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/Maxim is set up/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/setup/mesh',
    body: { leader_url: 'http://leader:8099', api_key: 'sekrit' },
  })
  expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ placement: 'mesh' }))
})

test('mesh path: a failing test keeps Save locked', async () => {
  const facade = new MockFacade()
  facade.probeResult = { status: 'fail', outcome: 'unreachable', message: 'no route' }
  renderWizard(facade)
  await userEvent.click(screen.getByText(/Private & free/))
  await userEvent.type(screen.getByLabelText('Address'), 'http://leader:8099')
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText(/no route/)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('cloud path: model + key + budget write through SETUP with defaults', async () => {
  const facade = new MockFacade()
  facade.models = { groups: { cloud: [cloudModel] } }
  const onComplete = renderWizard(facade)

  await userEvent.click(screen.getByText(/connect a cloud key/i))
  await userEvent.click(await screen.findByText('claude-sonnet-5'))
  await userEvent.type(screen.getByLabelText('API key'), 'sk-test')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText(/Maxim is set up/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/setup/cloud',
    body: {
      provider: 'anthropic',
      profile: 'claude-sonnet-5',
      api_key: 'sk-test',
      monthly_budget_usd: 5,
    },
  })
  expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ placement: 'cloud' }))
})

test('SETUP 501 renders as pending, not an error', async () => {
  const facade = new MockFacade()
  facade.probeResult = { status: 'ok', outcome: 'ok', message: 'ok' }
  facade.setupMesh = vi
    .fn()
    .mockRejectedValue(new FacadeError(501, 'SETUP seam not landed', '/api/setup/mesh'))
  renderWizard(facade)
  await userEvent.click(screen.getByText(/Private & free/))
  await userEvent.type(screen.getByLabelText('Address'), 'http://leader:8099')
  await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await screen.findByText(/△|✓/)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/isn’t available yet/)).toBeInTheDocument()
  expect(screen.queryByText(/Save failed/)).not.toBeInTheDocument()
})
