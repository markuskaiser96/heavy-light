import { Copy, Eye, EyeOff, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { compileCustom, CURVE_PRESETS, customKey, drivesOf, evalCurve, gradientAt, MAX_CURVES, MIN_BEATS, newCustomEffect, newDrive, oneShotSeconds } from '@shared/custom'
import { defaultParams, prepareParams, type EffectDef, type RenderArgs } from '@shared/effects'
import { copyPreset, presetId, presetKey, PRESETS, presetSeconds } from '@shared/presets'
import { newId } from '@shared/show'
import type { Curve, CurveDrive, CurveStack, CustomEffect, ExtraCurve, GradientStop, Mapping } from '@shared/types'
import { editEffect, useStore } from '../store'
import { folderIn, ItemList } from './ItemList'
import { effectReplay, REPLAY_PAUSE, useReplay } from './replay'
import { SaveBar } from './SaveBar'
import { BeatLength, ColorInput, Field, NumberInput, Section, Segmented, Select, Slider, TextInput } from './ui'

/** How many layers use an effect, named as layers name it (`chase`, `custom:<id>`). */
const usedBy = (effect: string, looks: { layers: { effect: string }[] }[]): number => looks.reduce((n, l) => n + l.layers.filter((y) => y.effect === effect).length, 0)
const layers = (n: number): string => `${n} layer${n === 1 ? '' : 's'}`

/** The presets as list entries, selected as `preset:<id>`. */
const PRESET_ROWS = PRESETS.map((e) => ({ id: presetKey(e.id), name: e.name }))

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
          const n = usedBy(customKey(e.id), looks)
          return n === 0 ? 'unused' : layers(n)
        }}
        fixed={{
          id: 'effect-presets',
          name: 'Presets',
          items: PRESET_ROWS,
          lead: () => <Sparkles className="preset-icon" size={14} aria-hidden />,
          meta: (e) => {
            const n = usedBy(presetId(e.id)!, looks)
            return n === 0 ? '' : layers(n)
          }
        }}
        empty="Build your own effects here: draw a curve and let it drive brightness or colour, over time or along the pixels. Or copy a preset and change it. Every layer of a scene can use them, just like the presets."
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
            ? drive.scatter
              ? 'The curve is read from left to right, over and over.'
              : 'All pixels follow the curve together, from left to right.'
            : 'The curve lies along the pixels: its left end on the first pixel. How "along" is meant (each fixture, the whole stage …) is chosen per layer in the scene.'}
        </p>
        {time && (
          <Field label="The pixels follow it" wide>
            <Select
              value={drive.scatter ?? 'together'}
              onChange={(v) => onChange(v === 'together' ? { scatter: undefined, chance: undefined } : { scatter: v })}
              options={[
                { value: 'together', label: 'All together' },
                { value: 'fixture', label: 'Each fixture in its own time' },
                { value: 'pixel', label: 'Each pixel in its own time' }
              ]}
            />
          </Field>
        )}
        {time && drive.scatter && (
          <>
            <Field label="Taking part in each pass" wide>
              <Slider
                value={drive.chance ?? 1}
                min={0.01}
                max={1}
                step={0.01}
                format={(v) => (v >= 1 ? 'All' : `${Math.round(v * 100)}%`)}
                onChange={(chance) => onChange({ chance: chance >= 1 ? undefined : chance }, 'chance')}
              />
            </Field>
            <p className="form-note">
              {drive.once
                ? `On every note, chance decides which ${drive.scatter === 'pixel' ? 'pixels' : 'fixtures'} run through the curve. The others stay at the bottom of it.`
                : `Every ${drive.scatter === 'pixel' ? 'pixel' : 'fixture'} is at a different point of the curve, and on each pass chance decides anew which of them take part. The others stay at the bottom of it. A curve that starts high and falls gives a sparkle.`}
            </p>
          </>
        )}
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

const MIXES: { value: ExtraCurve['mix']; label: string }[] = [
  { value: 'add', label: 'Added to the curves before' },
  { value: 'multiply', label: 'Scales the curves before' },
  { value: 'max', label: 'The higher one wins' }
]

/**
 * The curves of one channel: the first one, and up to three more that are combined with it. One of
 * them is open at a time. `onChange` receives the changed fields of the channel.
 */
