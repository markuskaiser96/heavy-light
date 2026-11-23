import { EFFECT_BY_ID, parseColor, type EffectDef, type ParamDef, type RGB } from './effects'
import { hash01, seedOf } from './random'
import type { Curve, CurveDrive, CurveStack, CustomEffect, ExtraCurve, GradientStop, ParamValue } from './types'

/**
 * Effects the user builds: brightness and colour, each either fixed or read from a drawn curve.
 * A curve runs over time (everything pulses together) or over the position of the pixels, where
 * it can also travel (a chase). Like the built-in effects, the result is a pure function of
 * position, time and beat.
 */

const PREFIX = 'custom:'
export const customKey = (id: string): string => PREFIX + id
export const customId = (effect: string): string | null => (effect.startsWith(PREFIX) ? effect.slice(PREFIX.length) : null)

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const frac = (x: number): number => x - Math.floor(x)

// ---------- curves ----------

export const CURVE_PRESETS: { id: string; label: string; curve: Curve }[] = [
  { id: 'sine', label: 'Sine', curve: { shape: 'smooth', points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] } },
  { id: 'triangle', label: 'Triangle', curve: { shape: 'linear', points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] } },
  { id: 'square', label: 'Square', curve: { shape: 'step', points: [{ x: 0, y: 1 }, { x: 0.5, y: 0 }] } },
  { id: 'decay', label: 'Hit and decay', curve: { shape: 'linear', points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
  { id: 'rise', label: 'Rise', curve: { shape: 'linear', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } },
  { id: 'bump', label: 'Bump', curve: { shape: 'smooth', points: [{ x: 0, y: 0 }, { x: 0.35, y: 0 }, { x: 0.5, y: 1 }, { x: 0.65, y: 0 }, { x: 1, y: 0 }] } }
]

/** Height of the curve at x (0..1). */
export function evalCurve(curve: Curve, x: number): number {
  const pts = curve.points
  if (pts.length === 0) return 0
  if (x <= pts[0].x) return pts[0].y
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]
    if (x >= b.x) continue
    const a = pts[i - 1]
    if (curve.shape === 'step') return a.y
    const f = (x - a.x) / Math.max(1e-9, b.x - a.x)
    // Smooth eases in and out of every point, so three points make a sine-like wave and nothing overshoots.
    return a.y + (b.y - a.y) * (curve.shape === 'smooth' ? f * f * (3 - 2 * f) : f)
  }
  return pts[pts.length - 1].y
}

const SAMPLES = 512

/** The curve as a table, so reading it per pixel is cheap. Entry SAMPLES is x = 1. */
function sampleCurve(curve: Curve): Float32Array {
  const table = new Float32Array(SAMPLES + 1)
  for (let i = 0; i <= SAMPLES; i++) table[i] = clamp01(evalCurve(curve, i / SAMPLES))
  return table
}

function read(table: Float32Array, x: number): number {
  const at = clamp01(x) * SAMPLES
  const i = Math.min(SAMPLES - 1, at | 0)
  return table[i] + (table[i + 1] - table[i]) * (at - i)
}

/** Colour of a gradient at 0..1, written into `out`. */
export function gradientAt(stops: GradientStop[], at: number, out: Float32Array | number[], o = 0): void {
  if (stops.length === 0) {
    out[o] = out[o + 1] = out[o + 2] = 1
    return
  }
  let a = stops[0]
  let b = stops[stops.length - 1]
  if (at <= a.at) b = a
  else if (at >= b.at) a = b
  else
    for (let i = 1; i < stops.length; i++)
      if (at < stops[i].at) {
        a = stops[i - 1]
        b = stops[i]
        break
      }
  const f = b.at > a.at ? (at - a.at) / (b.at - a.at) : 0
  const ca = parseColor(a.color)
  const cb = parseColor(b.color)
  for (let k = 0; k < 3; k++) out[o + k] = ca[k] + (cb[k] - ca[k]) * f
}

// ---------- effects ----------

