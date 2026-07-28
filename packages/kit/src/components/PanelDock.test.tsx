import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
    side: 'left',
    render: () => <p>notes body</p>,
  },
  {
    id: 'memory',
    title: 'Memory',
    icon: '✦',
    side: 'right',
    render: () => <p>memory body</p>,
  },
]

/** In-memory layout storage — this jsdom env has no localStorage. */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

const sharedStore = memoryStorage()

function renderDock(facade = new MockFacade(), panels = PANELS, storage = memoryStorage()) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <PanelProvider panels={panels} storage={storage}>
          <PanelRail side="left" />
          <PanelRail side="right" />
        </PanelProvider>
      </EventClientProvider>
    </FacadeProvider>,
  )
}

/** Minimal DataTransfer stand-in — jsdom's drag events carry none. */
function fakeDataTransfer() {
  const store: Record<string, string> = {}
  return {
    setData: (key: string, value: string) => {
      store[key] = value
    },
    getData: (key: string) => store[key] ?? '',
  }
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

test('BOTH rails stack chips vertically while collapsed, then flow horizontally + wrap', async () => {
  renderDock()
  expect(screen.getByTestId('left-rail-chips').className).toContain('flex-col')
  expect(screen.getByTestId('right-rail-chips').className).toContain('flex-col')

  await userEvent.click(screen.getByLabelText('Open Notes'))
  expect(screen.getByTestId('left-rail-chips').className).toContain('flex-row')
  expect(screen.getByTestId('left-rail-chips').className).toContain('flex-wrap')
  // the other rail is independent — still collapsed, still vertical
  expect(screen.getByTestId('right-rail-chips').className).toContain('flex-col')

  await userEvent.click(screen.getByLabelText('Open Memory'))
  expect(screen.getByTestId('right-rail-chips').className).toContain('flex-row')
  expect(screen.getByTestId('right-rail-chips').className).toContain('flex-wrap')
})

test('a chip drags from one rail to the other', () => {
  renderDock()
  expect(within(screen.getByTestId('left-rail-chips')).getByLabelText('Open Notes')).toBeTruthy()

  const dataTransfer = fakeDataTransfer()
  fireEvent.dragStart(screen.getByLabelText('Open Notes'), { dataTransfer })
  fireEvent.drop(screen.getByLabelText('right panel rail'), { dataTransfer })

  expect(within(screen.getByTestId('right-rail-chips')).getByLabelText('Open Notes')).toBeTruthy()
  expect(within(screen.getByTestId('left-rail-chips')).queryByLabelText('Open Notes')).toBeNull()
})

test('dropping a chip onto another chip reorders it', () => {
  renderDock()
  const dataTransfer = fakeDataTransfer()
  // drag Notes onto Bio activity → Notes takes the earlier slot
  fireEvent.dragStart(screen.getByLabelText('Open Notes'), { dataTransfer })
  fireEvent.drop(screen.getByLabelText('Open Bio activity'), { dataTransfer })

  const chips = within(screen.getByTestId('left-rail-chips')).getAllByRole('button')
  expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
    'Open Notes',
    'Open Bio activity',
  ])
})

test('rails and panels resize by keyboard, and the layout persists across mounts', async () => {
  const { unmount } = renderDock(new MockFacade(), PANELS, sharedStore)
  await userEvent.click(screen.getByLabelText('Open Notes'))

  const railHandle = screen.getByLabelText('Resize left rail')
  fireEvent.keyDown(railHandle, { key: 'ArrowRight' })
  fireEvent.keyDown(railHandle, { key: 'ArrowRight' })
  fireEvent.keyDown(screen.getByLabelText('Resize Notes panel'), { key: 'ArrowDown' })

  const saved = JSON.parse(sharedStore.getItem('maxim-pulse:panel-layout') ?? '{}')
  expect(saved.railWidth.left).toBe(288 + 16 * 2)
  expect(saved.panelHeight.notes).toBe(220 + 16)

  unmount()
  renderDock(new MockFacade(), PANELS, sharedStore)
  await userEvent.click(screen.getByLabelText('Open Notes'))
  expect(screen.getByLabelText('Notes')).toHaveStyle({ height: '236px' })
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
