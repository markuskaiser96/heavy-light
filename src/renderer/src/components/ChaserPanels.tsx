import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, ListPlus, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { LOOK_COLORS, newChaser, newId, newStep } from '@shared/show'
import type { Chaser, ChaserOrder, ChaserStep } from '@shared/types'
import { editChaser, useStore } from '../store'
import { AddStepsDialog } from './AddStepsDialog'
import { ItemList, folderIn } from './ItemList'
import { midiLabel, TriggerEditor } from './LookPanels'
import { SaveBar } from './SaveBar'
import { BeatLength, Field, NumberInput, Section, Segmented, Select, Slider, TextInput, Toggle } from './ui'

const ORDERS: { value: ChaserOrder; label: string }[] = [
  { value: 'forward', label: 'First to last' },
  { value: 'backward', label: 'Last to first' },
  { value: 'pingpong', label: 'Back and forth' },
  { value: 'random', label: 'Random' }
]

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
        empty="A chaser runs through several scenes in tempo, for as long as its MIDI note is held."
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

function Steps({ chaser, current, bpm }: { chaser: Chaser; current: number | null; bpm: number }) {
  const looks = useStore((s) => s.show.looks)
  const [picking, setPicking] = useState(false)
  const setSteps = (steps: ChaserStep[]) => editChaser(chaser.id, { steps })
  const beats = chaser.steps.reduce((sum, step) => sum + step.beats, 0)
  const speed = chaser.speed > 0 ? chaser.speed : 1
  const seconds = (beats * 60) / Math.max(1, bpm) / speed
  const options = [{ value: '', label: 'Dark' }, ...looks.map((l) => ({ value: l.id, label: l.name }))]

  const add = () => {
    // Offer the look after the one in the last step: building a run through the looks takes one click per step.
    const last = looks.findIndex((l) => l.id === chaser.steps.at(-1)?.lookId)
    const look = looks[(last + 1) % Math.max(1, looks.length)]
    setSteps([...chaser.steps, newStep(look?.id ?? '', chaser.steps.at(-1)?.beats ?? 1)])
  }

  return (
    <Section
      title="Steps"
      action={
        <span className="actions">
          <button className="button small ghost" title="Add one step" onClick={add}>
            <Plus size={14} /> Step
          </button>
          <button className="button small ghost" title="Search the scenes and add many of them as steps at once" disabled={looks.length === 0} onClick={() => setPicking(true)}>
            <ListPlus size={14} /> Scenes…
          </button>
        </span>
      }
    >
      {picking && (
        <AddStepsDialog
          beats={chaser.steps.at(-1)?.beats ?? 1}
          onClose={() => setPicking(false)}
          onAdd={(ids, length) => setSteps([...chaser.steps, ...ids.map((id) => newStep(id, length))])}
        />
      )}
      {chaser.steps.length === 0 && (
        <p className="empty">{looks.length ? 'Add steps and choose the scene each one shows, or pick many scenes at once with “Scenes…”.' : 'A chaser plays scenes. Build some in the Scenes tab first.'}</p>
      )}
      <ol className="steps">
        {chaser.steps.map((step, index) => {
          const swap = (j: number) => {
            const steps = [...chaser.steps]
            ;[steps[index], steps[j]] = [steps[j], steps[index]]
            setSteps(steps)
          }
          const set = (patch: Partial<ChaserStep>, key?: string) =>
            editChaser(chaser.id, { steps: chaser.steps.map((x) => (x.id === step.id ? { ...x, ...patch } : x)) }, key && `${key}-${step.id}`)
          const look = looks.find((l) => l.id === step.lookId)
          return (
            <li key={step.id} className={`step${index === current ? ' playing' : ''}`}>
              <span className="step-number">{index + 1}</span>
              <span className="look-chip" style={{ background: look?.color ?? 'var(--raised-2)' }} />
              <Select value={look ? step.lookId : ''} onChange={(lookId) => set({ lookId })} options={options} />
              <span className="step-beats" title="Length of this step in beats">
                <BeatLength value={step.beats} min={1 / 8} onChange={(beats) => set({ beats }, 'beats')} />
              </span>
              <button className="icon subtle" title="Move up" disabled={index === 0} onClick={() => swap(index - 1)}>
                <ArrowUp size={13} />
              </button>
              <button className="icon subtle" title="Move down" disabled={index === chaser.steps.length - 1} onClick={() => swap(index + 1)}>
                <ArrowDown size={13} />
              </button>
              <button className="icon subtle" title="Delete step" onClick={() => setSteps(chaser.steps.filter((x) => x.id !== step.id))}>
                <Trash2 size={13} />
              </button>
            </li>
          )
        })}
      </ol>
      {chaser.steps.length > 0 && (
        <p className="summary">
          One pass is {+(beats / speed).toFixed(2)} beat{beats / speed === 1 ? '' : 's'}, or {seconds.toFixed(2)} s at {+bpm.toFixed(1)} bpm.
          {speed !== 1 && ` The step lengths are played ${SPEEDS.find((x) => x.value === String(speed))?.label ?? `×${speed}`}.`}
        </p>
      )}
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
  const current = preview ? (status?.previewStep ?? null) : (status?.chasers.find((r) => r.chaserId === chaser.id)?.step ?? null)

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
                const copy: Chaser = { ...chaser, id: newId(), name: `${chaser.name} copy`, midi: null, steps: chaser.steps.map((step) => ({ ...step, id: newId() })) }
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
            ? 'Steps are counted in the clock ticks of the DAW, so the chaser follows every tempo change of the song. It still starts on its first step the moment its note arrives. Switch on sending MIDI clock for the HeavyLight output in the DAW; while none arrives, the tempo above is used.'
            : 'Use the tempo of the song in Reaper. The chaser starts on its first step the moment its note arrives, so it stays on the beat.'}
        </p>
        <div className="form-grid">
          <Field label="Speed" wide>
            <Segmented value={String(chaser.speed > 0 ? chaser.speed : 1)} onChange={(v) => change({ speed: Number(v) })} options={SPEEDS} />
          </Field>
          <Field label="Order" wide>
            <Select value={chaser.order} onChange={(order) => change({ order })} options={ORDERS} />
          </Field>
          <Toggle value={chaser.loop} onChange={(loop) => change({ loop })} label={chaser.loop ? 'Repeats until it is stopped' : 'Plays once, then stops'} />
          <Field label="Fade between steps" wide>
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

      <Steps chaser={chaser} current={current} bpm={following && clock ? clock.bpm : chaser.bpm} />

      <TriggerEditor item={chaser} onEdit={(patch, key) => editChaser(chaser.id, patch, key)} />

      <SaveBar items={[{ kind: 'chasers', ids: [chaser.id] }]} noun="chaser" />
    </aside>
  )
}