export function newDrive(preset = 'sine', patch: Partial<CurveDrive> = {}): CurveDrive {
  const curve = CURVE_PRESETS.find((p) => p.id === preset)?.curve ?? CURVE_PRESETS[0].curve
  return { curve: { shape: curve.shape, points: curve.points.map((p) => ({ ...p })) }, over: 'time', repeats: 1, sync: 'hz', hz: 1, beats: 1, direction: 'forward', once: false, ...patch }
}

export function newCustomEffect(id: string, name: string): CustomEffect {
  return {
    id,
    name,
    brightness: { mode: 'curve', value: 1, drive: newDrive('sine') },
    colour: {
      mode: 'fixed',
      color: '#ff7a1a',
      gradient: [
        { at: 0, color: '#ff2d6f' },
        { at: 1, color: '#2d6bff' }
      ],
      drive: newDrive('rise', { over: 'position' })
    }
  }
}

const number = (v: unknown, fallback: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Shortest pass in beats: a 1/64 note. */
export const MIN_BEATS = 1 / 16

function normalizeDrive(raw: Partial<CurveDrive> | undefined, base: CurveDrive): CurveDrive {
  const points = (raw?.curve?.points ?? [])
    .filter((p) => typeof p?.x === 'number' && typeof p?.y === 'number')
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x)
  return {
    curve: { shape: oneOf(raw?.curve?.shape, ['smooth', 'linear', 'step'], base.curve.shape), points: points.length ? points : base.curve.points },
    over: oneOf(raw?.over, ['time', 'position'], base.over),
    repeats: number(raw?.repeats, base.repeats, 0.1, 32),
    sync: oneOf(raw?.sync, ['hz', 'beats'], base.sync),
    hz: number(raw?.hz, base.hz, 0, 30),
    beats: number(raw?.beats, base.beats, MIN_BEATS, 64),
    direction: oneOf(raw?.direction, ['forward', 'backward', 'bounce', 'random'], base.direction),
    once: raw?.once === true,
    ...(raw?.scatter === 'pixel' || raw?.scatter === 'fixture' ? { scatter: raw.scatter, ...(typeof raw.chance === 'number' && raw.chance < 1 ? { chance: number(raw.chance, 1, 0.01, 1) } : {}) } : {})
  }
}

/** Most curves one channel can combine. */
export const MAX_CURVES = 4

function normalizeStack(raw: Partial<CurveStack> | undefined, base: CurveDrive): CurveStack {
  const more = (Array.isArray(raw?.more) ? raw.more : []).slice(0, MAX_CURVES - 1).map(
    (m): ExtraCurve => ({ drive: normalizeDrive(m?.drive, base), mix: oneOf(m?.mix, ['add', 'multiply', 'max'], 'add'), amount: number(m?.amount, 1, 0, 1) })
  )
  return {
    drive: normalizeDrive(raw?.drive, base),
    ...(typeof raw?.amount === 'number' && raw.amount < 1 ? { amount: number(raw.amount, 1, 0, 1) } : {}),
    ...(more.length ? { more } : {})
  }
}

/** Every curve of a channel, the first one first. */
export const drivesOf = (stack: CurveStack): CurveDrive[] => [stack.drive, ...(stack.more ?? []).map((m) => m.drive)]

/** Fills in whatever a file lacks or got wrong, so the renderer can rely on every field. */
export function normalizeEffect(raw: Partial<CustomEffect>): CustomEffect {
  const base = newCustomEffect(String(raw.id), 'Effect')
  const stops = (raw.colour?.gradient ?? []).filter((s) => isColor(s?.color) && typeof s.at === 'number').map((s) => ({ at: clamp01(s.at), color: s.color }))
  return {
    id: base.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : base.name,
    ...(typeof raw.folder === 'string' ? { folder: raw.folder } : {}),
    brightness: {
      mode: oneOf(raw.brightness?.mode, ['fixed', 'curve'], base.brightness.mode),
      value: number(raw.brightness?.value, base.brightness.value, 0, 1),
      ...normalizeStack(raw.brightness, base.brightness.drive)
    },
    colour: {
      mode: oneOf(raw.colour?.mode, ['fixed', 'curve'], base.colour.mode),
      color: isColor(raw.colour?.color) ? raw.colour.color : base.colour.color,
      gradient: stops.length ? stops.sort((a, b) => a.at - b.at) : base.colour.gradient,
      ...normalizeStack(raw.colour, base.colour.drive)
    },
    ...(isColor(raw.background) && raw.background !== '#000000' ? { background: raw.background } : {})
  }
}

