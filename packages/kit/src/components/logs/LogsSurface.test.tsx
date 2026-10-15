import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FacadeProvider } from '../../facade/context'
import { EventClientProvider } from '../../facade/eventClient'
import { IdentityProvider } from '../../facade/identity'
import { MockFacade, wireEvent } from '../../facade/mock'
import { HealthStrip } from './HealthViews'
import { LogsSurface } from './LogsSurface'

function renderWith(node: React.ReactNode, facade = new MockFacade()) {
  render(
    <FacadeProvider facade={facade}>
      <IdentityProvider>
        <EventClientProvider>{node}</EventClientProvider>
      </IdentityProvider>
    </FacadeProvider>,
  )
  return facade
}

test('runs are listed newest first; aborted runs stay behind a toggle', async () => {
  renderWith(<LogsSurface />)
  const table = await screen.findByRole('table', { name: 'Past runs' })
  expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2 runs with reports
  expect(screen.queryByText('aborted')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Show aborted runs \(1\)/ }))
  expect(screen.getByText('aborted')).toBeInTheDocument()
})

test('opening a run shows its actions in order with the bridge credit and the surprise', async () => {
  renderWith(<LogsSurface />)
  const table = await screen.findByRole('table', { name: 'Past runs' })
  await userEvent.click(within(table).getAllByRole('button')[0]!)
  const actions = await screen.findByRole('region', { name: 'Actions' })
  const items = within(actions).getAllByRole('listitem')
  expect(items.map((li) => li.textContent)).toEqual([
    expect.stringMatching(/^1sense_toolsok/),
    expect.stringMatching(/^2sense_toolsfailedbooked by bridge · rpe −0\.42 · pain 0\.30/),
    expect.stringMatching(/^3respondokrpe \+0\.12/),
  ])
})

test('a run recorded before per-action credit says so instead of showing blanks', async () => {
  renderWith(<LogsSurface />)
  const table = await screen.findByRole('table', { name: 'Past runs' })
  await userEvent.click(within(table).getAllByRole('button')[1]!) // the older, generative run
  expect(await screen.findByText('credit not recorded')).toBeInTheDocument()
  expect(
    screen.getByText(/Per-action credit is not recorded for this run \(actions format 1\.1\)/),
  ).toBeInTheDocument()
})

test('an aborted run explains its missing report', async () => {
  renderWith(<LogsSurface />)
  await userEvent.click(await screen.findByRole('button', { name: /Show aborted runs/ }))
  const table = screen.getByRole('table', { name: 'Past runs' })
  const abortedRow = within(table).getByText('aborted').closest('tr')!
  await userEvent.click(within(abortedRow).getByRole('button'))
  expect(await screen.findByText(/ended before writing one/)).toBeInTheDocument()
  expect(await screen.findByText('This run recorded no actions file.')).toBeInTheDocument()
})

test('degraded sites are grouped by site with their counts', async () => {
  renderWith(<LogsSurface />)
  await userEvent.click(await screen.findByRole('tab', { name: 'Degraded' }))
  const table = await screen.findByRole('table', { name: 'Degraded sites' })
  expect(within(table).getByText('executor.py:_fail_ran')).toBeInTheDocument()
  expect(within(table).getByText('3')).toBeInTheDocument()
})

test('the health tab says stall detection is off rather than implying "no stalls"', async () => {
  renderWith(<LogsSurface />)
  await userEvent.click(await screen.findByRole('tab', { name: 'Health' }))
  expect(await screen.findByText(/Stall detection is off on this server/)).toBeInTheDocument()
  expect(screen.queryByText('No stalls recorded.')).not.toBeInTheDocument()
  expect(screen.getByText(/CPU 24% · RAM 61% · GPU 44% 67°C · LLM p50 840 ms/)).toBeInTheDocument()
})

test('an older backend gets "needs contract 0.6.0" in every tab, never a blank panel', async () => {
  const facade = new MockFacade()
  facade.backend = {
    ...facade.backend,
    seams: (facade.backend.seams ?? []).filter(
      (s) => !['runs', 'health', 'degraded'].includes(s.name),
    ),
  }
  renderWith(<LogsSurface />, facade)
  expect(await screen.findByRole('status')).toHaveTextContent('console contract 0.6.0')
  await userEvent.click(screen.getByRole('tab', { name: 'Health' }))
  expect(screen.getByRole('status')).toHaveTextContent('console contract 0.6.0')
})

test('the health strip shows the latest sample and follows the live stream', async () => {
  const facade = renderWith(<HealthStrip />)
  expect(await screen.findByRole('status', { name: 'Host health' })).toHaveTextContent('CPU 24%')
  facade.emit(wireEvent('health', { tier: 'clean', data: { cpu: { usage_pct: 91 } } }))
  expect(await screen.findByText(/CPU 91%/)).toBeInTheDocument()
})

test('the health strip renders nothing when the server is not sampling', async () => {
  const facade = new MockFacade()
  facade.backend = {
    ...facade.backend,
    seams: [{ name: 'health', live: false, detail: 'this server is not sampling health' }],
  }
  renderWith(<HealthStrip />, facade)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('status', { name: 'Host health' })).not.toBeInTheDocument()
})

test('a recorded stall reads as a stuck planning turn, in the fields pymaxim records', async () => {
  const facade = new MockFacade()
  facade.healthSnapshot = {
    ...facade.healthSnapshot,
    stall_detection: true,
    stalls: [
      {
        ts: 1_760_000_000,
        kind: 'health_stall',
        data: { outstanding_s: 212.4, threshold_s: 180, wedged_s: null, loops: 1 },
      },
    ],
  }
  renderWith(<LogsSurface />, facade)
  await userEvent.click(await screen.findByRole('tab', { name: 'Health' }))
  const stalls = await screen.findByRole('region', { name: 'Stalls' })
  expect(stalls).toHaveTextContent(
    'planning turn stuck 212 s (threshold 180 s), no LLM call in flight',
  )
  expect(screen.queryByText(/Stall detection is off/)).not.toBeInTheDocument()
})

test('the health tab says when the server could not save every record', async () => {
  const facade = new MockFacade()
  facade.healthSnapshot = { ...facade.healthSnapshot, dropped_records: 4 }
  renderWith(<LogsSurface />, facade)
  await userEvent.click(await screen.findByRole('tab', { name: 'Health' }))
  expect(await screen.findByText(/4 health records could not be saved/)).toBeInTheDocument()
})
