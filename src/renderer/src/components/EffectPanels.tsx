import { Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { compileCustom, CURVE_PRESETS, customKey, evalCurve, gradientAt, MIN_BEATS, newCustomEffect, oneShotSeconds } from '@shared/custom'
import { defaultParams } from '@shared/effects'
import { newId } from '@shared/show'
import type { Curve, CurveDrive, CustomEffect, GradientStop, Mapping } from '@shared/types'
import { editEffect, useStore } from '../store'
import { folderIn, ItemList } from './ItemList'
import { effectReplay, REPLAY_PAUSE, useReplay } from './replay'
import { SaveBar } from './SaveBar'
import { BeatLength, ColorInput, Field, NumberInput, Section, Segmented, Select, Slider, TextInput } from './ui'

const usedBy = (effect: CustomEffect, looks: { layers: { effect: string }[] }[]): number =>
  looks.reduce((n, l) => n + l.layers.filter((y) => y.effect === customKey(effect.id)).length, 0)

export function EffectList() {
  const effects = useStore((s) => s.show.effects)
  const folders = useStore((s) => s.show.effectFolders)
  const looks = useStore((s) => s.show.looks)
  const effectId = useStore((s) => s.effectId)
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)

  const add = () => {
    // A new effect lands next to the one being worked on.
    const current = effects.find((e) => e.id === effectId)
    const folder = current ? folderIn(folders, current) : ''
    const effect: CustomEffect = { ...newCustomEffect(newId(), `Effect ${effects.length + 1}`), ...(folder ? { folder } : {}) }
    editNow((s) => ({ ...s, effects: [...s.effects, effect] }))
    set({ effectId: effect.id })
  }

  return (
    <aside className="panel left">
      <ItemList
        kind="effects"
        folderList="effectFolders"
        title="Effects"
        noun="effect"
        items={effects}
        selected={effectId ? [effectId] : []}
        onSelect={(id) => set({ effectId: id })}
        lead={(e) => <CurveIcon curve={(e.brightness.mode === 'curve' ? e.brightness : e.colour).drive.curve} />}
        meta={(e) => {
          const n = usedBy(e, looks)
          return n === 0 ? 'unused' : `${n} layer${n === 1 ? '' : 's'}`
        }}
        empty="Build your own effects here: draw a curve and let it drive brightness or colour, over time or along the pixels. They then appear next to the built-in effects in every scene."
        action={
          <button className="button small primary" onClick={add}>
            <Plus size={14} /> New effect
          </button>
        }
      />
    </aside>
  )
}

/** The line of a curve as SVG path data in a box of the given size (y grows downwards). */
function curvePath(curve: Curve, w: number, h: number): string {
  const pts = curve.points
  if (pts.length === 0) return ''
  const X = (x: number) => +(x * w).toFixed(2)
  const Y = (y: number) => +((1 - y) * h).toFixed(2)
  if (curve.shape === 'step') {
    let d = `M0 ${Y(pts[0].y)}`
    for (const p of pts) d += ` H${X(p.x)} V${Y(p.y)}`
    return `${d} H${w}`
  }
  const n = 120
  let d = ''
  for (let i = 0; i <= n; i++) d += `${i ? ' L' : 'M'}${X(i / n)} ${Y(evalCurve(curve, i / n))}`
  return d
}

function CurveIcon({ curve }: { curve: Curve }) {
  return (
    <svg className="curve-icon" width="26" height="14" viewBox="-1 -1 28 16" aria-hidden>
      <path d={curvePath(curve, 26, 14)} />
    </svg>
  )
}

/** Points snap to the quarter lines when they come close, so exact tops, bottoms and halves are easy to hit. */
const snap = (v: number): number => {
  const q = Math.round(v * 4) / 4
  return Math.abs(v - q) < 0.025 ? q : Math.round(v * 200) / 200
}

/**
 * The drawing field. Click an empty spot for a new point, drag points, double-click one to
 * remove it. The curve shows one pass, left to right.
 */
