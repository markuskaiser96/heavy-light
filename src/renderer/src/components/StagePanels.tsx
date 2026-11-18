import { Copy, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { newId, nextHost } from '@shared/show'
import type { FixtureInstance, Vec3 } from '@shared/types'
import { editFixture, useStore } from '../store'
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
    } else if (e.metaKey || e.ctrlKey) select(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
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
      {adding && <AddFixtureDialog onClose={() => setAdding(false)} />}
    </aside>
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

/** Rotation of one or several fixtures: quick orientations plus free angles on all three axes. */
function RotationFields({ fixtures }: { fixtures: FixtureInstance[] }) {
  const edit = useStore((s) => s.edit)
  const ids = new Set(fixtures.map((f) => f.id))
  const key = `rotation-${[...ids].join()}`
  const apply = (change: (rotation: Vec3) => Vec3, coalesce?: string) =>
    edit((s) => ({ ...s, fixtures: s.fixtures.map((f) => (ids.has(f.id) ? { ...f, rotation: change(f.rotation) } : f)) }), coalesce)
  // An axis shows a number only if all selected fixtures agree on it.
  const shared = (axis: keyof Vec3) => (fixtures.every((f) => f.rotation[axis] === fixtures[0].rotation[axis]) ? fixtures[0].rotation[axis] : NaN)
  const value = { x: shared('x'), y: shared('y'), z: shared('z') }
  const preset = ORIENTATIONS.find((o) => o.rotation.x === value.x && o.rotation.y === value.y && o.rotation.z === value.z)

  return (
    <>
      <div className="segmented orientation" role="group" aria-label="Orientation">
        {ORIENTATIONS.map((o) => (
          <button key={o.value} className={o === preset ? 'on' : ''} title={o.hint} onClick={() => apply(() => ({ ...o.rotation }))}>
            {o.label}
          </button>
        ))}
      </div>
      <Vec3Fields label="Rotation" value={value} step={5} unit="°" onChange={(axis, v) => apply((r) => ({ ...r, [axis]: v }), key)} />
    </>
  )
}

export function FixtureInspector() {
  const show = useStore((s) => s.show)
  const selected = useStore((s) => s.selectedFixtures)
  const select = useStore((s) => s.selectFixtures)
  const edit = useStore((s) => s.edit)
  const status = useStore((s) => s.status)
  const patch = usePatch()
  const fixtures = show.fixtures.filter((f) => selected.includes(f.id))

  if (fixtures.length === 0) {
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
        <p className="hint">Click a fixture on the stage or in the list to edit it. Shift-click selects several.</p>
      </aside>
    )
  }

  const remove = () => {
    edit((s) => ({
      ...s,
      fixtures: s.fixtures.filter((f) => !selected.includes(f.id)),
      groups: s.groups.map((g) => ({ ...g, fixtureIds: g.fixtureIds.filter((id) => !selected.includes(id)) })),
      looks: s.looks.map((l) => ({ ...l, layers: l.layers.map((y) => ({ ...y, targets: y.targets.filter((t) => !selected.includes(t)) })) }))
    }))
    select([])
  }

  if (fixtures.length > 1) {
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
        <Section title={`${fixtures.length} fixtures selected`}>
          <div className="stack">
            <button className="button ghost" onClick={spread}>
              Space evenly from left to right
            </button>
          </div>
        </Section>
        <Section title="On stage">
          <RotationFields fixtures={fixtures} />
          <p className="form-note">Applies to every selected fixture. On the stage, Move and Rotate (top left) drag them together; each one turns about its own centre.</p>
        </Section>
        <Section title="Remove">
          <button className="button danger" onClick={remove}>
            <Trash2 size={14} /> Delete {fixtures.length} fixtures
          </button>
        </Section>
      </aside>
    )
  }

  const f = fixtures[0]
  const def = show.definitions[f.definition]
  const pf = patch.byId.get(f.id)
  const error = status?.targets.find((t) => t.host === f.host && t.error)?.error
  const set = (p: Partial<FixtureInstance>, key?: string) => editFixture(f.id, p, key ? `${key}-${f.id}` : undefined)
  const last = pf?.segments.at(-1)

  const duplicate = () => {
    const copy: FixtureInstance = {
      ...f,
      id: newId(),
      name: f.name.replace(/(\d+)$/, (n) => String(Number(n) + 1)) === f.name ? `${f.name} copy` : f.name.replace(/(\d+)$/, (n) => String(Number(n) + 1)),
      host: nextHost(f.host, 1),
      universe: (last?.universe ?? f.universe) + 1,
      position: { ...f.position, x: +(f.position.x + 0.5).toFixed(3) }
    }
    edit((s) => ({ ...s, fixtures: [...s.fixtures, copy] }))
    select([copy.id])
  }

  return (
    <aside className="panel right">
      <Section
        title="Fixture"
        action={
          <span className="actions">
            <button className="icon" title="Duplicate with the next IP and universe" onClick={duplicate}>
              <Copy size={15} />
            </button>
            <button className="icon" title="Delete fixture" onClick={remove}>
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
        <RotationFields fixtures={fixtures} />
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
        <p className="form-note">On the stage, choose Move or Rotate at the top left and drag the handles. Rotate turns it about any of its three axes. Pixel 1 sits at the start of the local X axis.</p>
      </Section>
    </aside>
  )
}