/**
 * How long the one-shot parts of an effect take in seconds at this tempo, or null if nothing in it
 * runs only once. Used to play a preview again and again.
 */
export function oneShotSeconds(effect: CustomEffect, bpm: number): number | null {
  let longest: number | null = null
  for (const channel of [effect.brightness, effect.colour]) {
    if (channel.mode !== 'curve') continue
    for (const d of drivesOf(channel)) {
      if (!d.once || (d.direction === 'random' && d.over === 'position')) continue
      const pass = d.sync === 'beats' ? (d.beats * 60) / Math.max(1, bpm) : d.hz > 0 ? 1 / d.hz : 0
      longest = Math.max(longest ?? 0, pass * (d.direction === 'bounce' ? 2 : 1))
    }
  }
  return longest
}

/** What a layer can set on every custom effect. Its colours come on top, see `layerParams`. */
const LAYER_PARAMS: ParamDef[] = [{ key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0.1, max: 8, step: 0.05, unit: '×' }]

/** Parameter of a layer that replaces the n-th colour of the gradient. */
const stopKey = (index: number): string => `stop${index + 1}`

/**
 * What a layer can set on this effect: its speed, and each of its colours. The colours default to the
 * effect's own, so a layer that sets none follows the effect when its colours change.
 */
export function layerParams(effect: CustomEffect): ParamDef[] {
  const { colour, background } = effect
  const colours: ParamDef[] =
    colour.mode === 'fixed'
      ? [{ key: 'color', label: 'Colour', type: 'color', default: colour.color }]
      : colour.gradient.map((s, i): ParamDef => ({ key: stopKey(i), label: `Gradient colour ${i + 1}`, type: 'color', default: s.color }))
  return [...LAYER_PARAMS, ...colours, ...(background ? [{ key: 'background', label: 'Background', type: 'color', default: background } as ParamDef] : [])]
}

/** Beats per second assumed when nobody counts beats (a preview outside the engine). */
const FALLBACK_BEATS = 2

/** A sampled curve, and where along it anything other than zero is: what a random jump has to keep on the pixels. */
interface Table {
  values: Float32Array
  from: number
  to: number
}

function tableOf(curve: Curve): Table {
  const values = sampleCurve(curve)
  let first = 0
  let last = SAMPLES
  while (first < SAMPLES && values[first] < 0.004) first++
  while (last > first && values[last] < 0.004) last--
  // One sample of room on each side, so the slopes down to zero stay in.
  return { values, from: Math.max(0, first - 1) / SAMPLES, to: Math.min(SAMPLES, last + 1) / SAMPLES }
}

interface Pixels {
  u: Float32Array
  count: number
  owner?: Uint16Array
}