function CurveField({ curve, onChange }: { curve: Curve; onChange: (curve: Curve) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) }
  }
  const move = (index: number, to: { x: number; y: number }) => {
    // A point stays between its neighbours, so the order never changes while dragging.
    const min = curve.points[index - 1]?.x ?? 0
    const max = curve.points[index + 1]?.x ?? 1
    const point = { x: Math.min(max, Math.max(min, snap(to.x))), y: snap(to.y) }
    onChange({ ...curve, points: curve.points.map((p, i) => (i === index ? point : p)) })
  }

  return (
    <div
      ref={box}
      className="curve-field"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const handle = (e.target as HTMLElement).dataset.point
        const p = at(e)
        let index: number
        if (handle !== undefined) index = Number(handle)
        else {
          index = curve.points.findIndex((q) => q.x > p.x)
          if (index < 0) index = curve.points.length
          const points = [...curve.points]
          points.splice(index, 0, { x: snap(p.x), y: snap(p.y) })
          onChange({ ...curve, points })
        }
        dragging.current = index
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => dragging.current !== null && move(dragging.current, at(e))}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {[25, 50, 75].map((v) => (
          <g key={v}>
            <line className="grid" x1={v} y1={0} x2={v} y2={100} />
            <line className="grid" x1={0} y1={v} x2={100} y2={v} />
          </g>
        ))}
        <path className="fill" d={`${curvePath(curve, 100, 100)} L100 100 L0 100 Z`} />
        <path className="line" d={curvePath(curve, 100, 100)} />
      </svg>
      {curve.points.map((p, i) => (
        <button
          key={i}
          data-point={i}
          className="curve-point"
          style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }}
          title={`${Math.round(p.x * 100)}% along, ${Math.round(p.y * 100)}% high. Double-click to remove.`}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (curve.points.length > 1) onChange({ ...curve, points: curve.points.filter((_, j) => j !== i) })
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.01
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
            if (d) {
              e.preventDefault()
              const min = curve.points[i - 1]?.x ?? 0
              const max = curve.points[i + 1]?.x ?? 1
              const point = { x: +Math.min(max, Math.max(min, p.x + d[0])).toFixed(3), y: +Math.min(1, Math.max(0, p.y + d[1])).toFixed(3) }
              onChange({ ...curve, points: curve.points.map((q, j) => (j === i ? point : q)) })
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && curve.points.length > 1) {
              e.preventDefault()
              onChange({ ...curve, points: curve.points.filter((_, j) => j !== i) })
            }
          }}
        />
      ))}
    </div>
  )
}