function StackEditor({ stack, low, high, onChange }: { stack: CurveStack; low: string; high: string; onChange: (patch: Partial<CurveStack>, key?: string) => void }) {
  const more = stack.more ?? []
  const [chosen, setChosen] = useState(0)
  const at = Math.min(chosen, more.length)
  const extra = at > 0 ? more[at - 1] : null
  const setExtra = (patch: Partial<ExtraCurve>, key?: string) => onChange({ more: more.map((m, i) => (i === at - 1 ? { ...m, ...patch } : m)) }, key && `more${at}-${key}`)
  const add = () => {
    // The new curve starts like the first one runs, as a wave at half strength.
    onChange({ more: [...more, { drive: newDrive('sine', { over: stack.drive.over, sync: stack.drive.sync, beats: stack.drive.beats }), mix: 'add', amount: 0.5 }] })
    setChosen(more.length + 1)
  }
  const remove = () => {
    const rest = more.filter((_, i) => i !== at - 1)
    onChange({ more: rest.length ? rest : undefined })
    setChosen(at - 1)
  }
  const percent = (v: number) => `${Math.round(v * 100)}%`

  return (
    <>
      <div className="curve-tabs" role="tablist" aria-label="Curves of this channel">
        {drivesOf(stack).map((d, i) => (
          <button key={i} role="tab" aria-selected={i === at} className={i === at ? 'on' : ''} onClick={() => setChosen(i)}>
            <CurveIcon curve={d.curve} />
            {i + 1}
          </button>
        ))}
        {more.length < MAX_CURVES - 1 && (
          <button className="add" title="Combine with one more curve, e.g. several waves of different lengths" onClick={add}>
            <Plus size={13} /> Curve
          </button>
        )}
      </div>
      {more.length > 0 && (
        <div className="form-grid curve-mix">
          {extra && (
            <Field label={`Curve ${at + 1} is`} wide>
              <span className="with-action">
                <Select value={extra.mix} onChange={(mix) => setExtra({ mix })} options={MIXES} />
                <button className="icon" title="Remove this curve" onClick={remove}>
                  <Trash2 size={14} />
                </button>
              </span>
            </Field>
          )}
          <Field label="Counts" wide>
            {extra ? (
              <Slider value={extra.amount} min={0} max={1} step={0.01} format={percent} onChange={(amount) => setExtra({ amount }, 'amount')} />
            ) : (
              <Slider value={stack.amount ?? 1} min={0} max={1} step={0.01} format={percent} onChange={(amount) => onChange({ amount: amount >= 1 ? undefined : amount }, 'amount')} />
            )}
          </Field>
        </div>
      )}
      {extra ? (
        <DriveEditor key={at} drive={extra.drive} low={low} high={high} onChange={(patch, key) => setExtra({ drive: { ...extra.drive, ...patch } }, key)} />
      ) : (
        <DriveEditor key={0} drive={stack.drive} low={low} high={high} onChange={(patch, key) => onChange({ drive: { ...stack.drive, ...patch } }, key)} />
      )}
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

/**
 * An effect running on one imaginary strip of pixels, exactly as the engine computes it.
 * `once` tells how long its one-shot parts take at a tempo (null = it keeps running).
 */
function PreviewStrip({ def, params, once: onceAt }: { def: EffectDef; params: RenderArgs['p']; once: (bpm: number) => number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)

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
      const once = onceAt(bpm)
      if (once !== null && now - start > (once + REPLAY_PAUSE) * 1000) {
        start = now
        beat = 0
      }
      def.render({ out, u, count: PREVIEW_PIXELS, t: (now - start) / 1000, beat, p: params })
      for (let i = 0; i < PREVIEW_PIXELS; i++) {
        for (let k = 0; k < 3; k++) image.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, out[i * 3 + k])) * 255)
        image.data[i * 4 + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [def, params, onceAt])

  return <canvas ref={canvas} className="effect-strip" width={PREVIEW_PIXELS} height={1} aria-label="Preview of the effect on one strip" />
}

const STAGE_MAPPINGS: { value: Mapping; label: string }[] = [
  { value: 'fixture', label: 'Along each fixture' },
  { value: 'span', label: 'Through all fixtures, end to end' },
  { value: 'index', label: 'Fixture by fixture' },
  { value: 'stageX', label: 'Across the stage, left to right' },
  { value: 'stageY', label: 'From the floor up' }
]

const OWN_PARAMS = { speed: 1 }

