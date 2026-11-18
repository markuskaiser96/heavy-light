import type { ParamValue } from './types'

/**
 * Pixel effects. Every effect is a pure function of position (u in 0..1), time and parameters,
 * so the engine and any preview always agree and nothing has to be kept in sync.
 */

export type ParamDef =
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'number'; default: number; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; type: 'toggle'; default: boolean }

export interface RenderArgs {
  /** RGB triples, 0..1, one per pixel. */
  out: Float32Array
  /** Effect coordinate per pixel. */
  u: Float32Array
  count: number
  /** Seconds since the look started. */
  t: number
  /** Parameters with colours already parsed to [r, g, b]. */
  p: Record<string, number | boolean | RGB>
}

export type RGB = [number, number, number]

export interface EffectDef {
  id: string
  name: string
  hint: string
  params: ParamDef[]
  render(args: RenderArgs): void
}

export function parseColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const frac = (x: number) => x - Math.floor(x)
const TAU = Math.PI * 2

/** Cheap deterministic hash → 0..1. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function hsv(h: number, s: number, out: Float32Array, o: number): void {
  const k = frac(h) * 6
  const f = (n: number) => {
    const x = (n + k) % 6
    return 1 - s * Math.max(0, Math.min(x, 4 - x, 1))
  }
  out[o] = f(5)
  out[o + 1] = f(3)
  out[o + 2] = f(1)
}

function mix(a: RGB, b: RGB, f: number, out: Float32Array, o: number): void {
  out[o] = a[0] + (b[0] - a[0]) * f
  out[o + 1] = a[1] + (b[1] - a[1]) * f
  out[o + 2] = a[2] + (b[2] - a[2]) * f
}

const color = (key: string, label: string, def: string): ParamDef => ({ key, label, type: 'color', default: def })
const num = (key: string, label: string, def: number, min: number, max: number, step: number, unit?: string): ParamDef => ({
  key,
  label,
  type: 'number',
  default: def,
  min,
  max,
  step,
  unit
})
const toggle = (key: string, label: string, def: boolean): ParamDef => ({ key, label, type: 'toggle', default: def })

const BLACK = '#000000'

export const EFFECTS: EffectDef[] = [
  {
    id: 'solid',
    name: 'Solid',
    hint: 'One colour on every pixel',
    params: [color('color', 'Colour', '#ff7a1a')],
    render({ out, count, p }) {
      const c = p.color as RGB
      for (let i = 0; i < count; i++) mix(c, c, 0, out, i * 3)
    }
  },
  {
    id: 'gradient',
    name: 'Gradient',
    hint: 'Blend between two colours, optionally scrolling',
    params: [
      color('colorA', 'From', '#ff2d6f'),
      color('colorB', 'To', '#2d6bff'),
      num('repeats', 'Repeats', 1, 0.25, 8, 0.25, '×'),
      num('speed', 'Scroll', 0, -4, 4, 0.05, 'Hz'),
      toggle('mirror', 'Mirror', false)
    ],
    render({ out, u, count, t, p }) {
      const a = p.colorA as RGB
      const b = p.colorB as RGB
      const repeats = p.repeats as number
      const shift = t * (p.speed as number)
      // A still, single gradient should reach colour B at the far end instead of wrapping.
      const still = (p.speed as number) === 0 && repeats <= 1
      for (let i = 0; i < count; i++) {
        const x = u[i] * repeats - shift
        let f = still ? Math.min(1, x) : frac(x)
        if (p.mirror) f = 1 - Math.abs(2 * f - 1)
        mix(a, b, f, out, i * 3)
      }
    }
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    hint: 'Full colour wheel along the fixtures',
    params: [
      num('repeats', 'Repeats', 1, 0.1, 8, 0.1, '×'),
      num('speed', 'Speed', 0.25, -4, 4, 0.05, 'Hz'),
      num('saturation', 'Saturation', 1, 0, 1, 0.01)
    ],
    render({ out, u, count, t, p }) {
      const shift = t * (p.speed as number)
      for (let i = 0; i < count; i++) hsv(u[i] * (p.repeats as number) - shift, p.saturation as number, out, i * 3)
    }
  },
  {
    id: 'chase',
    name: 'Chase',
    hint: 'Segments of light running along the fixtures',
    params: [
      color('color', 'Colour', '#ffffff'),
      color('background', 'Background', BLACK),
      num('count', 'Segments', 1, 1, 16, 1),
      num('width', 'Length', 0.3, 0.02, 1, 0.01),
      num('speed', 'Speed', 1, -8, 8, 0.05, 'Hz'),
      num('tail', 'Tail fade', 1, 0, 1, 0.01),
      toggle('bounce', 'Bounce', false)
    ],
    render({ out, u, count, t, p }) {
      const c = p.color as RGB
      const bg = p.background as RGB
      const n = p.count as number
      const width = p.width as number
      const tail = p.tail as number
      const phase = t * (p.speed as number)
      if (p.bounce) {
        const head = 1 - Math.abs(2 * frac(phase / 2) - 1)
        const half = width / 2
        for (let i = 0; i < count; i++) {
          const d = Math.abs(u[i] - head)
          mix(bg, c, d < half ? 1 - tail * (d / half) : 0, out, i * 3)
        }
        return
      }
      const reverse = (p.speed as number) < 0
      for (let i = 0; i < count; i++) {
        // d = distance behind the head, in units of one segment spacing.
        let d = frac(phase - u[i] * n)
        if (reverse) d = frac(1 - d)
        mix(bg, c, d < width ? 1 - tail * (d / width) : 0, out, i * 3)
      }
    }
  },
  {
    id: 'wave',
    name: 'Wave',
    hint: 'Soft sine wave between two colours',
    params: [
      color('colorA', 'Peak', '#00e0ff'),
      color('colorB', 'Trough', '#001030'),
      num('repeats', 'Waves', 2, 0.25, 12, 0.25, '×'),
      num('speed', 'Speed', 0.5, -6, 6, 0.05, 'Hz')
    ],
    render({ out, u, count, t, p }) {
      const a = p.colorA as RGB
      const b = p.colorB as RGB
      const shift = t * (p.speed as number)
      for (let i = 0; i < count; i++) mix(b, a, 0.5 + 0.5 * Math.sin(TAU * (u[i] * (p.repeats as number) - shift)), out, i * 3)
    }
  },
  {
    id: 'pulse',
    name: 'Pulse',
    hint: 'Everything breathes or hits on the beat',
    params: [
      color('color', 'Colour', '#ff3b30'),
      num('rate', 'Rate', 2, 0.1, 12, 0.05, 'Hz'),
      num('floor', 'Minimum', 0, 0, 1, 0.01),
      toggle('hit', 'Hit and decay', true)
    ],
    render({ out, count, t, p }) {
      const c = p.color as RGB
      const f = frac(t * (p.rate as number))
      const shape = p.hit ? (1 - f) * (1 - f) : 0.5 - 0.5 * Math.cos(TAU * f)
      const level = (p.floor as number) + (1 - (p.floor as number)) * shape
      for (let i = 0; i < count; i++) {
        out[i * 3] = c[0] * level
        out[i * 3 + 1] = c[1] * level
        out[i * 3 + 2] = c[2] * level
      }
    }
  },
  {
    id: 'strobe',
    name: 'Strobe',
    hint: 'Hard flashes',
    params: [color('color', 'Colour', '#ffffff'), num('rate', 'Rate', 10, 1, 25, 0.5, 'Hz'), num('duty', 'On time', 0.3, 0.05, 0.95, 0.01)],
    render({ out, count, t, p }) {
      const c = p.color as RGB
      const on = frac(t * (p.rate as number)) < (p.duty as number) ? 1 : 0
      for (let i = 0; i < count; i++) {
        out[i * 3] = c[0] * on
        out[i * 3 + 1] = c[1] * on
        out[i * 3 + 2] = c[2] * on
      }
    }
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    hint: 'Random pixels flash and fade',
    params: [
      color('color', 'Colour', '#ffffff'),
      color('background', 'Background', BLACK),
      num('density', 'Density', 0.15, 0.01, 1, 0.01),
      num('rate', 'Rate', 4, 0.5, 20, 0.5, 'Hz')
    ],
    render({ out, count, t, p }) {
      const c = p.color as RGB
      const bg = p.background as RGB
      for (let i = 0; i < count; i++) {
        const x = t * (p.rate as number) + hash(i, 7)
        const f = frac(x)
        const on = hash(i, Math.floor(x) + 13) < (p.density as number)
        mix(bg, c, on ? (1 - f) * (1 - f) : 0, out, i * 3)
      }
    }
  },
  {
    id: 'plasma',
    name: 'Plasma',
    hint: 'Slow organic movement between two colours',
    params: [
      color('colorA', 'Colour A', '#ff5a00'),
      color('colorB', 'Colour B', '#5b00ff'),
      num('scale', 'Scale', 1, 0.2, 6, 0.1, '×'),
      num('speed', 'Speed', 0.4, 0, 4, 0.05, 'Hz')
    ],
    render({ out, u, count, t, p }) {
      const a = p.colorA as RGB
      const b = p.colorB as RGB
      const s = p.scale as number
      const v = t * (p.speed as number)
      for (let i = 0; i < count; i++) {
        const x = u[i] * s
        const n = 0.5 + 0.25 * Math.sin(x * 6.28 + v * 1.7) + 0.15 * Math.sin(x * 13.1 - v * 2.3 + 1.3) + 0.1 * Math.sin(x * 3.7 + v * 0.9 + 4.1)
        mix(a, b, n, out, i * 3)
      }
    }
  },
  {
    id: 'wipe',
    name: 'Wipe',
    hint: 'Fills the fixtures from one end',
    params: [
      color('color', 'Colour', '#ffd000'),
      color('background', 'Background', BLACK),
      num('duration', 'Duration', 1, 0.05, 10, 0.05, 's'),
      toggle('loop', 'Repeat', false),
      toggle('reverse', 'Reverse', false)
    ],
    render({ out, u, count, t, p }) {
      const c = p.color as RGB
      const bg = p.background as RGB
      const x = t / (p.duration as number)
      const progress = p.loop ? frac(x) : Math.min(1, x)
      for (let i = 0; i < count; i++) {
        const pos = p.reverse ? 1 - u[i] : u[i]
        mix(bg, c, pos <= progress ? 1 : 0, out, i * 3)
      }
    }
  }
]

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]))

export function defaultParams(effectId: string): Record<string, ParamValue> {
  const def = EFFECT_BY_ID.get(effectId)
  return def ? Object.fromEntries(def.params.map((p) => [p.key, p.default])) : {}
}

/** Fills in defaults, clamps numbers and parses colours. */
export function prepareParams(def: EffectDef, params: Record<string, ParamValue>): RenderArgs['p'] {
  const out: RenderArgs['p'] = {}
  for (const d of def.params) {
    const v = params[d.key]
    if (d.type === 'color') out[d.key] = parseColor(typeof v === 'string' ? v : d.default)
    else if (d.type === 'toggle') out[d.key] = typeof v === 'boolean' ? v : d.default
    else out[d.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.default
  }
  return out
}
