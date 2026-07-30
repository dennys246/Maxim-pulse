import { render, screen } from '@testing-library/react'
import { FacadeProvider, MockFacade } from '../facade'
import { DiagnosticsPanel } from './DiagnosticsPanel'

test('groups rows, floats problems to the top, and shows the fix', async () => {
  const facade = new MockFacade()
  facade.diagnostic = {
    platform: { os: 'macos', os_release: '26.5', arch: 'arm64', runtime: 'native' },
    sections: [
      { name: 'python', status: 'ok', detail: '3.12.0', extra: { group: 'environment' } },
      {
        name: 'leader reachable',
        status: 'fail',
        detail: 'connection refused',
        extra: { group: 'mesh', fix: 'Run `maxim` on your leader box' },
      },
      { name: 'disk', status: 'ok', detail: 'plenty', extra: { group: 'environment' } },
    ],
  }
  render(
    <FacadeProvider facade={facade}>
      <DiagnosticsPanel />
    </FacadeProvider>,
  )
  const panel = await screen.findByTestId('diagnostics-panel')
  const groups = panel.querySelectorAll('h4')
  // the group containing a failure sorts first
  expect(groups[0]).toHaveTextContent('mesh')
  expect(panel).toHaveTextContent('connection refused')
  // the fix is shown for the failing row
  expect(panel).toHaveTextContent('Run `maxim` on your leader box')
})

test('an ok-only report still renders every check', async () => {
  const facade = new MockFacade()
  render(
    <FacadeProvider facade={facade}>
      <DiagnosticsPanel />
    </FacadeProvider>,
  )
  expect(await screen.findByTestId('diagnostics-panel')).toHaveTextContent('placement')
})

test('multi-line fix hints keep their line breaks (real payloads carry shell snippets)', async () => {
  const facade = new MockFacade()
  const fix = 'echo KEY > ~/.config/maxim/api_key\nchmod 0600 ~/.config/maxim/api_key'
  facade.diagnostic = {
    platform: { os: 'macos', os_release: '26.5', arch: 'arm64', runtime: 'native' },
    sections: [
      {
        name: 'lanes.large.remote_api_key_ref',
        status: 'warn',
        detail: 'inline key',
        extra: { group: 'Resolved Config', fix },
      },
    ],
  }
  render(
    <FacadeProvider facade={facade}>
      <DiagnosticsPanel />
    </FacadeProvider>,
  )
  const hint = await screen.findByText(/chmod 0600/)
  expect(hint).toHaveClass('whitespace-pre-wrap')
  expect(hint.textContent).toContain('\n')
})