/** Reads one drive for every pixel into `out` (0..1). */
function runDrive(drive: CurveDrive, { values: table, from, to }: Table, out: Float32Array, { u, count, owner }: Pixels, t: number, beat: number, speed: number, seed: number): void {
  const moving = drive.sync === 'beats' || drive.hz !== 0
  const run = Math.max(0, (drive.sync === 'beats' ? beat / drive.beats : t * drive.hz) * speed)
  const random = drive.direction === 'random' && drive.over === 'position'
  const back = drive.direction === 'backward'
  const bounce = drive.direction === 'bounce'
  if (drive.over === 'time' && drive.scatter) {
    // Every pixel (or fixture) is somewhere else in the pass, and only some of them take part in each pass.
    const chance = drive.chance ?? 1
    const perPixel = drive.scatter === 'pixel'
    for (let i = 0; i < count; i++) {
      const who = perPixel ? i : owner ? owner[i] : 0
      // Once: all start with the note, so only the draw of who takes part is left to chance.
      const r = drive.once ? Math.min(bounce ? 2 : 1, run) : run + (moving ? hash01(who, seed + 101) : 0)
      const pass = drive.once ? 0 : Math.floor(r)
      if (chance < 1 && hash01(who * 31 + pass, seed + 211) >= chance) {
        out[i] = 0
        continue
      }
      const f = drive.once && !bounce ? r : frac(r)
      const x = !moving ? hash01(who, seed + 101) : bounce ? 1 - Math.abs(2 * frac(r / 2) - 1) : back ? 1 - f : f
      out[i] = read(table, x)
    }
    return
  }
  if (random) {
    // A new place on every pass, and another one on each fixture. A curve that is dark at its ends
    // (a section, a dot) stays whole on the pixels; one that is not wraps around.
    const pass = Math.floor(run + 1e-6)
    const whole = from <= 0 && to >= 1
    let of = -1
    let shift = 0
    for (let i = 0; i < count; i++) {
      const fixture = owner ? owner[i] : 0
      if (fixture !== of) {
        of = fixture
        const r = hash01(pass, seed + fixture * 7919)
        shift = whole ? r : r * (1 - to + from) - from
      }
      const x = drive.repeats <= 1 ? u[i] * drive.repeats : frac(u[i] * drive.repeats)
      out[i] = read(table, whole ? frac(x - shift) : x - shift)
    }
    return
  }
  // Once: one pass (there and back when bouncing), then it stays where it ended.
  const done = drive.once ? Math.min(bounce ? 2 : 1, run) : run
  const passes = back ? -done : done
  // Back and forth: a triangle 0 → 1 → 0, one way per pass.
  const there = bounce ? 1 - Math.abs(2 * frac(done / 2) - 1) : 0
  if (drive.over === 'time') {
    const x = bounce ? there : drive.once ? (back ? 1 - done : done) : !moving ? 0 : frac(passes)
    out.fill(read(table, x), 0, count)
    return
  }
  if (drive.once && !bounce) {
    // The curve passes through without wrapping: it starts just outside one end and ends just outside the other.
    const span = drive.repeats + 1
    for (let i = 0; i < count; i++) out[i] = read(table, back ? u[i] * drive.repeats - drive.repeats + done * span : u[i] * drive.repeats + 1 - done * span)
    return
  }
  const shift = bounce ? there : passes
  // A single curve that stands still reaches its end at the last pixel instead of wrapping to its start.
  const still = !moving && drive.repeats <= 1
  for (let i = 0; i < count; i++) {
    const x = u[i] * drive.repeats - shift
    out[i] = read(table, still ? x : frac(x))
  }
}

const GRADIENT = 256

interface Part {
  drive: CurveDrive
  table: Table
  mix: ExtraCurve['mix']
  amount: number
}

const partsOf = (stack: CurveStack): Part[] => [
  { drive: stack.drive, table: tableOf(stack.drive.curve), mix: 'add', amount: stack.amount ?? 1 },
  ...(stack.more ?? []).map((m): Part => ({ drive: m.drive, table: tableOf(m.drive.curve), mix: m.mix, amount: m.amount }))
]

/** Reads all curves of a channel and combines them into `out` (0..1). `scratch` holds one curve at a time. */
function runStack(parts: Part[], out: Float32Array, scratch: Float32Array, pixels: Pixels, t: number, beat: number, speed: number, seed: number): void {
  const { count } = pixels
  for (let n = 0; n < parts.length; n++) {
    const { drive, table, mix, amount } = parts[n]
    runDrive(drive, table, n === 0 ? out : scratch, pixels, t, beat, speed, seed + n * 17)
    if (n === 0) {
      if (amount !== 1) for (let i = 0; i < count; i++) out[i] *= amount
    } else if (mix === 'add') for (let i = 0; i < count; i++) out[i] = Math.min(1, out[i] + scratch[i] * amount)
    else if (mix === 'max') for (let i = 0; i < count; i++) out[i] = Math.max(out[i], scratch[i] * amount)
    else for (let i = 0; i < count; i++) out[i] *= 1 - amount + amount * scratch[i]
  }
}

const rgbOf = (v: unknown, fallback: RGB): RGB => (Array.isArray(v) ? (v as RGB) : fallback)