/** A preset: what it does and what a layer can set on it. Nothing to edit, but it can be copied. */
function PresetView({ def }: { def: EffectDef }) {
  const looks = useStore((s) => s.show.looks)
  const preview = useStore((s) => s.preview)
  const mapping = useStore((s) => s.effectMapping)
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)
  const params = useMemo(() => prepareParams(def, defaultParams(def.id)), [def])
  const once = useMemo(() => () => presetSeconds(def.id), [def])
  useReplay(presetSeconds(def.id))
  const n = usedBy(def.id, looks)

  const copy = () => {
    const effect = copyPreset(def.id, newId(), `${def.name} copy`)
    if (!effect) return
    editNow((s) => ({ ...s, effects: [...s.effects, effect] }))
    set({ effectId: effect.id })
  }

  return (
    <aside className="panel right wide">
      <Section
        title="Preset"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Shown on all fixtures. Click to hide.' : 'Show on stage'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon" title="Copy to your own effects" onClick={copy}>
              <Copy size={15} />
            </button>
          </span>
        }
      >
        <h2 className="preset-name">{def.name}</h2>
        <p className="summary">{def.hint}. Presets come with HeavyLight and cannot be changed or deleted.</p>
        <PreviewStrip def={def} params={params} once={once} />
        <div className="form-grid">
          <Field label="On stage, try it" wide>
            <Select value={mapping} onChange={(m) => set({ effectMapping: m })} options={STAGE_MAPPINGS} />
          </Field>
        </div>
        <p className="summary">{n === 0 ? 'Not used by any layer yet. Pick it for a layer in the Scenes tab.' : `Used by ${layers(n)}.`}</p>
      </Section>

      <Section title="Set per layer">
        <p className="summary">Each layer that uses this preset has its own settings in the scene:</p>
        <ul className="preset-params">
          {def.params.map((p) => (
            <li key={p.key}>{p.label}</li>
          ))}
        </ul>
      </Section>

      <Section title="Make it your own">
        <p className="summary">
          A copy is rebuilt from curves, starting with what you see above, and you can change every part of it. Its shape then belongs to the effect: a layer still sets its speed and its
          colours, but no longer things like the number of segments.
        </p>
        <button className="button small primary" onClick={copy}>
          <Copy size={14} /> Copy to my effects
        </button>
      </Section>
    </aside>
  )
}

export function EffectEditor() {
  const preset = useStore((s) => PRESETS.find((e) => e.id === presetId(s.effectId)))
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
  const def = useMemo(() => effect && compileCustom(effect), [effect])
  const once = useMemo(() => (tempo: number) => (effect ? oneShotSeconds(effect, tempo) : null), [effect])

  if (preset) return <PresetView def={preset} />
  if (!effect || !def) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select an effect on the left, create a new one, or copy a preset.</p>
      </aside>
    )
  }

  const { brightness, colour } = effect
  const change = (patch: Partial<CustomEffect>, key?: string) => editEffect(effect.id, patch, key && `${key}-${effect.id}`)
  const n = usedBy(customKey(effect.id), looks)
  const drives = [brightness, colour].flatMap((channel) => (channel.mode === 'curve' ? drivesOf(channel) : []))
  const countsBeats = drives.some((d) => d.sync === 'beats')
  const usesPosition = drives.some((d) => d.over === 'position')

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
            <button className="icon" title={n ? `Delete effect (${layers(n)} become${n === 1 ? 's' : ''} a plain colour)` : 'Delete effect'} onClick={remove}>
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
        <PreviewStrip def={def} params={OWN_PARAMS} once={once} />
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
        <p className="summary">{n === 0 ? 'Use it in the Scenes tab: it is listed with the effects of every layer.' : `Used by ${layers(n)}. Changes apply to all of them.`}</p>
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
          <StackEditor stack={brightness} low="dark" high="full" onChange={(patch, key) => change({ brightness: { ...brightness, ...patch } }, key && `brightness-${key}`)} />
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
            <StackEditor stack={colour} low="start" high="end" onChange={(patch, key) => change({ colour: { ...colour, ...patch } }, key && `colour-${key}`)} />
          </>
        )}
      </Section>

      <Section title="Background">
        <Segmented
          value={effect.background ? 'colour' : 'black'}
          onChange={(v) => change({ background: v === 'colour' ? '#101040' : undefined })}
          options={[
            { value: 'black', label: 'Dark' },
            { value: 'colour', label: 'A colour' }
          ]}
        />
        {effect.background ? (
          <div className="channel-fixed">
            <ColorInput value={effect.background} onChange={(background) => change({ background }, 'background')} />
          </div>
        ) : null}
        <p className="summary background-note">
          {effect.background ? 'Where the brightness is low, this colour shows instead of darkness.' : 'Where the brightness is low, the pixels go dark and layers below show through when the layer adds light.'}
        </p>
      </Section>

      <SaveBar items={[{ kind: 'effects', ids: [effect.id] }]} noun="effect" />
    </aside>
  )
}
