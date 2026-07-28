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

test('ThinkingPanel accumulates the deliberation chain, not just the last line', () => {
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => {
    facade.emit(wireEvent('deliberation', { message: 'weighing the door' }))
    facade.emit(wireEvent('deliberation', { message: 'recalling the trap' }))
  })
  const panel = screen.getByTestId('thinking-panel')
  expect(panel).toHaveTextContent('weighing the door')
  expect(panel).toHaveTextContent('recalling the trap')
})
