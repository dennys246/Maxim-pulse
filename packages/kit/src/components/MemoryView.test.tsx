import { render, screen } from '@testing-library/react'
import { FacadeProvider, MockFacade } from '../facade'
import { LiveStatusChip } from './LiveStatusChip'
import { MemoryView } from './MemoryView'
import { RunSurface } from './RunSurface'
import userEvent from '@testing-library/user-event'

function withFacade(facade: MockFacade, ui: React.ReactElement) {
  return render(<FacadeProvider facade={facade}>{ui}</FacadeProvider>)
}

test('MemoryView: empty bio-stack renders the honest empty state', async () => {
  withFacade(new MockFacade(), <MemoryView />)
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
})

test('MemoryView: renders the curated blend as shaped by RECALL', async () => {
  const facade = new MockFacade()
  facade.recallSnapshot = {
    name: 'Denny',
    player_model: ['cautious', 'roleplayer'],
    story_memories: [
      { summary: 'Your rogue betrayed the party', when: 'last week', salience: 0.9 },
    ],
    preferences: [{ about: 'prefers stealth over combat', learned_from: 'Adventure' }],
  }
  withFacade(facade, <MemoryView />)
  expect(await screen.findByText('Denny')).toBeInTheDocument()
  expect(screen.getByText(/cautious · roleplayer/)).toBeInTheDocument()
  expect(screen.getByText(/rogue betrayed the party/)).toBeInTheDocument()
  expect(screen.getByText(/stealth over combat/)).toBeInTheDocument()
})

test('LiveStatusChip: renders placement detail + platform with worst-section tone', async () => {
  const facade = new MockFacade()
  withFacade(facade, <LiveStatusChip />)
  expect(await screen.findByText(/thinking on mesh \(mock\) · mockos\/arm64/)).toBeInTheDocument()
})

test('RunSurface: starting a mode shows the RunAccepted state', async () => {
  const facade = new MockFacade()
  withFacade(facade, <RunSurface modes={['adventure', 'talk', 'rest']} campaign="seed-1" />)
  await userEvent.click(screen.getByRole('button', { name: /Adventure/ }))
  expect(await screen.findByText(/started/)).toBeInTheDocument()
  expect(screen.getByText(/run mock-session/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/run',
    body: { mode: 'adventure', campaign: 'seed-1' },
  })
})
