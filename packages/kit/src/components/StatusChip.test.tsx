import { render, screen } from '@testing-library/react'
import { MockFacade, wireEvent } from '../facade'
import { StatusChip } from './StatusChip'

test('renders the label', () => {
  render(<StatusChip label="thinking on mesh-lan" tone="ok" />)
  expect(screen.getByText('thinking on mesh-lan')).toBeInTheDocument()
})

test('MockFacade serves diagnose offline (the pattern Phase-2 components bind through)', async () => {
  const facade = new MockFacade()
  const report = await facade.diagnose()
  expect(report.platform?.os).toBe('mockos')
  expect(report.sections?.[0]?.status).toBe('ok')
})

test('MockFacade event stream delivers ConsoleEvent envelopes by kind', () => {
  const facade = new MockFacade()
  const seen: string[] = []
  const unsubscribe = facade.on('heartbeat', (event) => seen.push(event.kind))
  facade.emit(wireEvent('heartbeat'))
  facade.emit(wireEvent('other'))
  unsubscribe()
  facade.emit(wireEvent('heartbeat'))
  expect(seen).toEqual(['heartbeat'])
})
