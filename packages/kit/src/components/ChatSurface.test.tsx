import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade, wireEvent } from '../facade'
import { EventClientProvider } from '../facade/eventClient'
import { IdentityProvider } from '../facade/identity'
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

test('campaign narration reads in the chat: scene prose, turn dividers, summaries', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  const scene =
    'Bright morning light. The cave entrance is wide, decorated with mineral deposits that glitter in the sun.'
  act(() => {
    facade.emit(wireEvent('turn', { tier: 'clean', message: 'Turn 1', data: { turn: 1 } }))
    facade.emit(wireEvent('scene', { tier: 'clean', message: scene, data: { text: scene } }))
    facade.emit(
      wireEvent('summary', { tier: 'clean', message: 'You mapped the entrance.', data: {} }),
    )
  })
  // full prose, not the 200-char PERCEPT truncation
  expect(await screen.findByText(scene)).toBeInTheDocument()
  expect(screen.getByText('Turn 1')).toBeInTheDocument()
  expect(screen.getByText('You mapped the entrance.')).toBeInTheDocument()
})

test('bio-tier percepts never duplicate the narration into chat', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() => {
    facade.emit(wireEvent('scene', { tier: 'clean', message: 'The cavern yawns.' }))
    // the same scene also fires as a truncated, bio-tier percept — panel only
    facade.emit(wireEvent('percept', { message: '👁️ [cli] The cavern yawns' }))
  })
  expect(await screen.findByText('The cavern yawns.')).toBeInTheDocument()
  expect(screen.queryByText(/👁️/)).not.toBeInTheDocument()
})

test('a seam the backend reports as not live disables its control up front', async () => {
  const facade = new MockFacade()
  facade.backend = {
    ...facade.backend,
    seams: [
      { name: 'talk', live: true, detail: null },
      { name: 'rest', live: false, detail: 'not implemented' },
      { name: 'adventure', live: true, detail: null },
    ],
  }
  render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <IdentityProvider>
          <ChatSurface />
        </IdentityProvider>
      </EventClientProvider>
    </FacadeProvider>,
  )
  // identity resolves async; the control disables once it lands
  await screen.findByLabelText('Say something to Maxim')
  await vi.waitFor(() => expect(screen.getByLabelText('Rest')).toBeDisabled())
  expect(screen.getByLabelText('Start Adventure')).toBeEnabled()
})

test('a turn reports what it ran — the fix for "searched and said nothing"', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() =>
    facade.emit(
      wireEvent('response', {
        tier: 'clean',
        message: '(no reply — the turn produced no respond/speak action)',
        data: {
          text: null,
          actions: ['internet_search'],
          failed_actions: ['internet_search'],
        },
      }),
    ),
  )
  expect(await screen.findByText(/no reply/)).toBeInTheDocument()
  expect(screen.getByText('↳ this turn ran: internet_search (failed)')).toBeInTheDocument()
})

test('a plain reply does not narrate its own respond action', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() =>
    facade.emit(
      wireEvent('response', {
        tier: 'clean',
        message: 'Hello there.',
        data: { text: 'Hello there.', actions: ['respond'], failed_actions: [] },
      }),
    ),
  )
  expect(await screen.findByText('Hello there.')).toBeInTheDocument()
  expect(screen.queryByText(/this turn ran/)).not.toBeInTheDocument()
})
