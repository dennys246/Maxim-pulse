import { act, render, screen } from '@testing-library/react'
import { FacadeProvider, MockFacade } from '../facade'
import { EventClientProvider } from '../facade/eventClient'
import { ActivityPanel, ThinkingPanel } from './panels'

function withStream(facade: MockFacade, ui: React.ReactElement) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>{ui}</EventClientProvider>
    </FacadeProvider>,
  )
}

test('ActivityPanel lists non-heartbeat events with agent ids', () => {
  const facade = new MockFacade()
  withStream(facade, <ActivityPanel />)
  act(() => {
    facade.emit({ kind: 'heartbeat', ts: 1 })
    facade.emit({ kind: 'nac_reward', ts: 2, agent_id: 'console' })
  })
  const panel = screen.getByTestId('activity-panel')
  expect(panel).toHaveTextContent('nac_reward · console')
  expect(panel).not.toHaveTextContent('heartbeat')
})

test('ThinkingPanel accumulates the reasoning chain, not just the last line', () => {
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => {
    facade.emit({ kind: 'thinking', ts: 1, data: { text: 'weighing the door' } })
    facade.emit({ kind: 'thinking', ts: 2, data: { text: 'recalling the trap' } })
  })
  const panel = screen.getByTestId('thinking-panel')
  expect(panel).toHaveTextContent('weighing the door')
  expect(panel).toHaveTextContent('recalling the trap')
})
