import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { defaultParams, EFFECT_BY_ID, EFFECTS } from '@shared/effects'
import { LOOK_COLORS, newId, newLayer, newLook } from '@shared/show'
import type { Blend, Layer, Look, Mapping, Triggerable } from '@shared/types'
import { editLayer, editLook, useStore } from '../store'
import { ColorInput, Field, noteName, NumberInput, Section, Segmented, Select, Slider, TextInput, Toggle } from './ui'

const MAPPINGS: { value: Mapping; label: string }[] = [
  { value: 'fixture', label: 'Along each fixture' },
  { value: 'span', label: 'Through all fixtures, end to end' },
  { value: 'index', label: 'Fixture by fixture' },
  { value: 'stageX', label: 'Across the stage, left to right' },
  { value: 'stageY', label: 'From the floor up' },
  { value: 'stageZ', label: 'From back to front' }
]

const BLENDS: { value: Blend; label: string }[] = [
  { value: 'normal', label: 'Cover what is below' },
  { value: 'add', label: 'Add light' },
  { value: 'max', label: 'Brightest wins' },
  { value: 'multiply', label: 'Mask what is below' }
]

export const midiLabel = (look: Triggerable): string => (look.midi ? `${noteName(look.midi.note)} (${look.midi.note})` : '')

