import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

test('status-only records are tucked behind a toggle so reasoning is not buried', async () => {
  // Four emitters write `deliberation`; only sim_deliberation_update/_end carry
  // reasoning. Status lines (contemplation, convergence) used to crowd it out.
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => {
    facade.emit(
      wireEvent('deliberation', { message: '💭 contemplation kept original (score=0.00)' }),
    )
    facade.emit(wireEvent('deliberation', { message: 'deliberation converged after 2 cycles' }))
    facade.emit(
      wireEvent('deliberation', {
        message: 'deliberation cycle 1/3',
        data: { text: 'The cave entrance is wide and well-lit.', cycle: 1 },
      }),
    )
  })
  // the reasoning shows; the two status lines are counted, not shown
  expect(screen.getByTestId('thinking-panel')).toHaveTextContent('The cave entrance is wide')
  expect(screen.getByTestId('thinking-panel')).not.toHaveTextContent('contemplation kept original')
  expect(screen.getByLabelText('Show deliberation status lines')).toHaveTextContent(
    '2 status lines',
  )

  await userEvent.click(screen.getByLabelText('Show deliberation status lines'))
  expect(screen.getByTestId('thinking-panel')).toHaveTextContent('contemplation kept original')
})

test('a turn with only status lines says so instead of showing an empty panel', () => {
  const facade = new MockFacade()
  withStream(facade, <ThinkingPanel />)
  act(() => facade.emit(wireEvent('deliberation', { message: 'max cycles (3) reached' })))
  expect(screen.getByText(/No reasoning text yet/)).toBeInTheDocument()
})

test('ActivityPanel collapses consecutive duplicates with a count (the 3x percept)', () => {
  const facade = new MockFacade()
  withStream(facade, <ActivityPanel />)
  act(() => {
    // pymaxim logs the same percept from the factory AND each source
    facade.emit(wireEvent('percept', { message: '👁️ [cli] let’s go on an adventure' }))
    facade.emit(wireEvent('percept', { message: '👁️ [cli] let’s go on an adventure' }))
    facade.emit(wireEvent('percept', { message: '👁️ [cli] let’s go on an adventure' }))
    facade.emit(wireEvent('thought', { message: '💭 deliberation skipped' }))
  })
  const rows = screen.getByTestId('activity-panel').querySelectorAll('li')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('×3')
  expect(rows[1]).toHaveTextContent('deliberation skipped')
  expect(rows[1]).not.toHaveTextContent('×')
})

test('ActivityPanel does not merge non-adjacent duplicates', () => {
  const facade = new MockFacade()
  withStream(facade, <ActivityPanel />)
  act(() => {
    facade.emit(wireEvent('nac', { message: 'reward +0.5' }))
    facade.emit(wireEvent('hippocampus', { message: 'captured' }))
    facade.emit(wireEvent('nac', { message: 'reward +0.5' }))
  })
  expect(screen.getByTestId('activity-panel').querySelectorAll('li')).toHaveLength(3)
})

test('ActivityPanel: muting a noisy kind reveals the record it was burying', async () => {
  const facade = new MockFacade()
  withStream(facade, <ActivityPanel />)
  act(() => {
    // the idle loop: a hippocampus/scn pair ~2x per second, alternating so
    // consecutive-collapse cannot help
    for (let i = 0; i < 20; i++) {
      facade.emit(wireEvent('hippocampus', { message: 'Captured: observation (salience=0.50)' }))
      facade.emit(wireEvent('scn', { message: `Registered ${i}a2b in circadian=0.91` }))
    }
    facade.emit(wireEvent('motor', { message: '❌ [FAIL] internet_search: timeout' }))
  })
  // the interesting record is present but buried among 40 idle lines
  expect(screen.getByTestId('activity-panel')).toHaveTextContent('internet_search')
  const kinds = screen.getByTestId('activity-kinds')
  expect(kinds).toHaveTextContent('Memories ×20') // glossary label; [hippocampus] still prints on each line
  expect(kinds).toHaveTextContent('Actions ×1')

  await userEvent.click(screen.getByLabelText('Mute hippocampus'))
  await userEvent.click(screen.getByLabelText('Mute scn'))
  const rows = screen.getByTestId('activity-panel').querySelectorAll('li')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('internet_search')
  // muted kinds still report their counts — nothing vanishes silently
  expect(screen.getByLabelText('Show hippocampus')).toHaveTextContent('Memories ×20')
})
