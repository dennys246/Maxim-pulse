import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade } from '../facade'
import { FacadeError } from '../facade/http'
import { ChatSurface } from './ChatSurface'

function renderChat(facade: MockFacade) {
  return render(
    <FacadeProvider facade={facade}>
      <ChatSurface />
    </FacadeProvider>,
  )
}

test('talk 501 renders the gentle pending line, not an error', async () => {
  const facade = new MockFacade()
  facade.run = vi
    .fn()
    .mockRejectedValue(new FacadeError(501, 'Seam not yet implemented', '/api/run'))
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hello there')
  await userEvent.click(screen.getByLabelText('Send'))
  expect(screen.getByText(/you ·/)).toBeInTheDocument()
  expect(screen.getByText('hello there')).toBeInTheDocument()
  expect(
    await screen.findByText(/arrives with the event bridge. 🎲 Adventure works today/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
})

test('🎲 opens the launcher; a campaign path launches and reports the run id', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  await userEvent.type(screen.getByLabelText(/Play a campaign/), '/tmp/darkened_cavern_v1.yaml')
  await userEvent.click(screen.getByRole('button', { name: 'Begin' }))
  expect(await screen.findByText(/Adventure started · run mock-session/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/run',
    body: { mode: 'adventure', campaign: '/tmp/darkened_cavern_v1.yaml', input: null },
  })
})

test('launcher Begin is disabled with neither a campaign nor an idea', async () => {
  renderChat(new MockFacade())
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(screen.getByRole('button', { name: 'Begin' })).toBeDisabled()
})

test('an idea-only launch sends input and renders the pending-seam line on 422', async () => {
  const facade = new MockFacade()
  const run = vi
    .fn()
    .mockRejectedValue(new FacadeError(422, "mode='adventure' requires 'campaign'", '/api/run'))
  facade.run = run
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  await userEvent.type(screen.getByLabelText(/Describe an adventure/), 'A heist on a sky-fortress')
  await userEvent.click(screen.getByRole('button', { name: 'Begin' }))
  expect(run).toHaveBeenCalledWith({
    mode: 'adventure',
    campaign: null,
    input: 'A heist on a sky-fortress',
  })
  expect(
    await screen.findByText(/can’t imagine an adventure from a description yet/),
  ).toBeInTheDocument()
})
