import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BodyPanelView,
  ComponentPicker,
  EmbodimentChip,
  PartNode,
  SensationFeed,
  SensorRow,
} from './BodyViews'
import {
  applyBodyChange,
  comfort,
  rangeFraction,
  type BodyChange,
  type BodyView,
  type ComponentOption,
  type PartView,
  type SensationView,
  type SensorView,
} from './model'

const temp: SensorView = {
  name: 'core_temperature',
  unit: '°C',
  range: [30, 45],
  value: 37,
  drive: { mode: 'homeostatic', setPoint: 37, comfortBand: [36, 38], pressure: 0 },
}

const hand: PartView = {
  path: ['infant_humanoid', 'left_hand'],
  name: 'left_hand',
  kind: 'limb',
  sensors: [{ name: 'arms.thermal', unit: '°C', range: [0, 60], value: 30, drive: null }],
  modulators: [
    {
      name: 'grip',
      integrity: 1,
      abilities: [{ name: 'grasp', available: null, reason: null }],
    },
  ],
  failures: [],
  children: [],
}

const body: BodyView = {
  embodiment: 'simulated',
  ref: 'bodies/infant_humanoid',
  generation: 3,
  root: {
    path: ['infant_humanoid'],
    name: 'infant_humanoid',
    kind: 'body',
    sensors: [temp],
    modulators: [],
    failures: [],
    children: [hand],
  },
}

const noChange: Omit<BodyChange, 'generation'> = {
  readings: [],
  failuresEntered: [],
  failuresCleared: [],
  availability: [],
}

const sensation = (over: Partial<SensationView> = {}): SensationView => ({
  at: '2026-10-26T12:00:00Z',
  origin: 'body',
  modality: 'touch',
  path: ['infant_humanoid', 'left_hand'],
  intensity: 0.4,
  salience: 0.5,
  pain: null,
  escalated: null,
  escalationReason: null,
  summary: 'something warm on the hand',
  ...over,
})

const bodies: ComponentOption[] = [
  {
    ref: 'bodies/infant_humanoid',
    name: 'Infant humanoid',
    description: 'hunger, thirst, temperature',
    source: 'bundled',
    valid: true,
  },
  {
    ref: 'bodies/my_crab',
    name: 'My crab',
    description: 'eight legs',
    source: 'user',
    valid: false,
  },
]

describe('applyBodyChange', () => {
  test('patches a reading by path segments (a dotted sensor name is one name, not a path)', () => {
    const next = applyBodyChange(body, {
      ...noChange,
      generation: 3,
      readings: [{ path: ['infant_humanoid', 'left_hand'], sensor: 'arms.thermal', value: 41 }],
    })
    expect(next?.root?.children[0]?.sensors[0]?.value).toBe(41)
    expect(body.root?.children[0]?.sensors[0]?.value).toBe(30) // the snapshot is never mutated
  })

  test('another generation means refetch, never a patch', () => {
    expect(applyBodyChange(body, { ...noChange, generation: 4 })).toBeNull()
  })

  test('a path the snapshot does not know means refetch', () => {
    const change = {
      ...noChange,
      generation: 3,
      readings: [{ path: ['infant_humanoid', 'tail'], sensor: 'x', value: 1 }],
    }
    expect(applyBodyChange(body, change)).toBeNull()
  })

  test('failures enter and clear; availability follows the server, including back to null', () => {
    const path = ['infant_humanoid', 'left_hand']
    const failing = applyBodyChange(body, {
      ...noChange,
      generation: 3,
      failuresEntered: [{ path, name: 'burn', pain: 0.6 }],
      availability: [
        { path, modulator: 'grip', ability: 'grasp', available: false, reason: 'burned' },
      ],
    })
    const part = failing?.root?.children[0]
    expect(part?.failures).toEqual([{ name: 'burn', pain: 0.6 }])
    expect(part?.modulators[0]?.abilities[0]).toEqual({
      name: 'grasp',
      available: false,
      reason: 'burned',
    })

    const healed = applyBodyChange(failing as BodyView, {
      ...noChange,
      generation: 3,
      failuresCleared: [{ path, name: 'burn' }],
      availability: [{ path, modulator: 'grip', ability: 'grasp', available: null, reason: null }],
    })
    expect(healed?.root?.children[0]?.failures).toEqual([])
    expect(healed?.root?.children[0]?.modulators[0]?.abilities[0]?.available).toBeNull()
  })

  test('a body-less snapshot cannot be patched', () => {
    const none: BodyView = { embodiment: 'none', ref: null, generation: 1, root: null }
    expect(applyBodyChange(none, { ...noChange, generation: 1 })).toBeNull()
  })
})

test('rangeFraction places a value, clamps it, and refuses what it cannot place', () => {
  expect(rangeFraction(37.5, [30, 45])).toBeCloseTo(0.5)
  expect(rangeFraction(99, [30, 45])).toBe(1)
  expect(rangeFraction(null, [30, 45])).toBeNull()
  expect(rangeFraction(Number.NaN, [30, 45])).toBeNull()
  expect(rangeFraction(1, [5, 5])).toBeNull()
})

