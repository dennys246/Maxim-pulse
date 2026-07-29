import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade, wireEvent } from '../facade'
import { EventClientProvider } from '../facade/eventClient'
import { FacadeError } from '../facade/http'
import { ChatSurface } from './ChatSurface'

function renderChat(facade: MockFacade) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <ChatSurface />
      </EventClientProvider>
    </FacadeProvider>,
  )
}

/** A clean-tier conversation record as handle.talk publishes it. */
const say = (kind: 'user' | 'response', text: string) =>
  wireEvent(kind, { tier: 'clean', message: text, data: { text } })

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
  expect(await screen.findByText(/talk mode is still landing in pymaxim/)).toBeInTheDocument()
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

test('a RESPONSE record renders as Maxim speaking', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() => facade.emit(say('response', 'The cavern mouth yawns before you.')))
  expect(await screen.findByText('The cavern mouth yawns before you.')).toBeInTheDocument()
})

test('the USER record echoing our own utterance is deduped, not doubled', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hello there')
  await userEvent.click(screen.getByLabelText('Send'))
  // the server echoes the utterance back on the stream
  act(() => facade.emit(say('user', 'hello there')))
  expect(screen.getAllByText('hello there')).toHaveLength(1)
})

test('a USER record we did not send (another client) still renders', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() => facade.emit(say('user', 'typed from another window')))
  expect(await screen.findByText('typed from another window')).toBeInTheDocument()
})

test('bio-tier noise never reaches the transcript', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() => {
    facade.emit(wireEvent('nac', { message: '🧠 new: tool:choose → positive' }))
    facade.emit(wireEvent('hippocampus', { message: '💾 Captured: choose' }))
    facade.emit(say('response', 'Only this belongs in chat.'))
  })
  expect(await screen.findByText('Only this belongs in chat.')).toBeInTheDocument()
  expect(screen.queryByText(/tool:choose/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Captured/)).not.toBeInTheDocument()
})