/** A curve and what reads it: time or position, how fast, which way. */
function DriveEditor({ drive, low, high, onChange }: { drive: CurveDrive; low: string; high: string; onChange: (patch: Partial<CurveDrive>, key?: string) => void }) {
  const time = drive.over === 'time'
  const random = !time && drive.direction === 'random'
  return (
    <>
      <div className="curve-wrap">
        <span className="curve-scale">
          <span>{high}</span>
          <span>{low}</span>
        </span>
        <CurveField curve={drive.curve} onChange={(curve) => onChange({ curve }, 'curve')} />
      </div>
      <div className="curve-tools">
        <span className="curve-presets" role="group" aria-label="Start from a shape">
          {CURVE_PRESETS.map((p) => (
            <button key={p.id} title={p.label} onClick={() => onChange({ curve: { shape: p.curve.shape, points: p.curve.points.map((q) => ({ ...q })) } })}>
              <CurveIcon curve={p.curve} />
            </button>
          ))}
        </span>
        <span className="curve-help">Click to add a point, double-click to remove</span>
      </div>
      <div className="form-grid">
        <Field label="From point to point" wide>
          <Segmented
            value={drive.curve.shape}
            onChange={(shape) => onChange({ curve: { ...drive.curve, shape } })}
            options={[
              { value: 'smooth', label: 'Smooth' },
              { value: 'linear', label: 'Straight' },
              { value: 'step', label: 'Steps' }
            ]}
          />
        </Field>
        <Field label="The curve runs over" wide>
          <Segmented
            value={drive.over}
            onChange={(over) => onChange({ over })}
            options={[
              { value: 'time', label: 'Time' },
              { value: 'position', label: 'Position' }
            ]}
          />
        </Field>
        <p className="form-note">
          {time
            ? 'All pixels follow the curve together, from left to right.'
            : 'The curve lies along the pixels: its left end on the first pixel. How "along" is meant (each fixture, the whole stage …) is chosen per layer in the scene.'}
        </p>
        {!time && (
          <Field label="Fits along">
            <NumberInput value={drive.repeats} min={0.1} max={32} step={0.25} unit="×" onChange={(repeats) => onChange({ repeats }, 'repeats')} />
          </Field>
        )}
        <Field label={time ? 'Tempo in' : random ? 'Jumps in' : 'Travels in'}>
          <Segmented
            value={drive.sync}
            onChange={(sync) => onChange({ sync })}
            options={[
              { value: 'hz', label: 'Seconds' },
              { value: 'beats', label: 'Beats' }
            ]}
          />
        </Field>
        {drive.sync === 'hz' ? (
          <Field label={time ? 'Passes per second' : random ? 'Jumps per second (0 = stays)' : 'Lengths per second (0 = still)'}>
            <NumberInput value={drive.hz} min={0} max={30} step={0.05} unit="Hz" onChange={(hz) => onChange({ hz }, 'hz')} />
          </Field>
        ) : (
          <Field label={time ? 'One pass lasts' : random ? 'Jumps every' : 'One length takes'}>
            <BeatLength value={drive.beats} min={MIN_BEATS} onChange={(beats) => onChange({ beats }, 'beats')} />
          </Field>
        )}
        <Field label={time ? 'Direction' : 'Movement'} wide>
          <Select
            value={random || !(time && drive.direction === 'random') ? drive.direction : 'forward'}
            onChange={(direction) => onChange({ direction })}
            options={[
              { value: 'forward', label: time ? 'Forward' : 'Travels forward' },
              { value: 'backward', label: time ? 'Backward' : 'Travels backward' },
              { value: 'bounce', label: 'Back and forth' },
              ...(time ? [] : [{ value: 'random' as const, label: 'Jumps to a random place' }])
            ]}
          />
        </Field>
        {random && (
          <p className="form-note">
            On every jump the curve lands somewhere else, and on each fixture somewhere different. A curve that is dark at both ends (a section, a dot) always stays whole on the pixels. To
            light only one fixture at a time, set “Plays on” of the layer in the scene to random fixtures.
          </p>
        )}
        {!random && <Field label="Repeats" wide>
          <Segmented
            value={drive.once ? 'once' : 'loop'}
            onChange={(v) => onChange({ once: v === 'once' })}
            options={[
              { value: 'loop', label: 'Again and again' },
              { value: 'once', label: 'Once per note' }
            ]}
          />
        </Field>}
        {drive.once && !random && (
          <p className="form-note">
            {time
              ? 'Starts when the scene starts (its MIDI note arrives), runs through once and stays at the end of the curve. End the curve at the bottom for a single flash.'
              : 'Starts when the scene starts (its MIDI note arrives): the curve comes in at one end, passes through once and leaves at the other.'}{' '}
            The preview plays it again and again.
          </p>
        )}
      </div>
    </>
  )
}

