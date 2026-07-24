import { render, screen } from '@testing-library/react'
import { MockFacade } from '../facade'
import { StatusChip } from './StatusChip'

test('renders the label', () => {
  render(<StatusChip label="thinking on mesh-lan" tone="ok" />)
  expect(screen.getByText('thinking on mesh-lan')).toBeInTheDocument()
})

test('MockFacade serves diagnose offline (the pattern Phase-2 components bind through)', async () => {
  const facade = new MockFacade()
  const report = await facade.diagnose()
  expect(report.platform).toBe('mock')
  expect(report.sections?.[0]?.status).toBe('ok')
})

test('MockFacade event stream delivers ConsoleEvent envelopes by kind', () => {
  const facade = new MockFacade()
  const seen: string[] = []
  const unsubscribe = facade.on('heartbeat', (event) => seen.push(event.kind))
  facade.emit({ kind: 'heartbeat', ts: 1 })
  facade.emit({ kind: 'other', ts: 2 })
  unsubscribe()
  facade.emit({ kind: 'heartbeat', ts: 3 })
  expect(seen).toEqual(['heartbeat'])
})