/** Turns a custom effect into the same kind of effect the built-in ones are. */
export function compileCustom(effect: CustomEffect): EffectDef {
  const { brightness, colour } = effect
  const levelParts = brightness.mode === 'curve' ? partsOf(brightness) : null
  const colourParts = colour.mode === 'curve' ? partsOf(colour) : null
  const seed = seedOf(effect.id)
  const ownColour = parseColor(colour.color)
  const ownBackground = effect.background ? parseColor(effect.background) : null
  const ownStops = colour.gradient.map((s) => parseColor(s.color))
  const ramp = new Float32Array((GRADIENT + 1) * 3)
  /** The parameters the ramp was last built for: a layer can replace the colours of the gradient. */
  let rampFor: unknown = null
  const buildRamp = (p: Record<string, unknown>) => {
    const stops = colour.gradient.map((s, i) => ({ at: s.at, rgb: rgbOf(p[stopKey(i)], ownStops[i]) }))
    for (let g = 0; g <= GRADIENT; g++) {
      const at = g / GRADIENT
      let a = stops[0]
      let b = stops[stops.length - 1]
      if (at <= a.at) b = a
      else if (at >= b.at) a = b
      else
        for (let i = 1; i < stops.length; i++)
          if (at < stops[i].at) {
            a = stops[i - 1]
            b = stops[i]
            break
          }
      const f = b.at > a.at ? (at - a.at) / (b.at - a.at) : 0
      for (let k = 0; k < 3; k++) ramp[g * 3 + k] = a.rgb[k] + (b.rgb[k] - a.rgb[k]) * f
    }
  }
  let level = new Float32Array(0)
  let hue = new Float32Array(0)
  let scratch = new Float32Array(0)

  return {
    id: customKey(effect.id),
    name: effect.name,
    hint: 'Your own effect',
    params: layerParams(effect),
    render({ out, u, count, t, beat, p, owner }) {
      if (level.length < count) {
        level = new Float32Array(count)
        hue = new Float32Array(count)
        scratch = new Float32Array(count)
      }
      const speed = typeof p.speed === 'number' ? p.speed : 1
      const beats = beat ?? t * FALLBACK_BEATS
      const pixels = { u, count, owner }
      if (levelParts) runStack(levelParts, level, scratch, pixels, t, beats, speed, seed)
      if (colourParts) {
        runStack(colourParts, hue, scratch, pixels, t, beats, speed, seed + 1)
        if (rampFor !== p) {
          buildRamp(p)
          rampFor = p
        }
      }
      const fixed = rgbOf(p.color, ownColour)
      const bg = ownBackground && rgbOf(p.background, ownBackground)
      for (let i = 0; i < count; i++) {
        const l = levelParts ? level[i] : brightness.value
        const o = i * 3
        let r = fixed[0]
        let g = fixed[1]
        let b = fixed[2]
        if (colourParts) {
          const at = hue[i] * GRADIENT
          const n = Math.min(GRADIENT - 1, at | 0) * 3
          const f = at - n / 3
          r = ramp[n] + (ramp[n + 3] - ramp[n]) * f
          g = ramp[n + 1] + (ramp[n + 4] - ramp[n + 1]) * f
          b = ramp[n + 2] + (ramp[n + 5] - ramp[n + 2]) * f
        }
        if (bg) {
          out[o] = bg[0] + (r - bg[0]) * l
          out[o + 1] = bg[1] + (g - bg[1]) * l
          out[o + 2] = bg[2] + (b - bg[2]) * l
        } else {
          out[o] = r * l
          out[o + 1] = g * l
          out[o + 2] = b * l
        }
      }
    }
  }
}

/** The effect a layer names: a built-in one, or one of the show's own. */
export function resolveEffect(effects: CustomEffect[], effect: string): EffectDef | undefined {
  const id = customId(effect)
  if (id === null) return EFFECT_BY_ID.get(effect)
  const custom = effects.find((e) => e.id === id)
  return custom && compileCustom(custom)
}

export function customDefaults(): Record<string, ParamValue> {
  return Object.fromEntries(LAYER_PARAMS.map((p) => [p.key, p.default]))
}
