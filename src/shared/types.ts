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
  /** Id of the folder it is filed in. Absent = not in a folder. Folders only organise the list. */
  folder?: string
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

export type PropKind = 'singer' | 'guitarist' | 'bassist' | 'keyboardist' | 'drummer' | 'riser' | 'monitor' | 'truss'

/** Scenery in the 3D view: musicians, risers, monitors, truss. Only there to make the preview readable; never sent anywhere. */
export interface StageProp {
  id: string
  name: string
  kind: PropKind
  /** Middle of the underside in metres, so y = 0 stands on the floor. */
  position: Vec3
  /** Euler angles in degrees, XYZ order. Unrotated, musicians face the audience and a monitor faces the band. */
  rotation: Vec3
  /** Width, height, depth in metres. Musicians only use the height. */
  size: { w: number; h: number; d: number }
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

/** A small bitmap stored in the show. See shared/images.ts. */
export interface ImageAsset {
  name: string
  width: number
  height: number
  /** Raw RGB bytes, row by row from the top, base64 encoded. */
  data: string
}

/** A rectangle on stage that an image is projected from, straight along its normal. */
export interface Plane {
  /** Centre, in metres. */
  position: Vec3
  /** Euler angles in degrees, XYZ order. Unrotated, the image faces the audience. */
  rotation: Vec3
  width: number
  height: number
}

export interface Layer {
  id: string
  effect: string
  /** For the image effect, `image` holds the key into Show.images. */
  params: Record<string, ParamValue>
  /** Image effect only: where the image sits on stage. Absent = stretched over the targeted fixtures, seen from the front. */
  plane?: Plane
  /** Fixture or group ids. Empty = all fixtures. */
  targets: string[]
  /**
   * Plays on only `count` of the targeted fixtures at a time, drawn at random, and draws again every
   * `beats` beats. Absent = on all of them.
   */
  pick?: { count: number; beats: number }
  mapping: Mapping
  /** Turns the direction of the mapping around: right to left, last fixture first, from the top down. */
  reverse?: boolean
  blend: Blend
  opacity: number
}

/** A curve drawn by the user: points over one pass, x and y both 0..1. Before the first and after the last point it stays level. */
export interface Curve {
  /** Sorted by x. */
  points: { x: number; y: number }[]
  /** How the curve runs from point to point: eased, straight, or jumping. */
  shape: 'smooth' | 'linear' | 'step'
}

/** What reads a curve: the time, or the position of each pixel. */
export interface CurveDrive {
  curve: Curve
  /** time: all pixels follow the curve together. position: the curve lies along the pixels (the layer's mapping) and can travel. */
  over: 'time' | 'position'
  /** Position only: how often the curve fits along the mapping. */
  repeats: number
  /** hz: passes per second. beats: one pass lasts `beats` beats of the MIDI clock (or of the show tempo while there is none). */
  sync: 'hz' | 'beats'
  hz: number
  beats: number
  /** random (position only): instead of travelling, the curve jumps to another place on every pass, a different one on each fixture. */
  direction: 'forward' | 'backward' | 'bounce' | 'random'
  /**
   * Runs through once, counted from the moment the look starts (its MIDI note), then stays at its end.
   * Over position, the curve then passes through once: it comes in at one end and leaves at the other.
   */
  once: boolean
}

export interface GradientStop {
  /** 0..1 */
  at: number
  color: string
}

/** An effect built by the user: brightness and colour, each fixed or driven by a curve. Layers use it as effect `custom:<id>`. */
export interface CustomEffect {
  id: string
  name: string
  /** Id of the folder it is filed in. Absent = not in a folder. Folders only organise the list. */
  folder?: string
  brightness: { mode: 'fixed' | 'curve'; value: number; drive: CurveDrive }
  /** With a curve, the curve picks the place on the gradient: low = its start, high = its end. */
  colour: { mode: 'fixed' | 'curve'; color: string; gradient: GradientStop[]; drive: CurveDrive }
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
  /** Id of the folder it is filed in (Show.lookFolders). Absent = not in a folder. Folders only organise the list. */
  folder?: string
}

export interface Folder {
  id: string
  name: string
}

/** The lists that can be sorted into folders, by the field of the show that holds their folders. */
export type FolderList = 'lookFolders' | 'fixtureFolders' | 'effectFolders' | 'chaserFolders'

/** One box of a chaser's flow chart. */
export interface FlowNode {
  id: string
  /** start: where the flow begins, takes no time. scene: shows a look for `beats`. wait: lets `beats` pass. */
  kind: 'start' | 'scene' | 'wait'
  /** Scene only. Empty = dark. */
  lookId: string
  /** Length in beats (quarter notes). */
  beats: number
  /** Where it sits in the editor. */
  x: number
  y: number
  /** When it is over: start all the nodes its arrows point to, or one of them drawn at random. */
  next: 'all' | 'one'
}

/** An arrow of the flow chart: when `from` is over, `to` starts. */
export interface FlowLink {
  from: string
  to: string
}

/** Scenes linked in time as a flow chart, started by one MIDI note. See shared/flow.ts. */
export interface Chaser extends Triggerable {
  /** Always holds exactly one start node. */
  nodes: FlowNode[]
  links: FlowLink[]
  /** Id of the folder it is filed in. Absent = not in a folder. Folders only organise the list. */
  folder?: string
  /** own: runs at `bpm`. midi: follows the MIDI clock of the DAW, and falls back to `bpm` while no clock arrives. */
  tempo: 'own' | 'midi'
  bpm: number
  /** Runs this many times as fast as the step lengths say: 2 = double time, 0.5 = half time. */
  speed: number
  /** Share of each scene (0..1) spent fading over from what came before. 0 = hard cut. */
  crossfade: number
}

export interface Show {
  format: 'heavylight-show'
  version: 1
  name: string
  definitions: Record<string, OflFixture>
  fixtures: FixtureInstance[]
  groups: Group[]
  props: StageProp[]
  looks: Look[]
  lookFolders: Folder[]
  fixtureFolders: Folder[]
  effectFolders: Folder[]
  chaserFolders: Folder[]
  effects: CustomEffect[]
  chasers: Chaser[]
  images: Record<string, ImageAsset>
  stage: { width: number; depth: number }
  settings: {
    /** Art-Net frames per second. */
    outputRate: number
    /** Gamma applied to output values (1 = raw). LEDs are linear, so ~2.2 makes fades look even. */
    gamma: number
    /** Tempo for everything counted in beats while no MIDI clock arrives. */
    bpm: number
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
  /**
   * The show as the editors have it, with changes that are not saved into the show yet. The preview
   * plays its looks, effects and chasers; MIDI keeps playing the saved show. null = nothing unsaved.
   */
  | { type: 'work'; show: Show | null }
  /** `id` is a look, a chaser or `effect:<id>` for a custom effect, which is then shown on all fixtures with `mapping`. */
  | { type: 'preview'; id: string | null; mapping?: Mapping }
  /** Starts what is being previewed from its beginning again, as a new MIDI note would. */
  | { type: 'restartPreview' }

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
  /** Running chasers and the nodes each one is on. */
  chasers: { chaserId: string; level: number; nodes: string[] }[]
  /** Nodes the chaser being previewed in the editor is on. */
  previewNodes: string[]
  master: number
  blackout: boolean
  output: boolean
  fps: number
  packetsPerSecond: number
  midiPorts: string[]
  /** Tempo of the MIDI clock being received, or null if there is none. */
  clock: { bpm: number; port: string } | null
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
