import { EFFECT_BY_ID, parseColor, type EffectDef, type ParamDef, type RGB } from './effects'
import type { Curve, CurveDrive, CustomEffect, GradientStop, ParamValue } from './types'

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
  return { curve: { shape: curve.shape, points: curve.points.map((p) => ({ ...p })) }, over: 'time', repeats: 1, sync: 'hz', hz: 1, beats: 1, direction: 'forward', ...patch }
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
    beats: number(raw?.beats, base.beats, 0.125, 64),
    direction: oneOf(raw?.direction, ['forward', 'backward', 'bounce'], base.direction)
  }
}

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
      drive: normalizeDrive(raw.brightness?.drive, base.brightness.drive)
    },
    colour: {
      mode: oneOf(raw.colour?.mode, ['fixed', 'curve'], base.colour.mode),
      color: isColor(raw.colour?.color) ? raw.colour.color : base.colour.color,
      gradient: stops.length ? stops.sort((a, b) => a.at - b.at) : base.colour.gradient,
      drive: normalizeDrive(raw.colour?.drive, base.colour.drive)
    }
  }
}

/** What a layer can still set on a custom effect. */
const LAYER_PARAMS: ParamDef[] = [{ key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0.1, max: 8, step: 0.05, unit: '×' }]

/** Beats per second assumed when nobody counts beats (a preview outside the engine). */
const FALLBACK_BEATS = 2

/** Reads one drive for every pixel into `values` (0..1). */
function runDrive(drive: CurveDrive, table: Float32Array, values: Float32Array, u: Float32Array, count: number, t: number, beat: number, speed: number): void {
  const moving = drive.sync === 'beats' || drive.hz !== 0
  let passes = (drive.sync === 'beats' ? beat / drive.beats : t * drive.hz) * speed
  if (drive.direction === 'backward') passes = -passes
  // Back and forth: a triangle 0 → 1 → 0, one way per pass.
  const there = drive.direction === 'bounce' ? 1 - Math.abs(2 * frac(passes / 2) - 1) : 0
  if (drive.over === 'time') {
    const x = drive.direction === 'bounce' ? there : !moving ? 0 : frac(passes)
    values.fill(read(table, x), 0, count)
    return
  }
  const shift = drive.direction === 'bounce' ? there : passes
  // A single curve that stands still reaches its end at the last pixel instead of wrapping to its start.
  const still = !moving && drive.repeats <= 1
  for (let i = 0; i < count; i++) {
    const x = u[i] * drive.repeats - shift
    values[i] = read(table, still ? x : frac(x))
  }
}

const GRADIENT = 256

/** Turns a custom effect into the same kind of effect the built-in ones are. */
export function compileCustom(effect: CustomEffect): EffectDef {
  const { brightness, colour } = effect
  const levelTable = brightness.mode === 'curve' ? sampleCurve(brightness.drive.curve) : null
  const colourTable = colour.mode === 'curve' ? sampleCurve(colour.drive.curve) : null
  const fixed: RGB = parseColor(colour.color)
  const ramp = new Float32Array((GRADIENT + 1) * 3)
  if (colourTable) for (let i = 0; i <= GRADIENT; i++) gradientAt(colour.gradient, i / GRADIENT, ramp, i * 3)
  let level = new Float32Array(0)
  let hue = new Float32Array(0)

  return {
    id: customKey(effect.id),
    name: effect.name,
    hint: 'Your own effect',
    params: LAYER_PARAMS,
    render({ out, u, count, t, beat, p }) {
      if (level.length < count) {
        level = new Float32Array(count)
        hue = new Float32Array(count)
      }
      const speed = typeof p.speed === 'number' ? p.speed : 1
      const beats = beat ?? t * FALLBACK_BEATS
      if (levelTable) runDrive(brightness.drive, levelTable, level, u, count, t, beats, speed)
      if (colourTable) runDrive(colour.drive, colourTable, hue, u, count, t, beats, speed)
      for (let i = 0; i < count; i++) {
        const l = levelTable ? level[i] : brightness.value
        const o = i * 3
        if (colourTable) {
          const at = hue[i] * GRADIENT
          const g = Math.min(GRADIENT - 1, at | 0)
          const f = at - g
          for (let k = 0; k < 3; k++) out[o + k] = (ramp[g * 3 + k] + (ramp[g * 3 + 3 + k] - ramp[g * 3 + k]) * f) * l
        } else {
          out[o] = fixed[0] * l
          out[o + 1] = fixed[1] * l
          out[o + 2] = fixed[2] * l
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
