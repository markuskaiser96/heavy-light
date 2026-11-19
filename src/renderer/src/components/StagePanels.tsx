import { Box, Copy, Drum, Guitar, MicVocal, Piano, Plus, Speaker, Trash2, Users, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { PROP_TYPES, newProp, propType } from '@shared/props'
import { newId } from '@shared/show'
import type { FixtureInstance, PropKind, StageProp, Vec3 } from '@shared/types'
import { deleteSelection, duplicateSelection, place, type Placed } from '../placement'
import { editFixture, editProp, useStore } from '../store'
import { AddFixtureDialog } from './AddFixtureDialog'
import { usePatch } from './Stage3D'
import { Field, isIPv4, NumberInput, Section, Select, TextInput } from './ui'

export function FixtureList() {
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)
  const selected = useStore((s) => s.selectedFixtures)
  const select = useStore((s) => s.selectFixtures)
  const edit = useStore((s) => s.edit)
  const targets = useStore((s) => s.status?.targets)
  const [adding, setAdding] = useState(false)
  const patch = usePatch()

  const click = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selected.length) {
      const a = fixtures.findIndex((f) => f.id === selected.at(-1))
      const b = fixtures.findIndex((f) => f.id === id)
      select(fixtures.slice(Math.min(a, b), Math.max(a, b) + 1).map((f) => f.id))
    } else if (e.metaKey || e.ctrlKey) useStore.getState().set({ selectedFixtures: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] })
    else select([id])
  }

  const makeGroup = () => edit((s) => ({ ...s, groups: [...s.groups, { id: newId(), name: `Group ${s.groups.length + 1}`, fixtureIds: selected }] }))

  return (
    <aside className="panel left">
      <Section
        title="Fixtures"
        action={
          <button className="button small primary" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add
          </button>
        }
      >
        {fixtures.length === 0 && <p className="empty">No fixtures yet. Add your strips, panels or DMX fixtures to start.</p>}
        <ul className="list">
          {fixtures.map((f) => {
            const failing = targets?.some((t) => t.host === f.host && t.error)
            const pf = patch.byId.get(f.id)
            return (
              <li key={f.id}>
                <button className={`row${selected.includes(f.id) ? ' on' : ''}`} onClick={(e) => click(f.id, e)}>
                  <span className={`dot${failing ? ' bad' : ''}`} title={failing ? 'Cannot be reached' : undefined} />
                  <span className="row-name">{f.name}</span>
                  <span className="row-meta">
                    {f.host.split('.').slice(-1)[0]} / {f.universe}.{f.address}
                    {pf ? '' : ' !'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        title="Groups"
        action={
          <button className="button small ghost" disabled={selected.length < 2} title="Group the selected fixtures" onClick={makeGroup}>
            <Users size={14} /> Group selection
          </button>
        }
      >
        {groups.length === 0 && <p className="empty">Select several fixtures and group them to address them together in looks.</p>}
        <ul className="list">
          {groups.map((g) => (
            <li key={g.id} className="row group-row">
              <button className="row-name link" title="Select these fixtures" onClick={() => select(g.fixtureIds.filter((id) => fixtures.some((f) => f.id === id)))}>
                <TextInputInline value={g.name} onChange={(name) => edit((s) => ({ ...s, groups: s.groups.map((x) => (x.id === g.id ? { ...x, name } : x)) }))} />
              </button>
              <span className="row-meta">{g.fixtureIds.length}</span>
              <button
                className="icon subtle"
                title="Delete group"
                onClick={() =>
                  edit((s) => ({
                    ...s,
                    groups: s.groups.filter((x) => x.id !== g.id),
                    looks: s.looks.map((l) => ({ ...l, layers: l.layers.map((y) => ({ ...y, targets: y.targets.filter((t) => t !== g.id) })) }))
                  }))
                }
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <PropList />
      {adding && <AddFixtureDialog onClose={() => setAdding(false)} />}
    </aside>
  )
}

const PROP_ICONS: Record<PropKind, LucideIcon> = {
  singer: MicVocal,
  guitarist: Guitar,
  bassist: Guitar,
  keyboardist: Piano,
  drummer: Drum,
  riser: Box,
  monitor: Speaker,
  truss: TrussIcon as LucideIcon
}

/** Side view of a piece of truss: two chords with zigzag bracing. */
function TrussIcon({ size = 24 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h20M2 16h20M2 16l5-8 5 8 5-8 5 8" />
    </svg>
  )
}

/** Musicians, risers, monitors and truss: scenery that makes the 3D stage easier to read. */
function PropList() {
  const props = useStore((s) => s.show.props)
  const selected = useStore((s) => s.selectedProps)
  const select = useStore((s) => s.selectProps)
  const [menu, setMenu] = useState(false)

  const add = (kind: PropKind) => {
    const s = useStore.getState()
    const type = propType(kind)
    const same = s.show.props.filter((p) => p.kind === kind).length
    // New things appear at the front of the stage, next to each other, so they do not hide one another.
    const prop = newProp(kind, newId(), same === 0 ? type.label : `${type.label} ${same + 1}`, { x: +((same % 5) * 0.6).toFixed(2), z: type.person ? 1 : 0 })
    s.edit((show) => ({ ...show, props: [...show.props, prop] }))
    select([prop.id])
    setMenu(false)
  }

  const click = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selected.length) {
      const a = props.findIndex((p) => p.id === selected.at(-1))
      const b = props.findIndex((p) => p.id === id)
      select(props.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id))
    } else if (e.metaKey || e.ctrlKey) useStore.getState().set({ selectedProps: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] })
    else select([id])
  }

  return (
    <Section
      title="Stage objects"
      action={
        <span className="menu-anchor">
          <button className="button small ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Plus size={14} /> Add
          </button>
          {menu && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu(false)} />
              <div className="menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}>
                {(['Band', 'Stage'] as const).map((group) => (
                  <div key={group}>
                    <div className="menu-title">{group}</div>
                    {PROP_TYPES.filter((t) => t.group === group).map((t) => {
                      const Icon = PROP_ICONS[t.kind]
                      return (
                        <button key={t.kind} role="menuitem" onClick={() => add(t.kind)}>
                          <Icon size={15} /> {t.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </span>
      }
    >
      {props.length === 0 && <p className="empty">Add the band, risers, monitors or truss to see the lights in proportion. They only show in the 3D view.</p>}
      <ul className="list">
        {props.map((p) => {
          const Icon = PROP_ICONS[p.kind]
          return (
            <li key={p.id}>
              <button className={`row${selected.includes(p.id) ? ' on' : ''}`} onClick={(e) => click(p.id, e)}>
                <span className="row-icon">
                  <Icon size={14} />
                </span>
                <span className="row-name">{p.name}</span>
                <span className="row-meta">{propType(p.kind).label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** Looks like plain text until double-clicked. */
function TextInputInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (!editing) return <span onDoubleClick={() => setEditing(true)}>{value}</span>
  return (
    <input
      className="input inline"
      autoFocus
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (e.target.value.trim()) onChange(e.target.value.trim())
        setEditing(false)
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
    />
  )
}

function Vec3Fields({ label, value, onChange, step, unit }: { label: string; value: Vec3; onChange: (axis: keyof Vec3, v: number) => void; step: number; unit: string }) {
  return (
    <div className="vec3">
      <span className="field-label">{label}</span>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <label key={axis} className={`axis axis-${axis}`}>
          <span>{axis.toUpperCase()}</span>
          <NumberInput value={value[axis]} step={step} unit={unit} placeholder="mixed" onChange={(v) => onChange(axis, v)} />
        </label>
      ))}
    </div>
  )
}

const ORIENTATIONS: { value: string; label: string; hint: string; rotation: Vec3 }[] = [
  { value: 'level', label: 'Level', hint: 'Lying left to right', rotation: { x: 0, y: 0, z: 0 } },
  { value: 'upright', label: 'Upright', hint: 'Standing, pixel 1 at the bottom', rotation: { x: 0, y: 0, z: 90 } },
  { value: 'diagonal', label: 'Diagonal', hint: 'Tilted by 45°', rotation: { x: 0, y: 0, z: 45 } },
  { value: 'depth', label: 'In depth', hint: 'Lying front to back', rotation: { x: 0, y: 90, z: 0 } }
]

/** Rotation of one or several things on stage: free angles on all three axes, for fixtures also quick orientations. */
function RotationFields({ items, presets }: { items: Placed[]; presets?: boolean }) {
  const edit = useStore((s) => s.edit)
  const ids = new Set(items.map((i) => i.id))
  const key = `rotation-${[...ids].join()}`
  const apply = (change: (rotation: Vec3) => Vec3, coalesce?: string) =>
    edit((s) => place(s, (i) => (ids.has(i.id) ? { position: i.position, rotation: change(i.rotation) } : undefined)), coalesce)
  // An axis shows a number only if everything selected agrees on it.
  const shared = (axis: keyof Vec3) => (items.every((i) => i.rotation[axis] === items[0].rotation[axis]) ? items[0].rotation[axis] : NaN)
  const value = { x: shared('x'), y: shared('y'), z: shared('z') }
  const preset = ORIENTATIONS.find((o) => o.rotation.x === value.x && o.rotation.y === value.y && o.rotation.z === value.z)

  return (
    <>
      {presets && (
        <div className="segmented orientation" role="group" aria-label="Orientation">
          {ORIENTATIONS.map((o) => (
            <button key={o.value} className={o === preset ? 'on' : ''} title={o.hint} onClick={() => apply(() => ({ ...o.rotation }))}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <Vec3Fields label="Rotation" value={value} step={5} unit="°" onChange={(axis, v) => apply((r) => ({ ...r, [axis]: v }), key)} />
    </>
  )
}

const HANDLES_NOTE = 'On the stage, drag the handles (G moves, R rotates) or use the keys shown below the stage.'

function PropInspector({ prop }: { prop: StageProp }) {
  const type = propType(prop.kind)
  const set = (p: Partial<StageProp>, key?: string) => editProp(prop.id, p, key ? `${key}-${prop.id}` : undefined)
  const size = (label: string, axis: 'w' | 'h' | 'd', min = 0.05, max = 30) => (
    <Field label={label}>
      <NumberInput value={prop.size[axis]} min={min} max={max} step={0.05} unit="m" onChange={(v) => set({ size: { ...prop.size, [axis]: v } }, 'size')} />
    </Field>
  )
  return (
    <aside className="panel right">
      <Section
        title="Stage object"
        action={
          <span className="actions">
            <button className="icon" title="Duplicate" onClick={duplicateSelection}>
              <Copy size={15} />
            </button>
            <button className="icon" title="Delete" onClick={deleteSelection}>
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={prop.name} onChange={(name) => set({ name })} />
          </Field>
          <Field label="Type" wide>
            <div className="readout">{type.label}</div>
          </Field>
        </div>
      </Section>
      <Section title="On stage">
        <Vec3Fields label="Position" value={prop.position} step={0.05} unit="m" onChange={(axis, v) => set({ position: { ...prop.position, [axis]: v } }, 'position')} />
        <RotationFields items={[prop]} />
        <div className="form-grid">
          {type.person && size('Body height', 'h', 1, 2.3)}
          {prop.kind === 'truss' && (
            <>
              {size('Length', 'w')}
              <Field label="Cross-section">
                <NumberInput value={prop.size.h} min={0.05} max={2} step={0.01} unit="m" onChange={(v) => set({ size: { ...prop.size, h: v, d: v } }, 'size')} />
              </Field>
            </>
          )}
          {(prop.kind === 'riser' || prop.kind === 'monitor') && (
            <>
              {size('Width', 'w')}
              {size('Depth', 'd')}
              {size('Height', 'h')}
            </>
          )}
        </div>
        <p className="form-note">
          Position is the middle of the underside: Y 0 stands on the floor, Y 0.4 on a 40 cm riser.
          {type.person ? ' At 0° the musician faces the audience.' : prop.kind === 'monitor' ? ' At 0° the speaker points upstage, at the band.' : ''} {HANDLES_NOTE}
        </p>
      </Section>
    </aside>
  )
}

export function FixtureInspector() {
  const show = useStore((s) => s.show)
  const selected = useStore((s) => s.selectedFixtures)
  const edit = useStore((s) => s.edit)
  const status = useStore((s) => s.status)
  const patch = usePatch()
  const selectedProps = useStore((s) => s.selectedProps)
  const fixtures = show.fixtures.filter((f) => selected.includes(f.id))
  const props = show.props.filter((p) => selectedProps.includes(p.id))
  const count = fixtures.length + props.length

  if (count === 0) {
    return (
      <aside className="panel right">
        <Section title="Stage">
          <div className="form-grid">
            <Field label="Width">
              <NumberInput value={show.stage.width} min={1} max={60} step={0.5} unit="m" onChange={(v) => edit((s) => ({ ...s, stage: { ...s.stage, width: v } }), 'stage')} />
            </Field>
            <Field label="Depth">
              <NumberInput value={show.stage.depth} min={1} max={60} step={0.5} unit="m" onChange={(v) => edit((s) => ({ ...s, stage: { ...s.stage, depth: v } }), 'stage')} />
            </Field>
          </div>
        </Section>
        <Section title="Output">
          <div className="form-grid">
            <Field label="Frame rate">
              <NumberInput value={show.settings.outputRate} min={10} max={200} step={5} unit="Hz" onChange={(v) => edit((s) => ({ ...s, settings: { ...s.settings, outputRate: v } }), 'rate')} />
            </Field>
            <Field label="Gamma">
              <NumberInput value={show.settings.gamma} min={1} max={3} step={0.1} onChange={(v) => edit((s) => ({ ...s, settings: { ...s.settings, gamma: v } }), 'gamma')} />
            </Field>
            <p className="form-note">Gamma 1 sends raw values. LEDs dim linearly, so around 2.2 makes fades and mixed colours look like the preview.</p>
          </div>
        </Section>
        {patch.warnings.length > 0 && (
          <Section title="Check your patch">
            {patch.warnings.map((w) => (
              <p key={w} className="error">
                {w}
              </p>
            ))}
          </Section>
        )}
        <p className="hint">Click a fixture or stage object on the stage or in the list to edit it. Shift-click selects several.</p>
      </aside>
    )
  }

  if (count > 1) {
    const spread = () => {
      const xs = fixtures.map((f) => f.position.x)
      const min = Math.min(...xs)
      const max = Math.max(...xs)
      const span = max - min || (fixtures.length - 1) * 0.5
      edit((s) => ({
        ...s,
        fixtures: s.fixtures.map((f) => {
          const i = fixtures.findIndex((x) => x.id === f.id)
          return i < 0 ? f : { ...f, position: { ...f.position, x: +(min + (span * i) / (fixtures.length - 1)).toFixed(3) } }
        })
      }))
    }
    return (
      <aside className="panel right">
        <Section title={`${count} ${props.length === 0 ? 'fixtures' : fixtures.length === 0 ? 'objects' : 'things'} selected`}>
          <div className="stack">
            {fixtures.length > 1 && (
              <button className="button ghost" onClick={spread}>
                Space {props.length ? 'the fixtures ' : ''}evenly from left to right
              </button>
            )}
            <button className="button ghost" onClick={duplicateSelection}>
              <Copy size={14} /> Duplicate
            </button>
          </div>
        </Section>
        <Section title="On stage">
          <RotationFields items={[...fixtures, ...props]} presets={props.length === 0} />
          <p className="form-note">These angles apply to everything selected. {HANDLES_NOTE} Handles and keys move and turn the selection as one piece.</p>
        </Section>
        <Section title="Remove">
          <button className="button danger" onClick={deleteSelection}>
            <Trash2 size={14} /> Delete {count} {props.length === 0 ? 'fixtures' : fixtures.length === 0 ? 'objects' : 'things'}
          </button>
        </Section>
      </aside>
    )
  }

  if (props.length === 1) return <PropInspector prop={props[0]} />

  const f = fixtures[0]
  const def = show.definitions[f.definition]
  const pf = patch.byId.get(f.id)
  const error = status?.targets.find((t) => t.host === f.host && t.error)?.error
  const set = (p: Partial<FixtureInstance>, key?: string) => editFixture(f.id, p, key ? `${key}-${f.id}` : undefined)
  const last = pf?.segments.at(-1)

  return (
    <aside className="panel right">
      <Section
        title="Fixture"
        action={
          <span className="actions">
            <button className="icon" title="Duplicate with the next IP and universe" onClick={duplicateSelection}>
              <Copy size={15} />
            </button>
            <button className="icon" title="Delete fixture" onClick={deleteSelection}>
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={f.name} onChange={(name) => set({ name })} />
          </Field>
          <Field label="Type" wide>
            <div className="readout">{def?.name ?? 'Missing fixture type'}</div>
          </Field>
          {def && def.modes.length > 1 && (
            <Field label="Mode" wide>
              <Select value={f.mode} onChange={(mode) => set({ mode })} options={def.modes.map((m) => ({ value: m.name, label: m.name }))} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Art-Net">
        <div className="form-grid">
          <Field label="IP address" wide>
            <TextInput value={f.host} validate={isIPv4} onChange={(host) => set({ host })} />
          </Field>
          <Field label="Universe">
            <NumberInput value={f.universe} min={0} max={32767} onChange={(v) => set({ universe: Math.round(v) }, 'universe')} />
          </Field>
          <Field label="Start address">
            <NumberInput value={f.address} min={1} max={512} onChange={(v) => set({ address: Math.round(v) }, 'address')} />
          </Field>
        </div>
        {pf && last && (
          <p className="summary">
            {pf.mode.channelCount} channels, {pf.cellCount} pixel{pf.cellCount === 1 ? '' : 's'}.{' '}
            {pf.segments.length === 1 ? `Ends at address ${last.at + last.length}.` : `Spans universes ${f.universe} to ${last.universe}.`}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </Section>

      <Section title="On stage">
        <Vec3Fields label="Position" value={f.position} step={0.05} unit="m" onChange={(axis, v) => set({ position: { ...f.position, [axis]: v } }, 'position')} />
        <RotationFields items={fixtures} presets />
        <div className="form-grid">
          <Field label="Length">
            <NumberInput value={f.size.w} min={0.01} max={30} step={0.05} unit="m" onChange={(w) => set({ size: { ...f.size, w } }, 'size')} />
          </Field>
          {pf && pf.mode.gridH > 1 && (
            <Field label="Height">
              <NumberInput value={f.size.h} min={0.01} max={30} step={0.05} unit="m" onChange={(h) => set({ size: { ...f.size, h } }, 'size')} />
            </Field>
          )}
        </div>
        <p className="form-note">{HANDLES_NOTE} Pixel 1 sits at the start of the local X axis.</p>
      </Section>
    </aside>
  )
}