export function LookList() {
  const looks = useStore((s) => s.show.looks)
  const lookId = useStore((s) => s.lookId)
  const selectLook = useStore((s) => s.selectLook)
  const edit = useStore((s) => s.edit)
  const active = useStore((s) => s.status?.active)

  const add = () => {
    const look = newLook(`Look ${looks.length + 1}`, looks.length)
    edit((s) => ({ ...s, looks: [...s.looks, look] }))
    selectLook(look.id)
  }

  return (
    <aside className="panel left">
      <Section
        title="Looks"
        action={
          <button className="button small primary" onClick={add}>
            <Plus size={14} /> New look
          </button>
        }
      >
        {looks.length === 0 && <p className="empty">A look is what your lights do on one MIDI note: colours and effects on some or all fixtures.</p>}
        <ul className="list">
          {looks.map((l) => {
            const level = active?.find((a) => a.lookId === l.id)?.level ?? 0
            return (
              <li key={l.id}>
                <button className={`row look-row${l.id === lookId ? ' on' : ''}`} onClick={() => selectLook(l.id)}>
                  <span className="look-chip" style={{ background: l.color, opacity: 0.35 + 0.65 * Math.min(1, level * 2) }} />
                  <span className="row-name">{l.name}</span>
                  <span className="row-meta">{midiLabel(l)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>
    </aside>
  )
}

function TargetPicker({ layer, lookId }: { layer: Layer; lookId: string }) {
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)
  const toggle = (id: string) =>
    editLayer(lookId, layer.id, { targets: layer.targets.includes(id) ? layer.targets.filter((t) => t !== id) : [...layer.targets, id] })
  return (
    <div className="chips">
      <button className={`chip${layer.targets.length === 0 ? ' on' : ''}`} onClick={() => editLayer(lookId, layer.id, { targets: [] })}>
        All fixtures
      </button>
      {groups.map((g) => (
        <button key={g.id} className={`chip group${layer.targets.includes(g.id) ? ' on' : ''}`} onClick={() => toggle(g.id)}>
          {g.name}
        </button>
      ))}
      {fixtures.map((f) => (
        <button key={f.id} className={`chip${layer.targets.includes(f.id) ? ' on' : ''}`} onClick={() => toggle(f.id)}>
          {f.name}
        </button>
      ))}
    </div>
  )
}

function LayerEditor({ look, layer }: { look: Look; layer: Layer }) {
  const def = EFFECT_BY_ID.get(layer.effect)
  const setParam = (key: string, value: number | string | boolean) =>
    editLayer(look.id, layer.id, { params: { ...layer.params, [key]: value } }, `param-${layer.id}-${key}`)

  const changeEffect = (effect: string) => {
    const next = defaultParams(effect)
    // Keep the colours the user already chose where the new effect has the same parameter.
    for (const key of Object.keys(next)) if (typeof next[key] === 'string' && typeof layer.params[key] === 'string') next[key] = layer.params[key]
    editLayer(look.id, layer.id, { effect, params: next })
  }

  return (
    <>
      <Section title="Effect">
        <div className="effects">
          {EFFECTS.map((e) => (
            <button key={e.id} className={e.id === layer.effect ? 'on' : ''} title={e.hint} onClick={() => changeEffect(e.id)}>
              {e.name}
            </button>
          ))}
        </div>
        <div className="params">
          {def?.params.map((p) => {
            const v = layer.params[p.key] ?? p.default
            return (
              <Field key={p.key} label={p.label} wide>
                {p.type === 'color' ? (
                  <ColorInput value={String(v)} onChange={(c) => setParam(p.key, c)} />
                ) : p.type === 'toggle' ? (
                  <Toggle value={Boolean(v)} onChange={(b) => setParam(p.key, b)} label={v ? 'On' : 'Off'} />
                ) : (
                  <Slider value={Number(v)} min={p.min} max={p.max} step={p.step} unit={p.unit} onChange={(n) => setParam(p.key, n)} />
                )}
              </Field>
            )
          })}
        </div>
      </Section>

      <Section title="Where">
        <TargetPicker layer={layer} lookId={look.id} />
        <div className="form-grid">
          <Field label="Direction" wide>
            <Select value={layer.mapping} onChange={(mapping) => editLayer(look.id, layer.id, { mapping })} options={MAPPINGS} />
          </Field>
          <Field label="Mixing" wide>
            <Select value={layer.blend} onChange={(blend) => editLayer(look.id, layer.id, { blend })} options={BLENDS} />
          </Field>
          <Field label="Opacity" wide>
            <Slider value={layer.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => editLayer(look.id, layer.id, { opacity }, `opacity-${layer.id}`)} />
          </Field>
        </div>
      </Section>
    </>
  )
}

/** How a look or a chaser is started. `onEdit` receives the changed fields. */
export function TriggerEditor({ item, onEdit }: { item: Triggerable; onEdit: (patch: Partial<Triggerable>, key?: string) => void }) {
  const learning = useStore((s) => s.learning)
  const set = useStore((s) => s.set)
  const looks = useStore((s) => s.show.looks)
  const chasers = useStore((s) => s.show.chasers)
  const m = item.midi
  const others = m
    ? [...looks, ...chasers].filter((l) => l.id !== item.id && l.midi && l.midi.note === m.note && (l.midi.channel === 0 || m.channel === 0 || l.midi.channel === m.channel))
    : []
  const change = (patch: Partial<Triggerable>, key?: string) => onEdit(patch, key && `${key}-${item.id}`)

  return (
    <Section title="Trigger">
      <div className="trigger">
        {learning ? (
          <div className="learn-wait">
            <span className="lamp lit pulse" />
            Play the note in Reaper or on a keyboard…
            <button className="button small ghost" onClick={() => set({ learning: false })}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className={`note-badge${item.midi ? '' : ' none'}`}>{item.midi ? noteName(item.midi.note) : 'No note'}</div>
            <button className="button small primary" onClick={() => set({ learning: true })}>
              Learn from MIDI
            </button>
            {item.midi && (
              <button className="button small ghost" onClick={() => change({ midi: null })}>
                Clear
              </button>
            )}
          </>
        )}
      </div>
      {item.midi && !learning && (
        <div className="form-grid">
          <Field label="Note number">
            <NumberInput value={item.midi.note} min={0} max={127} onChange={(note) => change({ midi: { ...item.midi!, note: Math.round(note) } }, 'note')} />
          </Field>
          <Field label="Channel">
            <Select
              value={String(item.midi.channel)}
              onChange={(c) => change({ midi: { ...item.midi!, channel: Number(c) } })}
              options={[{ value: '0', label: 'Any' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
            />
          </Field>
        </div>
      )}
      {others.length > 0 && <p className="summary">Also triggers {others.map((l) => l.name).join(', ')}.</p>}
      <div className="form-grid">
        <Field label="Plays" wide>
          <Segmented
            value={item.triggerMode}
            onChange={(triggerMode) => change({ triggerMode })}
            options={[
              { value: 'hold', label: 'While the note is held' },
              { value: 'toggle', label: 'Note switches on / off' }
            ]}
          />
        </Field>
        <Toggle value={item.velocity} onChange={(velocity) => change({ velocity })} label="Velocity sets brightness" />
        <Toggle value={item.solo} onChange={(solo) => change({ solo })} label="Stops everything else that is playing" />
        <Field label="Fade in" wide>
          <Slider value={item.fadeIn} min={0} max={5000} step={50} format={(v) => (v === 0 ? 'Instant' : `${(v / 1000).toFixed(2)} s`)} onChange={(fadeIn) => change({ fadeIn }, 'fadeIn')} />
        </Field>
        <Field label="Fade out" wide>
          <Slider value={item.fadeOut} min={0} max={5000} step={50} format={(v) => (v === 0 ? 'Instant' : `${(v / 1000).toFixed(2)} s`)} onChange={(fadeOut) => change({ fadeOut }, 'fadeOut')} />
        </Field>
      </div>
    </Section>
  )
}

export function LookEditor() {
  const look = useStore((s) => s.show.looks.find((l) => l.id === s.lookId))
  const layerId = useStore((s) => s.layerId)
  const preview = useStore((s) => s.preview)
  const set = useStore((s) => s.set)
  const edit = useStore((s) => s.edit)
  const selectLook = useStore((s) => s.selectLook)
  const selectLayer = useStore((s) => s.selectLayer)
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)

  if (!look) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select a look on the left, or create a new one.</p>
      </aside>
    )
  }

  const layer = look.layers.find((l) => l.id === layerId) ?? look.layers.at(-1)
  const setLayers = (layers: Layer[]) => editLook(look.id, { layers })
  const move = (dir: -1 | 1) =>
    edit((s) => {
      const i = s.looks.findIndex((l) => l.id === look.id)
      const j = i + dir
      if (j < 0 || j >= s.looks.length) return s
      const looks = [...s.looks]
      ;[looks[i], looks[j]] = [looks[j], looks[i]]
      return { ...s, looks }
    })

  const targetSummary = (y: Layer): string => {
    if (y.targets.length === 0) return 'All fixtures'
    const names = y.targets.map((t) => groups.find((g) => g.id === t)?.name ?? fixtures.find((f) => f.id === t)?.name).filter(Boolean)
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
  }

  return (
    <aside className="panel right wide">
      <Section
        title="Look"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Shown on stage while you edit. Click to hide.' : 'Show on stage while editing'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon" title="Move up (drawn below later looks)" onClick={() => move(-1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" title="Move down (drawn on top)" onClick={() => move(1)}>
              <ArrowDown size={15} />
            </button>
            <button
              className="icon"
              title="Duplicate look"
              onClick={() => {
                const copy: Look = { ...look, id: newId(), name: `${look.name} copy`, midi: null, layers: look.layers.map((y) => ({ ...y, id: newId() })) }
                edit((s) => ({ ...s, looks: [...s.looks, copy] }))
                selectLook(copy.id)
              }}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon"
              title="Delete look"
              onClick={() => {
                edit((s) => ({
                  ...s,
                  looks: s.looks.filter((l) => l.id !== look.id),
                  // Steps that showed this look stay in place as dark steps, so chasers keep their timing.
                  chasers: s.chasers.map((c) => ({ ...c, steps: c.steps.map((step) => (step.lookId === look.id ? { ...step, lookId: '' } : step)) }))
                }))
                selectLook(null)
              }}
            >
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={look.name} onChange={(name) => editLook(look.id, { name })} />
          </Field>
          <div className="look-colors wide">
            {LOOK_COLORS.map((c) => (
              <button key={c} className={c === look.color ? 'on' : ''} style={{ background: c }} title="Label colour" onClick={() => editLook(look.id, { color: c })} />
            ))}
          </div>
        </div>
      </Section>

      <TriggerEditor item={look} onEdit={(patch, key) => editLook(look.id, patch, key)} />

      <Section
        title="Layers"
        action={
          <button
            className="button small ghost"
            onClick={() => {
              const y = newLayer('solid')
              setLayers([...look.layers, y])
              selectLayer(y.id)
            }}
          >
            <Plus size={14} /> Add layer
          </button>
        }
      >
        {look.layers.length === 0 && <p className="empty">This look is empty. Add a layer to put an effect on your fixtures.</p>}
        <ul className="list layers">
          {/* Shown top-most first, like layers in a drawing app. */}
          {[...look.layers].reverse().map((y) => {
            const index = look.layers.indexOf(y)
            const swap = (j: number) => {
              const layers = [...look.layers]
              ;[layers[index], layers[j]] = [layers[j], layers[index]]
              setLayers(layers)
            }
            return (
              <li key={y.id} className={`row layer-row${y.id === layer?.id ? ' on' : ''}`} onClick={() => selectLayer(y.id)}>
                <span className="row-name">{EFFECT_BY_ID.get(y.effect)?.name ?? y.effect}</span>
                <span className="row-meta">{targetSummary(y)}</span>
                <button className="icon subtle" title="Move up" disabled={index === look.layers.length - 1} onClick={(e) => (e.stopPropagation(), swap(index + 1))}>
                  <ArrowUp size={13} />
                </button>
                <button className="icon subtle" title="Move down" disabled={index === 0} onClick={(e) => (e.stopPropagation(), swap(index - 1))}>
                  <ArrowDown size={13} />
                </button>
                <button className="icon subtle" title="Delete layer" onClick={(e) => (e.stopPropagation(), setLayers(look.layers.filter((x) => x.id !== y.id)))}>
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      {layer && <LayerEditor look={look} layer={layer} />}
    </aside>
  )
}
