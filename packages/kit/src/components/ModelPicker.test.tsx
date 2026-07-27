import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade } from '../facade'
import type { ModelInfo } from '../facade/types'
import { ModelPicker } from './ModelPicker'

const model = (name: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  name,
  backend: 'llama_cpp',
  cloud: false,
  curated: false,
  downloaded: false,
  ready: false,
  ...extra,
})

function renderPicker(facade: MockFacade, props = {}) {
  return render(
    <FacadeProvider facade={facade}>
      <ModelPicker {...props} />
    </FacadeProvider>,
  )
}

test('renders groups from the facade and selects on click', async () => {
  const facade = new MockFacade()
  facade.models = {
    groups: {
      local: [model('gemma-2b-it', { context_length: 8192 })],
      cloud: [model('claude-sonnet-5', { cloud: true, backend: 'anthropic' })],
    },
  }
  const onChange = vi.fn()
  renderPicker(facade, { onChange })
  expect(await screen.findByText('gemma-2b-it')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'local' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'cloud' })).toBeInTheDocument()
  await userEvent.click(screen.getByText('claude-sonnet-5'))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'claude-sonnet-5' }))
})

test('collapses to curated-marked profiles with Show all', async () => {
  const facade = new MockFacade()
  facade.models = {
    groups: {
      local: [model('a'), model('b', { curated: true }), model('c'), model('d', { curated: true })],
    },
  }
  renderPicker(facade)
  expect(await screen.findByText('b')).toBeInTheDocument()
  expect(screen.getByText('d')).toBeInTheDocument()
  expect(screen.queryByText('a')).not.toBeInTheDocument()
  await userEvent.click(screen.getByText('Show all 4'))
  expect(screen.getByText('a')).toBeInTheDocument()
})

test('falls back to curatedCount when nothing is marked curated', async () => {
  const facade = new MockFacade()
  facade.models = {
    groups: { local: [model('a'), model('b'), model('c'), model('d'), model('e')] },
  }
  renderPicker(facade, { curatedCount: 2 })
  expect(await screen.findByText('a')).toBeInTheDocument()
  expect(screen.queryByText('c')).not.toBeInTheDocument()
  await userEvent.click(screen.getByText('Show all 5'))
  expect(screen.getByText('e')).toBeInTheDocument()
})

test('filter narrows profiles (cloud-only setup path)', async () => {
  const facade = new MockFacade()
  facade.models = {
    groups: {
      local: [model('gemma-2b-it')],
      cloud: [model('claude-sonnet-5', { cloud: true })],
    },
  }
  renderPicker(facade, { filter: (m: ModelInfo) => m.cloud })
  expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument()
  expect(screen.queryByText('gemma-2b-it')).not.toBeInTheDocument()
  expect(screen.queryByText('local')).not.toBeInTheDocument()
})

test('load failure renders the error, not a crash', async () => {
  const facade = new MockFacade()
  facade.listModels = vi.fn().mockRejectedValue(new Error('network down'))
  renderPicker(facade)
  expect(await screen.findByText(/network down/)).toBeInTheDocument()
})