function GradientEditor({ stops, onChange }: { stops: GradientStop[]; onChange: (stops: GradientStop[], key?: string) => void }) {
  const sorted = (list: GradientStop[]) => [...list].sort((a, b) => a.at - b.at)
  const add = () => {
    // The new colour goes into the widest gap, as the colour the gradient already has there.
    let gap = 0
    for (let i = 1; i < stops.length - 1; i++) if (stops[i + 1].at - stops[i].at > stops[gap + 1].at - stops[gap].at) gap = i
    const at = stops.length > 1 ? (stops[gap].at + stops[gap + 1].at) / 2 : 1
    const rgb = [0, 0, 0]
    gradientAt(stops, at, rgb)
    const color = `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
    onChange(sorted([...stops, { at: +at.toFixed(2), color }]))
  }
  return (
    <div className="gradient">
      <div className="gradient-bar" style={{ background: `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.at * 100}%`).join(', ')})` }} />
      <div className="gradient-ends">
        <span>curve low</span>
        <span>curve high</span>
      </div>
      {stops.map((stop, i) => (
        <div key={i} className="gradient-stop">
          <span className="color">
            <input type="color" value={stop.color} aria-label="Colour" onChange={(e) => onChange(stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s)), `stop-color-${i}`)} />
          </span>
          <NumberInput
            value={Math.round(stop.at * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => onChange(sorted(stops.map((s, j) => (j === i ? { ...s, at: v / 100 } : s))), 'stop-at')}
          />
          <button className="icon" title="Remove colour" disabled={stops.length <= 2} onClick={() => onChange(stops.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="button small ghost" onClick={add}>
        <Plus size={14} /> Add colour
      </button>
    </div>
  )
}

const PREVIEW_PIXELS = 96

/** The effect running on one imaginary strip of pixels, exactly as the engine computes it. */
function PreviewStrip({ effect }: { effect: CustomEffect }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const def = useMemo(() => compileCustom(effect), [effect])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const out = new Float32Array(PREVIEW_PIXELS * 3)
    const u = Float32Array.from({ length: PREVIEW_PIXELS }, (_, i) => i / (PREVIEW_PIXELS - 1))
    const image = ctx.createImageData(PREVIEW_PIXELS, 1)
    let start = performance.now()
    let beat = 0
    let last = start
    let frame = 0
    const draw = (now: number) => {
      const s = useStore.getState()
      // Beats run at the tempo the engine would use: the MIDI clock if there is one, else the show tempo.
      const bpm = s.status?.clock?.bpm ?? s.show.settings.bpm
      beat += ((now - last) / 60000) * bpm
      last = now
      // What runs once per note starts over after a short pause, so it can be judged.
      const once = oneShotSeconds(effect, bpm)
      if (once !== null && now - start > (once + REPLAY_PAUSE) * 1000) {
        start = now
        beat = 0
      }
      def.render({ out, u, count: PREVIEW_PIXELS, t: (now - start) / 1000, beat, p: { speed: 1 } })
      for (let i = 0; i < PREVIEW_PIXELS; i++) {
        for (let k = 0; k < 3; k++) image.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, out[i * 3 + k])) * 255)
        image.data[i * 4 + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [def, effect])

  return <canvas ref={canvas} className="effect-strip" width={PREVIEW_PIXELS} height={1} aria-label="Preview of the effect on one strip" />
}

const STAGE_MAPPINGS: { value: Mapping; label: string }[] = [
  { value: 'fixture', label: 'Along each fixture' },
  { value: 'span', label: 'Through all fixtures, end to end' },
  { value: 'index', label: 'Fixture by fixture' },
  { value: 'stageX', label: 'Across the stage, left to right' },
  { value: 'stageY', label: 'From the floor up' }
]

export function EffectEditor() {
  const effect = useStore((s) => s.show.effects.find((e) => e.id === s.effectId))
  const looks = useStore((s) => s.show.looks)
  const bpm = useStore((s) => s.show.settings.bpm)
  const clock = useStore((s) => s.status?.clock ?? null)
  const preview = useStore((s) => s.preview)
  const mapping = useStore((s) => s.effectMapping)
  const set = useStore((s) => s.set)
  const edit = useStore((s) => s.edit)
  const editNow = useStore((s) => s.editNow)
  useReplay(useStore((s) => effectReplay(s, effect)))

  if (!effect) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select an effect on the left, or create a new one.</p>
      </aside>
    )
  }

  const { brightness, colour } = effect
  const change = (patch: Partial<CustomEffect>, key?: string) => editEffect(effect.id, patch, key && `${key}-${effect.id}`)
  const n = usedBy(effect, looks)
  const countsBeats = (brightness.mode === 'curve' && brightness.drive.sync === 'beats') || (colour.mode === 'curve' && colour.drive.sync === 'beats')
  const usesPosition = (brightness.mode === 'curve' && brightness.drive.over === 'position') || (colour.mode === 'curve' && colour.drive.over === 'position')

  const remove = () => {
    // Layers that used it fall back to a plain colour instead of going dark without a word.
    editNow((s) => ({
      ...s,
      effects: s.effects.filter((e) => e.id !== effect.id),
      looks: s.looks.map((l) => ({ ...l, layers: l.layers.map((y) => (y.effect === customKey(effect.id) ? { ...y, effect: 'solid', params: defaultParams('solid') } : y)) }))
    }))
    set({ effectId: null })
  }
  const duplicate = () => {
    const copy: CustomEffect = { ...structuredClone(effect), id: newId(), name: `${effect.name} copy` }
    editNow((s) => ({ ...s, effects: [...s.effects, copy] }))
    set({ effectId: copy.id })
  }

  return (
    <aside className="panel right wide">
      <Section
        title="Effect"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Shown on all fixtures while you edit. Click to hide.' : 'Show on stage while editing'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon" title="Duplicate effect" onClick={duplicate}>
              <Copy size={15} />
            </button>
            <button className="icon" title={n ? `Delete effect (${n} layer${n === 1 ? '' : 's'} become a plain colour)` : 'Delete effect'} onClick={remove}>
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={effect.name} onChange={(name) => change({ name })} />
          </Field>
        </div>
        <PreviewStrip effect={effect} />
        <div className="form-grid">
          {usesPosition && (
            <Field label="On stage, try it" wide>
              <Select value={mapping} onChange={(m) => set({ effectMapping: m })} options={STAGE_MAPPINGS} />
            </Field>
          )}
          {countsBeats && (
            <>
              <Field label="Show tempo">
                <NumberInput value={bpm} min={20} max={400} step={1} unit="bpm" onChange={(v) => edit((s) => ({ ...s, settings: { ...s.settings, bpm: v } }), 'show-bpm')} />
              </Field>
              <p className="form-note tempo-note">
                {clock ? `Beats follow the MIDI clock: ${clock.bpm.toFixed(1)} bpm.` : 'Beats follow the MIDI clock. None arrives right now, so the show tempo counts.'}
              </p>
            </>
          )}
        </div>
        <p className="summary">{n === 0 ? 'Use it in the Scenes tab: it is listed with the effects of every layer.' : `Used by ${n} layer${n === 1 ? '' : 's'}. Changes apply to all of them.`}</p>
      </Section>

      <Section title="Brightness">
        <Segmented
          value={brightness.mode}
          onChange={(mode) => change({ brightness: { ...brightness, mode } })}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'curve', label: 'Curve' }
          ]}
        />
        {brightness.mode === 'fixed' ? (
          <div className="channel-fixed">
            <Slider value={brightness.value} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => change({ brightness: { ...brightness, value } }, 'brightness')} />
          </div>
        ) : (
          <DriveEditor drive={brightness.drive} low="dark" high="full" onChange={(patch, key) => change({ brightness: { ...brightness, drive: { ...brightness.drive, ...patch } } }, key && `brightness-${key}`)} />
        )}
      </Section>

      <Section title="Colour">
        <Segmented
          value={colour.mode}
          onChange={(mode) => change({ colour: { ...colour, mode } })}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'curve', label: 'Curve through a gradient' }
          ]}
        />
        {colour.mode === 'fixed' ? (
          <div className="channel-fixed">
            <ColorInput value={colour.color} onChange={(color) => change({ colour: { ...colour, color } }, 'colour')} />
          </div>
        ) : (
          <>
            <GradientEditor stops={colour.gradient} onChange={(gradient, key) => change({ colour: { ...colour, gradient } }, key && `gradient-${key}`)} />
            <DriveEditor drive={colour.drive} low="start" high="end" onChange={(patch, key) => change({ colour: { ...colour, drive: { ...colour.drive, ...patch } } }, key && `colour-${key}`)} />
          </>
        )}
      </Section>

      <SaveBar items={[{ kind: 'effects', ids: [effect.id] }]} noun="effect" />
    </aside>
  )
}
