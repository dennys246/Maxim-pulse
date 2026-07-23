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
  expect(report.placement).toBe('mesh-lan')
  expect(report.healthy).toBe(true)
})
