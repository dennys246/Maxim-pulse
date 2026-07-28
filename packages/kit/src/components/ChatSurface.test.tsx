import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { FacadeProvider, MockFacade } from '../facade'
import { FacadeError } from '../facade/http'
import { ChatSurface } from './ChatSurface'

function renderChat(facade: MockFacade, campaign?: string) {
  return render(
    <FacadeProvider facade={facade}>
      <ChatSurface campaign={campaign} />
    </FacadeProvider>,
  )
}

test('talk 501 renders the gentle pending line, not an error', async () => {
  const facade = new MockFacade()
  facade.run = vi
    .fn()
    .mockRejectedValue(new FacadeError(501, 'Seam not yet implemented', '/api/run'))
  renderChat(facade)
  await userEvent.type(screen.getByLabelText('Say something to Maxim'), 'hello there')
  await userEvent.click(screen.getByLabelText('Send'))
  expect(screen.getByText(/you ·/)).toBeInTheDocument()
  expect(screen.getByText('hello there')).toBeInTheDocument()
  expect(
    await screen.findByText(/arrives with the event bridge. 🎲 Adventure works today/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
})

test('adventure with a campaign starts and reports the run id', async () => {
  const facade = new MockFacade()
  renderChat(facade, '/tmp/darkened_cavern_v1.yaml')
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(await screen.findByText(/Adventure started · run mock-session/)).toBeInTheDocument()
  expect(facade.requests).toContainEqual({
    endpoint: '/api/run',
    body: { mode: 'adventure', campaign: '/tmp/darkened_cavern_v1.yaml' },
  })
})

test('422 (e.g. missing campaign) surfaces the server detail', async () => {
  const facade = new MockFacade()
  facade.run = vi
    .fn()
    .mockRejectedValue(new FacadeError(422, "mode='adventure' requires 'campaign'", '/api/run'))
  renderChat(facade)
  await userEvent.click(screen.getByLabelText('Start Adventure'))
  expect(await screen.findByText(/Couldn’t start:.*requires 'campaign'/)).toBeInTheDocument()
})

test('/ws events land in the bio ticker', async () => {
  const facade = new MockFacade()
  renderChat(facade)
  act(() => {
    facade.emit({ kind: 'heartbeat', ts: 1 })
    facade.emit({ kind: 'nac_reward', ts: 2, agent_id: 'console' })
  })
  await userEvent.click(screen.getByText(/bio activity \(2\)/))
  const ticker = screen.getByTestId('bio-ticker')
  expect(ticker).toHaveTextContent('heartbeat')
  expect(ticker).toHaveTextContent('nac_reward · console')
})
