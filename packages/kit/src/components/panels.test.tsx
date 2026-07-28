import { act, render, screen } from '@testing-library/react'
import { FacadeProvider, MockFacade, wireEvent } from '../facade'
import { EventClientProvider } from '../facade/eventClient'
import { ActivityPanel, ThinkingPanel } from './panels'

function withStream(facade: MockFacade, ui: React.ReactElement) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>{ui}</EventClientProvider>
    </FacadeProvider>,
  )
}

test('ActivityPanel lists bio-tier events with message + agent; clean tier excluded', () => {
  const facade = new MockFacade()
  withStream(facade, <ActivityPanel />)
  act(() => {
    facade.emit(wireEvent('heartbeat', { tier: 'clean' }))
    facade.emit(wireEvent('nac', { message: 'reward +0.4 for door_choice', agent: 'console' }))
  })
  const panel = screen.getByTestId('activity-panel')
  expect(panel).toHaveTextContent('[nac] reward +0.4 for door_choice · console')
  expect(panel).not.toHaveTextContent('heartbeat')
})

test('ThinkingPanel shows the REASONING (data.text), not the cycle counter in message', () => {
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => {
    facade.emit(
      wireEvent('deliberation', {
        message: 'deliberation cycle 1/5',
        data: {
          text: 'The cave entrance is wide and well-lit, making it ideal for careful mapping.',
          cycle: 1,
          max_cycles: 5,
          enrichment_tags: ['hippocampus', 'nac'],
          enrichment_details: { hippocampus: '2 episodes: the last cavern' },
        },
      }),
    )
    facade.emit(
      wireEvent('deliberation', {
        message: 'deliberation cycle 2/5',
        data: { text: 'The rogue betrayed us here before — approach differently.', cycle: 2 },
      }),
    )
  })
  const panel = screen.getByTestId('thinking-panel')
  // the reasoning chain accumulates...
  expect(panel).toHaveTextContent('The cave entrance is wide and well-lit')
  expect(panel).toHaveTextContent('The rogue betrayed us here before')
  // ...with cycle markers and which bio-systems enriched the cycle
  expect(panel).toHaveTextContent('cycle 1/5')
  expect(panel).toHaveTextContent('hippocampus')
  expect(screen.getByTitle('2 episodes: the last cavern')).toBeInTheDocument()
})

test('ThinkingPanel falls back to message when a record carries no reasoning text', () => {
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => {
    facade.emit(
      wireEvent('deliberation', {
        message: 'deliberation complete after 3 cycle(s)',
        data: { completed: true },
      }),
    )
  })
  const panel = screen.getByTestId('thinking-panel')
  expect(panel).toHaveTextContent('deliberation complete after 3 cycle(s)')
  expect(panel).toHaveTextContent('complete')
})
