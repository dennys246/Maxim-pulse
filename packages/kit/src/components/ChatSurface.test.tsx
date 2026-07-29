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

test('talk renders the reply returned by the run', async () => {
  const facade = new MockFacade()
  facade.replyText = 'I remember the cavern.'
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hello there')
  await userEvent.click(screen.getByLabelText('Send'))
  expect(screen.getByText(/you ·/)).toBeInTheDocument()
  expect(screen.getByText('hello there')).toBeInTheDocument()
  expect(await screen.findByText('I remember the cavern.')).toBeInTheDocument()
  expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
})

test('the reply is not doubled when it arrives BOTH synchronously and on the stream', async () => {
  const facade = new MockFacade()
  facade.replyText = 'Only once, please.'
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hi')
  await userEvent.click(screen.getByLabelText('Send'))
  expect(await screen.findByText('Only once, please.')).toBeInTheDocument()
  act(() => facade.emit(say('response', 'Only once, please.')))
  expect(screen.getAllByText('Only once, please.')).toHaveLength(1)
})

test('a 501 mode (sim/rest) still renders as pending', async () => {
  const facade = new MockFacade()
  facade.run = vi
    .fn()
    .mockRejectedValue(new FacadeError(501, 'Seam not yet implemented', '/api/run'))
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Rest'))
  expect(await screen.findByText(/rest isn’t available yet/)).toBeInTheDocument()
})

test('🎲 lists the server’s campaigns and launches the chosen one', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  const picker = await screen.findByLabelText(/Play a campaign/)
  await userEvent.selectOptions(picker, '/campaigns/darkened_cavern_v1.yaml')
  await userEvent.click(screen.getByRole('button', { name: 'Begin' }))
  expect(await screen.findByText(/Adventure started · run mock-session/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/run',
    body: { mode: 'adventure', campaign: '/campaigns/darkened_cavern_v1.yaml', input: null },
  })
})

test('a premise-only launch sends input for Maxim to imagine', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  await userEvent.type(screen.getByLabelText(/Describe an adventure/), 'A heist on a sky-fortress')
  await userEvent.click(screen.getByRole('button', { name: 'Begin' }))
  expect(facade.requests).toContainEqual({
    endpoint: '/api/run',
    body: { mode: 'adventure', campaign: null, input: 'A heist on a sky-fortress' },
  })
})

test('the launcher enforces the server’s exactly-one rule', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(screen.getByRole('button', { name: 'Begin' })).toBeDisabled()
  await userEvent.selectOptions(
    await screen.findByLabelText(/Play a campaign/),
    '/campaigns/darkened_cavern_v1.yaml',
  )
  expect(screen.getByRole('button', { name: 'Begin' })).toBeEnabled()
  // choosing a campaign locks the premise box, so both can never be sent
  expect(screen.getByLabelText(/Describe an adventure/)).toBeDisabled()
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

test('an identical reply in a LATER turn is not swallowed as a duplicate', async () => {
  // Regression: pymaxim's "(no reply — …)" placeholder is byte-identical every
  // time it fires. A global dedupe list dropped every occurrence after the
  // first, so a silent turn looked like a lost message.
  const placeholder = '(no reply — the turn produced no respond/speak action)'
  const facade = new MockFacade()
  renderChat(facade)

  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'first')
  await userEvent.click(screen.getByLabelText('Send'))
  act(() => facade.emit(say('response', placeholder)))
  expect(await screen.findByText(placeholder)).toBeInTheDocument()

  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'second')
  await userEvent.click(screen.getByLabelText('Send'))
  act(() => facade.emit(say('response', placeholder)))
  expect(screen.getAllByText(placeholder)).toHaveLength(2)
})

test('within ONE turn the two delivery paths still collapse to a single line', async () => {
  const facade = new MockFacade()
  facade.replyText = 'Same message, one line.'
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hi')
  await userEvent.click(screen.getByLabelText('Send'))
  act(() => facade.emit(say('response', 'Same message, one line.')))
  expect(screen.getAllByText('Same message, one line.')).toHaveLength(1)
})