test('comfort needs both a band and a reading', () => {
  expect(comfort(temp)).toBe('inside')
  expect(comfort({ ...temp, value: 39 })).toBe('outside')
  expect(comfort({ ...temp, value: null })).toBeNull()
  expect(comfort({ ...temp, drive: null })).toBeNull()
})

test('the embodiment chip says what is real', () => {
  const { rerender } = render(<EmbodimentChip embodiment="simulated" />)
  expect(screen.getByRole('note')).toHaveTextContent('Simulated body')
  expect(screen.getByRole('note')).toHaveAccessibleName(/nothing moves/)
  rerender(<EmbodimentChip embodiment="hardware" />)
  expect(screen.getByRole('note')).toHaveTextContent('Live hardware')
  rerender(<EmbodimentChip embodiment="none" />)
  expect(screen.getByRole('note')).toHaveTextContent('No body')
})

test('a sensor shows its value against its comfort band, and says when it cannot read', () => {
  const { rerender } = render(
    <ul>
      <SensorRow sensor={{ ...temp, value: 39.25 }} />
    </ul>,
  )
  expect(screen.getByText(/39\.25 °C · outside comfort/)).toBeInTheDocument()
  expect(screen.getByTestId('comfort-band')).toBeInTheDocument()
  rerender(
    <ul>
      <SensorRow sensor={{ ...temp, value: null }} />
    </ul>,
  )
  expect(screen.getByText('unreadable')).toBeInTheDocument()
})

test('an ability with availability null makes no claim; an unavailable one says why', () => {
  const { rerender } = render(<PartNode part={hand} />)
  const grasp = screen.getByText('grasp')
  expect(grasp.className).not.toMatch(/line-through|border-ok/)
  rerender(
    <PartNode
      part={{
        ...hand,
        modulators: [
          {
            name: 'grip',
            integrity: 0.5,
            abilities: [{ name: 'grasp', available: false, reason: 'burned' }],
          },
        ],
      }}
    />,
  )
  expect(screen.getByText(/unavailable: burned/)).toBeInTheDocument()
  expect(screen.getByText(/50% intact/)).toBeInTheDocument()
})

describe('SensationFeed', () => {
  test('escalated null claims nothing about attention; true and false say so', () => {
    const { rerender } = render(<SensationFeed sensations={[sensation()]} />)
    expect(screen.queryByText(/reached attention|filtered out/)).not.toBeInTheDocument()
    rerender(
      <SensationFeed
        sensations={[sensation({ escalated: true }), sensation({ escalated: false })]}
      />,
    )
    expect(screen.getByText('reached attention')).toBeInTheDocument()
    expect(screen.getByText('filtered out')).toBeInTheDocument()
  })

  test('newest first; lab input is badged; an unknown modality renders as given', () => {
    render(
      <SensationFeed
        sensations={[
          sensation({ summary: 'first' }),
          sensation({ summary: 'second', origin: 'lab', modality: 'echolocation' }),
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'Sensations' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('second')
    expect(items[0]).toHaveTextContent('Lab')
    expect(items[0]).toHaveTextContent('echolocation')
    expect(items[1]).toHaveTextContent('first')
  })

  test('a summary is text, never markup', () => {
    const { container } = render(
      <SensationFeed sensations={[sensation({ summary: '<img src=x onerror="alert(1)">' })]} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
  })
})

test('the dropdown badges a user body until it validates, and reports a None choice as null', async () => {
  const onChange = vi.fn()
  render(
    <ComponentPicker
      label="Scene"
      options={bodies}
      value="bodies/infant_humanoid"
      onChange={onChange}
      noneLabel="None"
    />,
  )
  expect(screen.getByRole('option', { name: 'My crab · yours · unvalidated' })).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Scene'), 'None')
  expect(onChange).toHaveBeenLastCalledWith(null)
})

describe('BodyPanelView', () => {
  const view = (over: Partial<Parameters<typeof BodyPanelView>[0]> = {}) => (
    <BodyPanelView
      body={body}
      sensations={[sensation()]}
      bodies={bodies}
      selected={body.ref}
      onSelect={() => {}}
      {...over}
    />
  )

  test('an embodied Maxim shows its tree and what it sensed', () => {
    render(view())
    expect(screen.getByText('core_temperature')).toBeInTheDocument()
    expect(screen.getByText('something warm on the hand')).toBeInTheDocument()
  })

  test('a body-less Maxim says so and shows no sensation feed', () => {
    render(
      view({ body: { embodiment: 'none', ref: null, generation: 1, root: null }, selected: null }),
    )
    expect(screen.getByText(/no body in this session/)).toBeInTheDocument()
    expect(screen.queryByLabelText('What Maxim sensed')).not.toBeInTheDocument()
  })

  test('picking another body PREVIEWS it and says the live body has not changed', () => {
    render(
      view({
        selected: 'bodies/my_crab',
        preview: { ...hand, path: ['my_crab'], name: 'my_crab' },
      }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('does not change until it is restarted')
    expect(screen.getByText('my_crab')).toBeInTheDocument()
    expect(screen.queryByText('core_temperature')).not.toBeInTheDocument()
  })

  test('loading', () => {
    render(view({ body: null }))
    expect(screen.getByText('Loading the body…')).toBeInTheDocument()
  })
})
