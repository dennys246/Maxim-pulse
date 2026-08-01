import { FacadeProvider, MockFacade } from '@maxim/kit'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

function renderApp() {
  return render(
    <FacadeProvider facade={new MockFacade()}>
      <App />
    </FacadeProvider>,
  )
}

test('the robot page is chat-first: the three flagship actions over one agent', () => {
  renderApp()
  // Talk is the input itself; Adventure and Rest are the buttons beside it
  expect(screen.getByLabelText('Say something to Maxim')).toBeInTheDocument()
  expect(screen.getByLabelText('Start Adventure')).toBeInTheDocument()
  expect(screen.getByLabelText('Rest')).toBeInTheDocument()
})

test('✦ opens what Maxim remembers', async () => {
  renderApp()
  await userEvent.click(screen.getByLabelText('What Maxim remembers'))
  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
})

test('setup stays re-openable from the gear', async () => {
  renderApp()
  await userEvent.click(screen.getByLabelText('Settings'))
  expect(screen.getByText('Where should Maxim think?')).toBeInTheDocument()
})

test('consumer panel set: no bio-activity or thinking rails on the robot page', () => {
  renderApp()
  expect(screen.queryByLabelText('Open Bio activity')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Open Thinking')).not.toBeInTheDocument()
  expect(screen.getByLabelText('right panel rail')).toBeInTheDocument()
})
