import { newCustomEffect, newDrive, normalizeEffect } from './custom'
import { EFFECT_BY_ID, EFFECTS } from './effects'
import type { Curve, CustomEffect } from './types'

/**
 * The built-in effects are the presets: fixed, listed read-only in the Effects tab. A preset can be
 * copied into the show as an effect of the user's own, rebuilt from curves with the preset's default
 * settings. The image effect is not a preset: it reads a picture, not curves, and is only chosen in a layer.
 */

/** How a preset is named where it is selected like a custom effect (the Effects tab, the stage preview). */
const PREFIX = 'preset:'
export const presetKey = (id: string): string => PREFIX + id
export const presetId = (key: string | null | undefined): string | null => (key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : null)

type Parts = Pick<CustomEffect, 'brightness' | 'colour'>

const curve = (shape: Curve['shape'], ...points: [number, number][]): Curve => ({ shape, points: points.map(([x, y]) => ({ x, y })) })
const full = (): CustomEffect['brightness'] => ({ mode: 'fixed', value: 1, drive: newDrive('sine') })
const plain = (color: string): CustomEffect['colour'] => ({ ...newCustomEffect('', '').colour, mode: 'fixed', color })
const through = (stops: [number, string][], drive: CustomEffect['colour']['drive']): CustomEffect['colour'] => ({
  mode: 'curve',
  color: stops[0][1],
  gradient: stops.map(([at, color]) => ({ at, color })),
  drive
})

/** Each preset as curves, with the preset's default colours and speeds. Presets missing here cannot be drawn as curves. */
const AS_CURVES: Record<string, () => Parts> = {
  solid: () => ({ brightness: full(), colour: plain('#ff7a1a') }),
  gradient: () => ({
    brightness: full(),
    colour: through(
      [
        [0, '#ff2d6f'],
        [1, '#2d6bff']
      ],
      newDrive('rise', { over: 'position', hz: 0 })
    )
  }),
  rainbow: () => ({
    brightness: full(),
    colour: through(
      ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i): [number, string] => [i / 6, c]),
      newDrive('rise', { over: 'position', hz: 0.25 })
    )
  }),
  chase: () => ({
    // One segment, 30 % long, brightest at its head and fading to the back.
    brightness: { mode: 'curve', value: 1, drive: { ...newDrive('rise', { over: 'position', hz: 1 }), curve: curve('linear', [0, 0], [0.7, 0], [1, 1]) } },
    colour: plain('#ffffff')
  }),
  wave: () => ({
    brightness: full(),
    colour: through(
      [
        [0, '#001030'],
        [1, '#00e0ff']
      ],
      newDrive('sine', { over: 'position', repeats: 2, hz: 0.5 })
    )
  }),
  pulse: () => ({
    // Hit and decay: full at once, then falling off quickly.
    brightness: { mode: 'curve', value: 1, drive: { ...newDrive('decay', { hz: 2 }), curve: curve('linear', [0, 1], [0.25, 0.5625], [0.5, 0.25], [0.75, 0.0625], [1, 0]) } },
    colour: plain('#ff3b30')
  }),
  strobe: () => ({
    brightness: { mode: 'curve', value: 1, drive: { ...newDrive('square', { hz: 10 }), curve: curve('step', [0, 1], [0.3, 0]) } },
    colour: plain('#ffffff')
  }),
  sparkle: () => ({
    // Every pixel flashes and fades in its own time, and only some of them on each pass.
    brightness: {
      mode: 'curve',
      value: 1,
      drive: { ...newDrive('decay', { hz: 4, scatter: 'pixel', chance: 0.15 }), curve: curve('linear', [0, 1], [0.25, 0.5625], [0.5, 0.25], [0.75, 0.0625], [1, 0]) }
    },
    colour: plain('#ffffff')
  }),
  plasma: () => ({
    // Three waves of different lengths drifting against each other, added up.
    brightness: full(),
    colour: {
      ...through(
        [
          [0, '#ff5a00'],
          [1, '#5b00ff']
        ],
        newDrive('sine', { over: 'position', repeats: 1, hz: 0.11, direction: 'backward' })
      ),
      amount: 0.5,
      more: [
        { drive: newDrive('sine', { over: 'position', repeats: 2.1, hz: 0.15 }), mix: 'add', amount: 0.3 },
        { drive: newDrive('sine', { over: 'position', repeats: 0.6, hz: 0.06, direction: 'backward' }), mix: 'add', amount: 0.2 }
      ]
    }
  }),
  wipe: () => ({
    // Comes in at one end once and stays: the fixtures fill up within a second.
    brightness: { mode: 'curve', value: 1, drive: { ...newDrive('square', { over: 'position', hz: 0.5, once: true }), curve: curve('step', [0, 1], [1, 0]) } },
    colour: plain('#ffd000')
  })
}

/** How long a preset that runs only once takes with its default settings, in seconds; null if it keeps running. */
export const presetSeconds = (id: string): number | null => (id === 'wipe' ? 1 : null)

export const canCopyPreset = (id: string): boolean => id in AS_CURVES

/** The built-in effects that are presets, in their usual order. */
export const PRESETS = EFFECTS.filter((e) => canCopyPreset(e.id))

/** A preset as an effect of the user's own, or null if curves cannot express it (or there is no such preset). */
export function copyPreset(preset: string, id: string, name?: string): CustomEffect | null {
  const def = EFFECT_BY_ID.get(preset)
  const parts = AS_CURVES[preset]?.()
  if (!def || !parts) return null
  return normalizeEffect({ id, name: name ?? def.name, ...parts })
}
