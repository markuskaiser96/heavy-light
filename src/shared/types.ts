import type { OflFixture } from './ofl'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** A patched fixture: an OFL definition + mode, placed on the network and on the stage. */
export interface FixtureInstance {
  id: string
  name: string
  /** Key into Show.definitions. */
  definition: string
  /** Mode name inside the OFL definition. */
  mode: string
  /** Art-Net unicast target. */
  host: string
  /** Art-Net port address (0–32767). WLED "Start universe 1" is 1. */
  universe: number
  /** DMX start address, 1-based. */
  address: number
  /** Stage position of the fixture centre in metres. X = stage left/right, Y = up, Z = towards audience. */
  position: Vec3
  /** Euler angles in degrees, applied in XYZ order. Pixels run along the local X axis. */
  rotation: Vec3
  /** Physical extent of the pixel grid in metres. */
  size: { w: number; h: number }
}

export interface Group {
  id: string
  name: string
  fixtureIds: string[]
}

/**
 * How an effect's 0..1 coordinate is laid over the targeted fixtures.
 * - fixture: every fixture runs the effect along its own length
 * - span:    all fixtures are chained into one long strip
 * - index:   each fixture is one step (whole fixture has one value)
 * - stageX/Y/Z: position on stage
 */
export type Mapping = 'fixture' | 'span' | 'index' | 'stageX' | 'stageY' | 'stageZ'
export type Blend = 'normal' | 'add' | 'max' | 'multiply'
export type ParamValue = number | string | boolean

export interface Layer {
  id: string
  effect: string
  params: Record<string, ParamValue>
  /** Fixture or group ids. Empty = all fixtures. */
  targets: string[]
  mapping: Mapping
  blend: Blend
  opacity: number
}

export interface MidiNote {
  /** 1–16, or 0 for any channel. */
  channel: number
  note: number
}

/** What looks and chasers share: how they are started and how they fade. */
export interface Triggerable {
  id: string
  name: string
  /** Label colour in the UI. */
  color: string
  fadeIn: number
  fadeOut: number
  midi: MidiNote | null
  /** hold: on while the note is held. toggle: every note-on flips it. */
  triggerMode: 'hold' | 'toggle'
  /** Note velocity scales the intensity. */
  velocity: boolean
  /** Starting this releases everything else. */
  solo: boolean
}

export interface Look extends Triggerable {
  layers: Layer[]
}

export interface ChaserStep {
  id: string
  /** Look shown during this step. Empty = dark. */
  lookId: string
  /** Length in beats. */
  beats: number
}

export type ChaserOrder = 'forward' | 'backward' | 'pingpong' | 'random'

/** Plays looks one after the other, in time with a tempo. Starts at its first step whenever it is triggered. */
export interface Chaser extends Triggerable {
  steps: ChaserStep[]
  bpm: number
  /** Share of each step (0..1) spent fading over from the previous step. 0 = hard cut. */
  crossfade: number
  order: ChaserOrder
  /** false: stops by itself after one pass. */
  loop: boolean
}

export interface Show {
  format: 'heavylight-show'
  version: 1
  name: string
  definitions: Record<string, OflFixture>
  fixtures: FixtureInstance[]
  groups: Group[]
  looks: Look[]
  chasers: Chaser[]
  stage: { width: number; depth: number }
  settings: {
    /** Art-Net frames per second. */
    outputRate: number
    /** Gamma applied to output values (1 = raw). LEDs are linear, so ~2.2 makes fades look even. */
    gamma: number
  }
}

// ---------- engine protocol ----------

export type ToEngine =
  | { type: 'show'; show: Show }
  /** `id` is a look or a chaser. */
  | { type: 'trigger'; id: string; on: boolean; intensity?: number }
  | { type: 'toggle'; id: string }
  | { type: 'releaseAll' }
  | { type: 'master'; value: number }
  | { type: 'blackout'; on: boolean }
  | { type: 'output'; on: boolean }
  | { type: 'preview'; id: string | null }

export interface MidiEvent {
  port: string
  kind: 'noteon' | 'noteoff' | 'cc'
  channel: number
  note: number
  velocity: number
  time: number
}

export interface TimingStats {
  count: number
  p50: number
  p99: number
  max: number
  /** Histogram of recent samples, bucket width `bucketMs`. Last bucket collects everything above. */
  buckets: number[]
  bucketMs: number
}

export interface OutputTarget {
  host: string
  universe: number
  channels: number
  error: string | null
}

export interface EngineStatus {
  /** Looks currently contributing light, whether started directly or by a chaser. */
  active: { lookId: string; level: number }[]
  /** Running chasers and the step each one is on. */
  chasers: { chaserId: string; level: number; step: number }[]
  /** Step of the chaser being previewed in the editor. */
  previewStep: number | null
  master: number
  blackout: boolean
  output: boolean
  fps: number
  packetsPerSecond: number
  midiPorts: string[]
  virtualPort: string | null
  targets: OutputTarget[]
  /** MIDI note received → last Art-Net packet handed to the OS. */
  latency: TimingStats
  /** Deviation of each output frame from its scheduled time. */
  jitter: TimingStats
  warnings: string[]
}

export type FromEngine =
  | { type: 'frame'; pixels: Uint8Array }
  | { type: 'status'; status: EngineStatus }
  | { type: 'midi'; event: MidiEvent }

export const ARTNET_PORT = 6454
