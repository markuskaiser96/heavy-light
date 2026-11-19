import { Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { COLOR_ORDERS, genericPixelKey, isOflFixture, makeGenericPixelFixture, resolveMode, type ColorOrder, type OflFixture } from '@shared/ofl'
import { layoutSegments } from '@shared/patch'
import { LIBRARY, newId, nextHost } from '@shared/show'
import type { FixtureInstance, Show } from '@shared/types'
import { useStore } from '../store'
import { Field, isIPv4, NumberInput, Segmented, Select, TextInput } from './ui'

type Kind = 'pixels' | 'library'

/** Suggests where the next fixture goes: one address after the highest host, one universe after the highest universe. */
function suggestNetwork(show: Show): { host: string; universe: number } {
  if (show.fixtures.length === 0) return { host: '192.168.0.201', universe: 1 }
  const last = show.fixtures.reduce((a, b) => (b.universe > a.universe ? b : a))
  return { host: nextHost(last.host, 1), universe: last.universe + 1 }
}

export function AddFixtureDialog({ onClose }: { onClose: () => void }) {
  const show = useStore((s) => s.show)
  const suggestion = useMemo(() => suggestNetwork(show), [show])

  const [kind, setKind] = useState<Kind>('pixels')
  const [name, setName] = useState('Beam')
  const [count, setCount] = useState(1)
  const [width, setWidth] = useState(96)
  const [height, setHeight] = useState(1)
  const [order, setOrder] = useState<ColorOrder>('RGB')
  const [length, setLength] = useState(1)
  const [host, setHost] = useState(suggestion.host)
  const [universe, setUniverse] = useState(suggestion.universe)
  const [address, setAddress] = useState(1)
  const [sameNode, setSameNode] = useState<'each' | 'shared'>('each')
  const [imported, setImported] = useState<{ key: string; maker: string; fixture: OflFixture }[]>([])
  const [libraryKey, setLibraryKey] = useState(LIBRARY[0].key)
  const [modeName, setModeName] = useState(LIBRARY[0].fixture.modes[0].name)
  const [error, setError] = useState<string | null>(null)

  const library = [...LIBRARY, ...imported]
  const chosen = library.find((l) => l.key === libraryKey) ?? library[0]

  const definition = kind === 'pixels' ? makeGenericPixelFixture(width, height, order) : chosen.fixture
  const mode = kind === 'pixels' ? order : modeName
  const resolved = useMemo(() => {
    try {
      return resolveMode(definition, mode)
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, width, height, order, libraryKey, modeName])
  const channels = resolved?.channelCount ?? 0
  const universesEach = Math.max(1, layoutSegments(channels, 0, address, resolved?.channelsPerPixel ?? 0).length)

  const importFiles = async () => {
    const files = await window.heavy.importFixtures()
    const added: typeof imported = []
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(file.text)
        if (!isOflFixture(parsed)) throw new Error('not an Open Fixture Library fixture')
        added.push({ key: `import/${file.name}`, maker: 'Imported', fixture: parsed })
      } catch (err) {
        setError(`${file.name}.json could not be imported: ${(err as Error).message}`)
      }
    }
    if (added.length) {
      setImported((list) => [...list.filter((l) => !added.some((a) => a.key === l.key)), ...added])
      setLibraryKey(added[0].key)
      setModeName(added[0].fixture.modes[0].name)
      setName(added[0].fixture.name)
    }
  }

  const add = () => {
    if (!isIPv4(host)) return setError('Enter the fixture’s IP address, for example 192.168.0.201.')
    if (!resolved) return setError('This fixture type could not be read.')
    const key = kind === 'pixels' ? genericPixelKey(width, height, order) : chosen.key
    const state = useStore.getState()
    const taken = state.show.fixtures.filter((f) => f.name === name || f.name.startsWith(`${name} `)).length
    const created: FixtureInstance[] = []
    let nextAddress = address
    for (let i = 0; i < count; i++) {
      const shared = sameNode === 'shared'
      // Upright strips stand side by side; everything else is laid out flat along the front.
      const upright = kind === 'pixels' && height === 1
      created.push({
        id: newId(),
        name: count > 1 || taken > 0 ? `${name} ${taken + i + 1}` : name,
        definition: key,
        mode,
        host: shared ? host : nextHost(host, i),
        universe: shared ? universe : universe + i * universesEach,
        address: shared ? nextAddress : address,
        position: { x: +((i - (count - 1) / 2) * 0.5).toFixed(2), y: upright ? length / 2 : 1, z: 1 },
        rotation: { x: 0, y: 0, z: upright ? 90 : 0 },
        size: kind === 'pixels' ? { w: length, h: height > 1 ? +((length / Math.max(1, width - 1)) * (height - 1)).toFixed(3) : 0 } : { w: resolved.gridW > 1 ? 1 : 0.25, h: 0.15 }
      })
      if (shared) nextAddress += channels
    }
    state.editNow((s) => ({ ...s, definitions: { ...s.definitions, [key]: definition }, fixtures: [...s.fixtures, ...created] }))
    state.selectFixtures(created.map((f) => f.id))
    onClose()
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Add fixtures">
        <header>
          <h2>Add fixtures</h2>
          <button className="icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k)
            setName(k === 'pixels' ? 'Beam' : chosen.fixture.name)
            setError(null)
          }}
          options={[
            { value: 'pixels', label: 'RGB pixels (strip, panel, matrix)' },
            { value: 'library', label: 'From the fixture library' }
          ]}
        />

        {kind === 'pixels' ? (
          <div className="form-grid">
            <Field label="Pixels wide">
              <NumberInput value={width} onChange={(v) => setWidth(Math.round(v))} min={1} max={2048} />
            </Field>
            <Field label="Rows">
              <NumberInput value={height} onChange={(v) => setHeight(Math.round(v))} min={1} max={256} />
            </Field>
            <Field label="Colour order">
              <Select value={order} onChange={setOrder} options={COLOR_ORDERS.map((o) => ({ value: o, label: o }))} />
            </Field>
            <Field label="Length">
              <NumberInput value={length} onChange={setLength} min={0.05} max={20} step={0.1} unit="m" />
            </Field>
            <p className="form-note">For WLED keep RGB here. WLED applies its own colour order from the LED settings.</p>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Fixture" wide>
              <Select
                value={chosen.key}
                onChange={(k) => {
                  const next = library.find((l) => l.key === k)!
                  setLibraryKey(k)
                  setModeName(next.fixture.modes[0].name)
                  setName(next.fixture.name)
                }}
                options={library.map((l) => ({ value: l.key, label: `${l.maker} ${l.fixture.name}` }))}
              />
            </Field>
            <Field label="Mode" wide>
              <Select value={modeName} onChange={setModeName} options={chosen.fixture.modes.map((m) => ({ value: m.name, label: `${m.name} (${m.channels.length >= 1 ? resolveSafe(chosen.fixture, m.name) : 0} ch)` }))} />
            </Field>
            <button className="button ghost wide" onClick={() => void importFiles()}>
              <Upload size={14} /> Import Open Fixture Library file…
            </button>
            <p className="form-note">
              Any fixture from open-fixture-library.org works: download it there as “Open Fixture Library JSON” and import the file.
              {resolved && resolved.unsupported.length > 0 && ` HeavyLight drives colour and dimmer channels for now; ${resolved.unsupported.length} other channel${resolved.unsupported.length === 1 ? ' stays' : 's stay'} at the default.`}
            </p>
          </div>
        )}

        <div className="form-grid">
          <Field label="Name">
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label="How many">
            <NumberInput value={count} onChange={(v) => setCount(Math.round(v))} min={1} max={64} />
          </Field>
          <Field label="IP address">
            <TextInput value={host} onChange={setHost} validate={isIPv4} />
          </Field>
          <Field label="Universe">
            <NumberInput value={universe} onChange={(v) => setUniverse(Math.round(v))} min={0} max={32767} />
          </Field>
          <Field label="Start address">
            <NumberInput value={address} onChange={(v) => setAddress(Math.round(v))} min={1} max={512} />
          </Field>
          {count > 1 && (
            <Field label="Wiring" wide>
              <Segmented
                value={sameNode}
                onChange={setSameNode}
                options={[
                  { value: 'each', label: 'Each has its own IP and universe' },
                  { value: 'shared', label: 'All on one DMX line' }
                ]}
              />
            </Field>
          )}
        </div>

        <p className="summary">
          {count} × {channels} channel{channels === 1 ? '' : 's'}
          {count > 1 && sameNode === 'each' && `, ${host} to ${nextHost(host, count - 1)}, universes ${universe} to ${universe + (count - 1) * universesEach + universesEach - 1}`}
          {count > 1 && sameNode === 'shared' && `, addresses ${address} to ${address + count * channels - 1} on ${host}`}
        </p>
        {error && <p className="error">{error}</p>}

        <footer>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={add}>
            Add {count === 1 ? 'fixture' : `${count} fixtures`}
          </button>
        </footer>
      </div>
    </div>
  )
}

function resolveSafe(fixture: OflFixture, mode: string): number {
  try {
    return resolveMode(fixture, mode).channelCount
  } catch {
    return 0
  }
}
