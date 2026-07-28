import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FacadeProvider, MockFacade, wireEvent } from '../facade'
import { EventClientProvider, useEvents } from '../facade/eventClient'
import type { ConsoleEvent } from '../facade/types'
import { PanelProvider, PanelRail, type PanelSpec } from './PanelDock'

const isNac = (event: ConsoleEvent) => event.kind === 'nac'

const PANELS: PanelSpec[] = [
  {
    id: 'activity',
    title: 'Bio activity',
    icon: '🧠',
    side: 'left',
    activateOn: isNac,
    render: () => <p>activity body</p>,
  },
  {
    id: 'notes',
    title: 'Notes',
    icon: '📝',
    side: 'right',
    render: () => <p>notes body</p>,
  },
]

function renderDock(facade = new MockFacade(), panels = PANELS) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <PanelProvider panels={panels}>
          <PanelRail side="left" />
          <PanelRail side="right" />
        </PanelProvider>
      </EventClientProvider>
    </FacadeProvider>,
  )
}

test('user toggle opens and closes a panel', async () => {
  renderDock()
  await userEvent.click(screen.getByLabelText('Open Notes'))
  expect(screen.getByText('notes body')).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Close Notes panel'))
  expect(screen.queryByText('notes body')).not.toBeInTheDocument()
})

test('a matching event opens the panel (Maxim-driven activation)', () => {
  const facade = new MockFacade()
  renderDock(facade)
  expect(screen.queryByText('activity body')).not.toBeInTheDocument()
  act(() => facade.emit(wireEvent('nac')))
  expect(screen.getByText('activity body')).toBeInTheDocument()
})

test('floor semantics: a user-closed panel is only SUGGESTED, and a click opens it', async () => {
  const facade = new MockFacade()
  renderDock(facade)
  act(() => facade.emit(wireEvent('nac')))
  await userEvent.click(screen.getByLabelText('Close Bio activity'))
  expect(screen.queryByText('activity body')).not.toBeInTheDocument()

  act(() => facade.emit(wireEvent('nac')))
  // NOT reopened — suggested instead (chip hints)
  expect(screen.queryByText('activity body')).not.toBeInTheDocument()
  expect(screen.getByTitle(/Maxim has something to show/)).toBeInTheDocument()

  await userEvent.click(screen.getByLabelText('Open Bio activity'))
  expect(screen.getByText('activity body')).toBeInTheDocument()
})

function Replayed() {
  const events = useEvents({ kinds: ['nac'] })
  return <p data-testid="replayed">{events.length}</p>
}

test('EventHub replays buffered events to late subscribers', () => {
  const facade = new MockFacade()
  const { rerender } = render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <p>no subscriber yet</p>
      </EventClientProvider>
    </FacadeProvider>,
  )
  act(() => {
    facade.emit(wireEvent('nac'))
    facade.emit(wireEvent('other'))
  })
  rerender(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <Replayed />
      </EventClientProvider>
    </FacadeProvider>,
  )
  expect(screen.getByTestId('replayed')).toHaveTextContent('1')
})
