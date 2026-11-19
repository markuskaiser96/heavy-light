import { Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { nextOf, removeNodes } from '@shared/flow'
import { LOOK_COLORS, newChaser, newId } from '@shared/show'
import type { Chaser, FlowNode } from '@shared/types'
import { editChaser, useStore } from '../store'
import { ItemList, folderIn } from './ItemList'
import { midiLabel, TriggerEditor } from './LookPanels'
import { SaveBar } from './SaveBar'
import { BeatLength, Field, NumberInput, Section, Segmented, Select, Slider, TextInput } from './ui'

/** Factors on the tempo: the steps keep their lengths, the chaser runs through them faster or slower. */
const SPEEDS: { value: string; label: string }[] = [
  { value: '0.25', label: '×¼' },
  { value: '0.5', label: '×½' },
  { value: '1', label: '×1' },
  { value: '2', label: '×2' },
  { value: '4', label: '×4' }
]

export function ChaserList() {
  const chasers = useStore((s) => s.show.chasers)
  const folders = useStore((s) => s.show.chaserFolders)
  const chaserId = useStore((s) => s.chaserId)
  const selectChaser = useStore((s) => s.selectChaser)
  const editNow = useStore((s) => s.editNow)
  const running = useStore((s) => s.status?.chasers)

  const add = () => {
    // A new chaser lands next to the one being worked on.
    const current = chasers.find((c) => c.id === chaserId)
    const folder = current ? folderIn(folders, current) : ''
    const chaser: Chaser = { ...newChaser(`Chaser ${chasers.length + 1}`, chasers.length), ...(folder ? { folder } : {}) }
    editNow((s) => ({ ...s, chasers: [...s.chasers, chaser] }))
    selectChaser(chaser.id)
  }

  return (
    <aside className="panel left">
      <ItemList
        kind="chasers"
        folderList="chaserFolders"
        title="Chasers"
        noun="chaser"
        items={chasers}
        selected={chaserId ? [chaserId] : []}
        onSelect={(id) => selectChaser(id)}
        matches={(c, query) => midiLabel(c).toLowerCase().includes(query)}
        lead={(c) => <span className="look-chip" style={{ background: c.color, opacity: 0.35 + 0.65 * Math.min(1, (running?.find((r) => r.chaserId === c.id)?.level ?? 0) * 2) }} />}
        meta={midiLabel}
        empty="A chaser links scenes in time, as a flow chart: one after the other, side by side, in loops. It runs in tempo for as long as its MIDI note is held."
        action={
          <button className="button small primary" onClick={add}>
            <Plus size={14} /> New chaser
          </button>
        }
      />
    </aside>
  )
}

/** Sets the tempo from the rhythm of the clicks. */
function TapTempo({ onTempo }: { onTempo: (bpm: number) => void }) {
  const taps = useRef<number[]>([])
  const tap = () => {
    const now = performance.now()
    const last = taps.current.at(-1)
    // A pause of two seconds starts a new measurement.
    const recent = last !== undefined && now - last < 2000 ? [...taps.current.slice(-7), now] : [now]
    taps.current = recent
    if (recent.length >= 2) onTempo(Math.round(60000 / ((now - recent[0]) / (recent.length - 1))))
  }
  return (
    <button className="button ghost tap" title="Click along with the music to set the tempo" onClick={tap}>
      Tap
    </button>
  )
}

/** Settings of the nodes selected in the flow chart. */
function NodeEditor({ chaser }: { chaser: Chaser }) {
  const looks = useStore((s) => s.show.looks)
  const selected = useStore((s) => s.flowNodes)
  const set = useStore((s) => s.set)
  const nodes = chaser.nodes.filter((n) => selected.includes(n.id))
  const timed = nodes.filter((n) => n.kind !== 'start')
  const scenes = nodes.filter((n) => n.kind === 'scene')
  const ids = new Set(nodes.map((n) => n.id))
  const change = (patch: Partial<FlowNode>, key?: string) =>
    editChaser(chaser.id, { nodes: chaser.nodes.map((n) => (ids.has(n.id) && (n.kind !== 'start' || 'next' in patch) ? { ...n, ...patch, kind: n.kind, id: n.id } : n)) }, key && `${key}-${[...ids].join()}`)

  if (nodes.length === 0) {
    return (
      <Section title="Node">
        <p className="empty">
          {chaser.nodes.length === 1
            ? 'Add scenes in the chart below the stage. They start with the MIDI note and follow each other in tempo.'
            : 'Click a node in the chart below the stage to set its scene and length.'}
        </p>
      </Section>
    )
  }

  const first = nodes[0]
  const same = <K extends keyof FlowNode>(list: FlowNode[], key: K): FlowNode[K] | undefined => (list.every((n) => n[key] === list[0][key]) ? list[0]?.[key] : undefined)
  const outs = Math.max(...nodes.map((n) => nextOf(chaser, n.id).length))
  const title = nodes.length > 1 ? `${nodes.length} nodes` : first.kind === 'start' ? 'Start' : first.kind === 'wait' ? 'Wait' : 'Scene node'

  return (
    <Section
      title={title}
      action={
        timed.length > 0 && (
          <button
            className="icon"
            title={nodes.length > 1 ? 'Delete these nodes' : 'Delete node'}
            onClick={() => {
              editChaser(chaser.id, removeNodes(chaser, [...ids]))
              set({ flowNodes: [] })
            }}
          >
            <Trash2 size={15} />
          </button>
        )
      }
    >
      <div className="form-grid">
        {scenes.length > 0 && scenes.length === nodes.length && (
          <Field label="Scene" wide>
            <Select
              value={same(scenes, 'lookId') ?? '?'}
              onChange={(lookId) => lookId !== '?' && change({ lookId })}
              options={[...(same(scenes, 'lookId') === undefined ? [{ value: '?', label: 'Different scenes' }] : []), { value: '', label: 'Dark' }, ...looks.map((l) => ({ value: l.id, label: l.name }))]}
            />
          </Field>
        )}
        {timed.length > 0 && (
          <Field label={first.kind === 'wait' && nodes.length === 1 ? 'Waits for' : 'Lasts'} wide>
            <BeatLength value={same(timed, 'beats') ?? timed[0].beats} min={1 / 16} onChange={(beats) => change({ beats }, 'beats')} />
          </Field>
        )}
        <Field label="When it is over" wide>
          <Segmented
            value={same(nodes, 'next') ?? 'all'}
            onChange={(next) => change({ next })}
            options={[
              { value: 'all', label: 'Start all that follow' },
              { value: 'one', label: 'Start one at random' }
            ]}
          />
        </Field>
      </div>
      <p className="summary">
        {first.kind === 'start' && nodes.length === 1
          ? 'The flow begins here the moment the MIDI note arrives. Everything this node points to starts on that beat.'
          : outs === 0
            ? 'Nothing follows: the flow ends here. Drag from the dot on its right onto another node to carry on, or back onto an earlier one to loop.'
            : outs === 1
              ? 'One node follows. Add more arrows to start several things at once, or to choose between them at random.'
              : (same(nodes, 'next') ?? 'all') === 'all'
                ? `Its ${outs} arrows all start together.`
                : `One of its ${outs} arrows is taken each time, never the one it just came from.`}
      </p>
    </Section>
  )
}

export function ChaserEditor() {
  const chaser = useStore((s) => s.show.chasers.find((c) => c.id === s.chaserId))
  const preview = useStore((s) => s.preview)
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)
  const selectChaser = useStore((s) => s.selectChaser)
  const status = useStore((s) => s.status)

  if (!chaser) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select a chaser on the left, or create a new one.</p>
      </aside>
    )
  }

  const change = (patch: Partial<Chaser>, key?: string) => editChaser(chaser.id, patch, key && `${key}-${chaser.id}`)
  const clock = status?.clock ?? null
  const following = chaser.tempo === 'midi'

  return (
    <aside className="panel right wide">
      <Section
        title="Chaser"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Runs on stage while you edit. Click to stop.' : 'Run on stage while editing'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              className="icon"
              title="Duplicate chaser"
              onClick={() => {
                const copy: Chaser = { ...structuredClone(chaser), id: newId(), name: `${chaser.name} copy`, midi: null }
                editNow((s) => ({ ...s, chasers: [...s.chasers, copy] }))
                selectChaser(copy.id)
              }}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon"
              title="Delete chaser"
              onClick={() => {
                editNow((s) => ({ ...s, chasers: s.chasers.filter((c) => c.id !== chaser.id) }))
                selectChaser(null)
              }}
            >
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={chaser.name} onChange={(name) => change({ name })} />
          </Field>
          <div className="look-colors wide">
            {LOOK_COLORS.map((c) => (
              <button key={c} className={c === chaser.color ? 'on' : ''} style={{ background: c }} title="Label colour" onClick={() => change({ color: c })} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Tempo">
        <Segmented
          value={chaser.tempo}
          onChange={(tempo) => change({ tempo })}
          options={[
            { value: 'own', label: 'Own tempo' },
            { value: 'midi', label: 'Follow MIDI clock' }
          ]}
        />
        {following && (
          <div className={`clock-state${clock ? ' on' : ''}`}>
            <span className="dot" />
            {clock ? (
              <>
                <strong>{clock.bpm.toFixed(1)} bpm</strong> <span className="muted">from {clock.port}</span>
              </>
            ) : (
              <span>No MIDI clock arriving</span>
            )}
          </div>
        )}
        {following && <span className="field-label">Tempo while no clock arrives</span>}
        <div className="tempo">
          <NumberInput value={chaser.bpm} min={20} max={400} step={1} unit="bpm" onChange={(bpm) => change({ bpm }, 'bpm')} />
          <TapTempo onTempo={(bpm) => change({ bpm: Math.min(400, Math.max(20, bpm)) }, 'bpm')} />
        </div>
        <p className="summary">
          {following
            ? 'Lengths are counted in the clock ticks of the DAW, so the chaser follows every tempo change of the song. It still starts the moment its note arrives. Switch on sending MIDI clock for the HeavyLight output in the DAW; while none arrives, the tempo above is used.'
            : 'Use the tempo of the song in Reaper. The chaser starts the moment its note arrives, so it stays on the beat.'}
        </p>
        <div className="form-grid">
          <Field label="Speed" wide>
            <Segmented value={String(chaser.speed > 0 ? chaser.speed : 1)} onChange={(v) => change({ speed: Number(v) })} options={SPEEDS} />
          </Field>
          <Field label="Fade between scenes" wide>
            <Slider
              value={chaser.crossfade}
              min={0}
              max={1}
              step={0.05}
              format={(v) => (v === 0 ? 'Hard cut' : `${Math.round(v * 100)}%`)}
              onChange={(crossfade) => change({ crossfade }, 'crossfade')}
            />
          </Field>
        </div>
      </Section>

      <NodeEditor chaser={chaser} />

      <TriggerEditor item={chaser} onEdit={(patch, key) => editChaser(chaser.id, patch, key)} />

      <SaveBar items={[{ kind: 'chasers', ids: [chaser.id] }]} noun="chaser" />
    </aside>
  )
}
