import { act, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade, wireEvent } from '../facade'
import { EventClientProvider } from '../facade/eventClient'
import { TurnStatus } from './TurnStatus'

function renderStatus(facade: MockFacade) {
  return render(
    <FacadeProvider facade={facade}>
      <EventClientProvider>
        <TurnStatus />
      </EventClientProvider>
    </FacadeProvider>,
  )
}

const started = () =>
  wireEvent('run', { tier: 'clean', message: 'run 1 started', data: { status: 'started' } })

test('renders nothing until a run starts', () => {
  const facade = new MockFacade()
  renderStatus(facade)
  expect(screen.queryByTestId('turn-status')).not.toBeInTheDocument()
  act(() => facade.emit(started()))
  expect(screen.getByTestId('turn-status')).toHaveTextContent('adventure in progress')
})

test('stream silence during a run becomes a ticking "thinking…" (the ~90s turn gap)', () => {
  vi.useFakeTimers()
  try {
    const facade = new MockFacade()
    renderStatus(facade)
    act(() => facade.emit(started()))
    act(() => {
      vi.advanceTimersByTime(9_000)
    })
    expect(screen.getByTestId('turn-status')).toHaveTextContent(/Maxim is thinking… 9s/)

    // a real event proves the turn moved — the counter resets
    act(() => facade.emit(wireEvent('deliberation', { message: 'weighing the door' })))
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByTestId('turn-status')).toHaveTextContent('adventure in progress')
  } finally {
    vi.useRealTimers()
  }
})

test('heartbeats do NOT count as progress (they would mask a stalled turn)', () => {
  vi.useFakeTimers()
  try {
    const facade = new MockFacade()
    renderStatus(facade)
    act(() => facade.emit(started()))
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    act(() => facade.emit(wireEvent('heartbeat', { tier: 'clean' })))
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByTestId('turn-status')).toHaveTextContent(/Maxim is thinking… 7s/)
  } finally {
    vi.useRealTimers()
  }
})

test('run end shows the finish_reason (host sleep / cancel is legible, not a mystery freeze)', () => {
  const facade = new MockFacade()
  renderStatus(facade)
  act(() => facade.emit(started()))
  act(() =>
    facade.emit(
      wireEvent('run', {
        tier: 'clean',
        message: 'run 1 ended',
        data: { status: 'ended', finish_reason: 'cancel' },
      }),
    ),
  )
  expect(screen.getByText(/run ended · cancel/)).toBeInTheDocument()
})

test('run failure surfaces the error', () => {
  const facade = new MockFacade()
  renderStatus(facade)
  act(() => facade.emit(started()))
  act(() =>
    facade.emit(
      wireEvent('run', {
        tier: 'clean',
        message: 'run 1 failed',
        data: { status: 'failed', error: 'RuntimeError: boom' },
      }),
    ),
  )
  expect(screen.getByText(/run failed · RuntimeError: boom/)).toBeInTheDocument()
})
