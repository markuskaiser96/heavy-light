import dgram from 'node:dgram'
import { Comp } from '@shared/ofl'
import { compilePatch, type Patch, type PatchedFixture } from '@shared/patch'
import { ARTNET_PORT, type Chaser, type EngineStatus, type FromEngine, type Look, type Mapping, type MidiEvent, type Show, type ToEngine } from '@shared/types'
import { ARTNET_HEADER, createArtDmx, finishArtDmx } from './artnet'
import { EFFECT_PREVIEW, LookRenderer, type ActiveLook } from './render'
import { Samples } from './stats'

interface Universe {
  host: string
  universe: number
  packet: Buffer
  channels: number
  sequence: number
  error: string | null
}

interface FixtureOut {
  pf: PatchedFixture
  bytes: Uint8Array
  /** Segment → index into Engine.universes. */
  targets: number[]
}

/** Counts beats for something that plays: along the MIDI clock while there is one, else at a tempo of its own. */
interface Counter {
  /** A look: beats since it started. A chaser: beats played of the current step. */
  beat: number
  /** When `beat` was last moved on, and where the MIDI clock stood then (null while counting at its own tempo). */
  movedAt: number
  clockAt: number | null
  /** Current length of a beat in milliseconds. */
  beatLength: number
}

const counter = (now: number): Counter => ({ beat: 0, movedAt: now, clockAt: null, beatLength: 500 })

interface Playing extends Counter {
  on: boolean
  /** 0..1 fade position. */
  fade: number
  intensity: number
  startedAt: number
}

/** A chaser that is playing. */
interface Running extends Playing {
  /** Step being shown, and the one it is fading over from (-1 = none). */
  index: number
  previous: number
  stepStartedAt: number
  previousStartedAt: number
  direction: 1 | -1
  /** Steps played so far, including the current one. */
  played: number
  /** A chaser that does not loop has reached its end. */
  done: boolean
}

/** MIDI clock sends this many ticks per quarter note. */
/** Per look: how strongly it is shown this frame, and its effect time. */
type Levels = Map<string, { level: number; t: number; beat: number }>

/** The looks to draw, in the order of the show. */
function inOrder(renderer: LookRenderer, levels: Levels): ActiveLook[] {
  const active: ActiveLook[] = []
  for (const id of renderer.order) {
    const l = levels.get(id)
    if (l) active.push({ lookId: id, level: l.level, t: l.t, beat: l.beat })
  }
  return active
}

const TICKS_PER_BEAT = 24
/** Without a tick for this long (ms) the clock counts as stopped. The slowest tempo, 20 bpm, ticks every 125 ms. */
const CLOCK_TIMEOUT = 500
/** Shortest step, in beats. */
const MIN_STEP = 0.01

export interface EngineOptions {
  emit: (message: FromEngine) => void
  /** UDP port to send Art-Net to. Only tests change this. */
  port?: number
}

/**
 * The real-time core: holds the show, renders looks and sends Art-Net.
 * It has no dependency on Electron so it can run in any Node process (and be unit-tested).
 */
export class Engine {
  private show: Show | null = null
  private patch: Patch | null = null
  private renderer: LookRenderer | null = null
  private looks = new Map<string, Look>()
  private frame = new Float32Array(0)
  /** What the audience should see, 8 bit per channel (sent to the 3D view). */
  private preview = new Uint8Array(0)
  /** Same after gamma, i.e. what goes on the wire. */
  private wire = new Uint8Array(0)
  private gamma = new Uint8Array(256)
  private fixtures: FixtureOut[] = []
  private universes: Universe[] = []
  private warnings: string[] = []

  private chasers = new Map<string, Chaser>()
  private playing = new Map<string, Playing>()
  private runs = new Map<string, Running>()
  /** Per look: how strongly it is shown this frame and its effect time. Filled by looks and chasers alike. */
  private levels: Levels = new Map()
  /**
   * The show as the editors have it, while it differs from the saved one: the preview plays its
   * looks, effects and chasers on the saved fixtures. null = the preview plays the saved show.
   */
  private work: { show: Show; renderer: LookRenderer; looks: Map<string, Look>; chasers: Map<string, Chaser> } | null = null
  private workShow: Show | null = null
  private previewLevels: Levels = new Map()
  private previewId: string | null = null
  private previewMapping: Mapping = 'fixture'
  private previewCount = counter(0)
  private previewRun: Running | null = null
  private previewStart = 0
  /** The MIDI clock being followed: who sends it, ticks counted, time of the last one, smoothed time between ticks. */
  private clock = { port: '', ticks: 0, lastAt: -Infinity, interval: 0, steady: 0 }
  private master = 1
  private blackout = false
  private output = true

  private socket = dgram.createSocket('udp4')
  private port: number
  private emit: (message: FromEngine) => void

  private timer: NodeJS.Timeout | null = null
  private running = false
  private nextAt = 0
  private lastTick = 0
  private lastFrameSent = 0
  private lastStatus = 0
  private ticks = 0
  private packets = 0
  private fps = 0
  private pps = 0
  private rateSince = 0
  private latency = new Samples(500, 0.25, 24)
  private jitter = new Samples(2000, 0.25, 24)

  midiPorts: () => string[] = () => []
  virtualPort: string | null = null

  constructor(options: EngineOptions) {
    this.emit = options.emit
    this.port = options.port ?? ARTNET_PORT
    this.socket.on('error', () => {
      /* send errors are reported per target in the send callback */
    })
    this.socket.unref()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.nextAt = this.lastTick = this.rateSince = performance.now()
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.socket.close()
  }

  handle(message: ToEngine): void {
    switch (message.type) {
      case 'show':
        this.setShow(message.show)
        break
      case 'trigger':
        this.trigger(message.id, message.on, message.intensity ?? 1)
        break
      case 'toggle':
        this.trigger(message.id, !this.isOn(message.id), 1)
        break
      case 'releaseAll':
        for (const p of this.playing.values()) p.on = false
        for (const r of this.runs.values()) r.on = false
        break
      case 'master':
        this.master = Math.min(1, Math.max(0, message.value))
        break
      case 'blackout':
        this.blackout = message.on
        break
      case 'output':
        this.output = message.on
        break
      case 'work':
        this.workShow = message.show
        this.setWork()
        break
      case 'preview':
        if (message.id !== this.previewId) {
          this.previewId = message.id
          this.previewStart = performance.now()
          this.previewCount = counter(this.previewStart)
          this.previewRun = null
        }
        this.previewMapping = message.mapping ?? 'fixture'
        this.previewEffect()
        break
    }
    // Act on the change right away instead of waiting for the next scheduled frame.
    if (this.running) this.tick(performance.now())
  }

  handleMidi(event: MidiEvent): void {
    this.emit({ type: 'midi', event })
    if (event.kind === 'cc') return
    let matched = false
    for (const items of [this.looks, this.chasers]) {
      for (const item of items.values()) {
        const m = item.midi
        if (!m || m.note !== event.note || (m.channel !== 0 && m.channel !== event.channel)) continue
        matched = true
        const intensity = item.velocity ? event.velocity / 127 : 1
        if (item.triggerMode === 'toggle') {
          if (event.kind === 'noteon') this.trigger(item.id, !this.isOn(item.id), intensity)
        } else {
          this.trigger(item.id, event.kind === 'noteon', intensity)
        }
      }
    }
    // Render and send immediately: a note must not wait up to one frame period (that would be jitter).
    if (matched && this.running) this.tick(performance.now(), event.time)
  }

  /**
   * MIDI clock from the DAW. Chasers set to follow it count their steps in these ticks, so they
   * keep in time through tempo changes. Only the first port that sends a clock is followed.
   */
  handleClock(port: string, kind: 'tick' | 'stop', time: number): void {
    const c = this.clock
    const receiving = time - c.lastAt < CLOCK_TIMEOUT
    if (receiving && port !== c.port) return
    if (kind === 'stop') {
      c.lastAt = -Infinity
      return
    }
    if (!receiving) {
      c.port = port
      c.steady = 1
    } else {
      const gap = time - c.lastAt
      // Smoothed, so the jitter of single ticks does not make the tempo wobble.
      c.interval = c.steady === 1 ? gap : c.interval + (gap - c.interval) * 0.15
      c.steady++
    }
    c.ticks++
    c.lastAt = time
    if (!this.running || !this.clockUsable(time)) return
    // A step that ends on this tick changes now, not at the next frame.
    const position = this.clockBeats(time)
    const due = (chaser: Chaser | undefined, r: Running | null): boolean =>
      !!chaser && !!r && chaser.tempo === 'midi' && r.clockAt !== null && r.beat + position - r.clockAt >= stepBeats(chaser, r.index) - 1e-6
    if ([...this.runs].some(([id, r]) => due(this.chasers.get(id), r)) || due((this.work?.chasers ?? this.chasers).get(this.previewId ?? ''), this.previewRun)) this.tick(performance.now())
  }

  /** True once enough ticks have arrived to know the tempo, and they keep coming. */
  private clockUsable(now: number): boolean {
    return this.clock.steady >= 3 && now - this.clock.lastAt < CLOCK_TIMEOUT
  }

  /** Position of the MIDI clock in beats, carried on smoothly between two ticks. */
  private clockBeats(now: number): number {
    const c = this.clock
    return (c.ticks + Math.min(1, Math.max(0, (now - c.lastAt) / c.interval))) / TICKS_PER_BEAT
  }

  /** Beats that have passed for `c` since it was last asked: along the MIDI clock if `follow` and there is one, else at `bpm`. */
  private count(c: Counter, bpm: number, follow: boolean, now: number): number {
    const own = 60000 / Math.max(1, bpm)
    let beats = Math.max(0, now - c.movedAt) / own
    c.beatLength = own
    if (follow && this.clockUsable(now)) {
      const position = this.clockBeats(now)
      // The frame in which the clock takes over still counts at the own tempo.
      if (c.clockAt !== null) beats = Math.max(0, position - c.clockAt)
      c.clockAt = position
      c.beatLength = this.clock.interval * TICKS_PER_BEAT
    } else c.clockAt = null
    c.movedAt = now
    return beats
  }

  /** Moves a chaser on to where it should be at `now`, at its own tempo or along the MIDI clock. */
  private run(chaser: Chaser, r: Running, now: number, loop: boolean): void {
    advance(chaser, r, this.count(r, chaser.bpm, chaser.tempo === 'midi', now), now, loop)
  }

  /** Shows the custom effect being edited in the Effects tab on all fixtures. */
  private previewEffect(): void {
    const id = this.previewId?.startsWith('effect:') ? this.previewId.slice(7) : null
    this.renderer?.previewEffect(this.work ? null : id, this.previewMapping)
    this.work?.renderer.previewEffect(id, this.previewMapping)
  }

  /** Prepares the show the editors work on for the preview. It plays on the saved fixtures: only those are patched. */
  private setWork(): void {
    const { show, patch, workShow } = this
    if (!show || !patch || !workShow) this.work = null
    else {
      const edited: Show = { ...workShow, definitions: show.definitions, fixtures: show.fixtures, groups: show.groups }
      this.work = { show: edited, renderer: new LookRenderer(edited, patch), looks: new Map(edited.looks.map((l) => [l.id, l])), chasers: new Map(edited.chasers.map((c) => [c.id, c])) }
    }
    this.previewEffect()
  }

  private isOn(id: string): boolean {
    return (this.playing.get(id) ?? this.runs.get(id))?.on ?? false
  }

  private trigger(id: string, on: boolean, intensity: number): void {
    const look = this.looks.get(id)
    const chaser = look ? undefined : this.chasers.get(id)
    const item = look ?? chaser
    if (!item) return
    const current = look ? this.playing.get(id) : this.runs.get(id)
    if (!on) {
      if (current) current.on = false
      return
    }
    if (item.solo) {
      for (const [other, p] of this.playing) if (other !== id) p.on = false
      for (const [other, r] of this.runs) if (other !== id) r.on = false
    }
    if (current?.on) {
      current.intensity = intensity
      return
    }
    const now = performance.now()
    if (chaser) this.runs.set(id, startRun(chaser, now, current?.fade ?? 0, intensity))
    else this.playing.set(id, { ...counter(now), on: true, fade: current?.fade ?? 0, intensity, startedAt: now })
  }

  private setShow(show: Show): void {
    this.show = show
    this.patch = compilePatch(show)
    this.renderer = new LookRenderer(show, this.patch)
    this.setWork()
    this.looks = new Map(show.looks.map((l) => [l.id, l]))
    this.chasers = new Map(show.chasers.map((c) => [c.id, c]))
    this.warnings = this.patch.warnings
    this.frame = new Float32Array(this.patch.cellCount * 3)
    this.preview = new Uint8Array(this.patch.cellCount * 3)
    this.wire = new Uint8Array(this.patch.cellCount * 3)

    const g = show.settings.gamma > 0 ? show.settings.gamma : 1
    for (let i = 0; i < 256; i++) this.gamma[i] = Math.round(Math.pow(i / 255, g) * 255)

    const previous = new Map(this.universes.map((u) => [`${u.host}|${u.universe}`, u]))
    const universes = new Map<string, Universe>()
    this.fixtures = this.patch.fixtures.map((pf) => {
      const targets = pf.segments.map((s) => {
        const key = `${pf.fixture.host}|${s.universe}`
        let u = universes.get(key)
        if (!u) {
          const old = previous.get(key)
          u = { host: pf.fixture.host, universe: s.universe, packet: createArtDmx(s.universe), channels: 0, sequence: old?.sequence ?? 0, error: old?.error ?? null }
          universes.set(key, u)
        }
        u.channels = Math.max(u.channels, s.at + s.length)
        return [...universes.keys()].indexOf(key)
      })
      return { pf, bytes: new Uint8Array(pf.mode.channelCount), targets }
    })
    this.universes = [...universes.values()]

    for (const id of this.playing.keys()) if (!this.looks.has(id)) this.playing.delete(id)
    for (const id of this.runs.keys()) if (!this.chasers.has(id)) this.runs.delete(id)
  }

  private schedule(): void {
    if (!this.running) return
    const period = 1000 / Math.min(200, Math.max(10, this.show?.settings.outputRate ?? 60))
    const now = performance.now()
    this.nextAt += period
    if (this.nextAt < now) this.nextAt = now + period
    // Timers are only accurate to about a millisecond, so wake up slightly early and
    // yield to the event loop until the frame is due.
    this.timer = setTimeout(this.spin, Math.max(0, this.nextAt - now - 1.5))
  }

  private spin = (): void => {
    if (!this.running) return
    const now = performance.now()
    if (now < this.nextAt) {
      setImmediate(this.spin)
      return
    }
    this.jitter.add(now - this.nextAt)
    this.tick(now)
    this.schedule()
  }

  private tick(now: number, midiTime?: number): void {
    const dt = Math.max(0, now - this.lastTick)
    this.lastTick = now
    this.ticks++

    const levels = this.levels
    levels.clear()
    const bpm = this.show?.settings.bpm ?? 120
    for (const [id, p] of this.playing) {
      const look = this.looks.get(id)
      if (!look || !fade(p, look, dt)) this.playing.delete(id)
      else {
        p.beat += this.count(p, bpm, true, now)
        this.showLook(id, p.fade * p.intensity, (now - p.startedAt) / 1000, p.beat)
      }
    }
    for (const [id, r] of this.runs) {
      const chaser = this.chasers.get(id)
      if (!chaser) {
        this.runs.delete(id)
        continue
      }
      this.run(chaser, r, now, chaser.loop)
      if (!fade(r, chaser, dt)) this.runs.delete(id)
      else this.showStep(chaser, r, now, r.fade * r.intensity)
    }
    // What is being edited comes from the work show if there is one; it is then drawn over what MIDI plays.
    const edited: { show: Show | null; looks: Map<string, Look>; chasers: Map<string, Chaser> } = this.work ?? { show: this.show, looks: this.looks, chasers: this.chasers }
    const shown = this.work ? this.previewLevels : levels
    this.previewLevels.clear()
    if (this.previewId) {
      const chaser = edited.chasers.get(this.previewId)
      if (chaser) {
        // In the editor a chaser always loops, so every step can be judged.
        this.previewRun ??= startRun(chaser, now, 1, 1)
        this.run(chaser, this.previewRun, now, true)
        this.showStep(chaser, this.previewRun, now, 1, shown)
      } else {
        this.previewRun = null
        this.previewCount.beat += this.count(this.previewCount, edited.show?.settings.bpm ?? bpm, true, now)
        const id = this.previewId.startsWith('effect:') ? EFFECT_PREVIEW : this.previewId
        if (id === EFFECT_PREVIEW || edited.looks.has(id)) this.showLook(id, 1, (now - this.previewStart) / 1000, this.previewCount.beat, shown)
      }
    }

    if (this.renderer && this.patch) {
      this.renderer.render(this.frame, inOrder(this.renderer, levels))
      if (this.work) this.work.renderer.render(this.frame, inOrder(this.work.renderer, this.previewLevels), true)
      this.writeOutput()
      if (this.output) this.send(midiTime)
    }

    if (now - this.lastFrameSent >= 15) {
      this.lastFrameSent = now
      this.emit({ type: 'frame', pixels: this.preview.slice() })
    }
    if (now - this.lastStatus >= 100) {
      this.lastStatus = now
      const span = now - this.rateSince
      if (span >= 1000) {
        this.fps = (this.ticks * 1000) / span
        this.pps = (this.packets * 1000) / span
        this.ticks = this.packets = 0
        this.rateSince = now
      }
      this.emit({ type: 'status', status: this.status() })
    }
  }

  /** Adds a look to this frame. Several sources of the same look add up; the strongest one sets the effect time. */
  private showLook(lookId: string, level: number, t: number, beat: number, levels = this.levels): void {
    if (!lookId || level <= 0) return
    const existing = levels.get(lookId)
    if (!existing) {
      levels.set(lookId, { level: Math.min(1, level), t, beat })
      return
    }
    if (level > existing.level) {
      existing.t = t
      existing.beat = beat
    }
    existing.level = Math.min(1, existing.level + level)
  }

  /** Adds the current step of a chaser and, while it fades over, the step before. */
  private showStep(chaser: Chaser, r: Running, now: number, level: number, levels = this.levels): void {
    const step = chaser.steps[r.index]
    if (!step) return
    const share = Math.min(1, chaser.crossfade)
    const x = share > 0 && r.previous >= 0 ? Math.min(1, r.beat / (stepBeats(chaser, r.index) * share)) : 1
    this.showLook(step.lookId, level * x, (now - r.stepStartedAt) / 1000, r.beat, levels)
    const previous = chaser.steps[r.previous]
    if (x < 1 && previous) this.showLook(previous.lookId, level * (1 - x), (now - r.previousStartedAt) / 1000, (now - r.previousStartedAt) / r.beatLength, levels)
  }

  private writeOutput(): void {
    const scale = this.blackout ? 0 : this.master * 255
    const { frame, preview, wire, gamma } = this
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i] * scale
      const byte = v >= 255 ? 255 : v <= 0 ? 0 : (v + 0.5) | 0
      preview[i] = byte
      wire[i] = gamma[byte]
    }
    for (const out of this.fixtures) {
      const { mode, cellStart, segments } = out.pf
      const bytes = out.bytes
      bytes.set(mode.defaults)
      for (const w of mode.writes) {
        const o = (cellStart + w.cell) * 3
        bytes[w.offset] = w.comp === Comp.Level ? Math.max(wire[o], wire[o + 1], wire[o + 2]) : wire[o + w.comp]
      }
      segments.forEach((s, i) => {
        this.universes[out.targets[i]].packet.set(bytes.subarray(s.from, s.from + s.length), ARTNET_HEADER + s.at)
      })
    }
  }

  private send(midiTime?: number): void {
    let pending = this.universes.length
    for (const u of this.universes) {
      u.sequence = (u.sequence % 255) + 1
      const length = finishArtDmx(u.packet, u.sequence, u.channels)
      this.packets++
      this.socket.send(u.packet, 0, length, this.port, u.host, (err) => {
        u.error = err ? describeSendError(err) : null
        if (--pending === 0 && midiTime !== undefined) this.latency.add(performance.now() - midiTime)
      })
    }
  }

  private status(): EngineStatus {
    return {
      active: [...this.levels, ...this.previewLevels].filter(([lookId]) => lookId !== EFFECT_PREVIEW).map(([lookId, l]) => ({ lookId, level: l.level })),
      chasers: [...this.runs].map(([chaserId, r]) => ({ chaserId, level: r.fade * r.intensity, step: r.index })),
      previewStep: this.previewRun?.index ?? null,
      master: this.master,
      blackout: this.blackout,
      output: this.output,
      fps: this.fps,
      packetsPerSecond: this.pps,
      midiPorts: this.midiPorts(),
      clock: this.clockUsable(performance.now()) ? { bpm: 60000 / (this.clock.interval * TICKS_PER_BEAT), port: this.clock.port } : null,
      virtualPort: this.virtualPort,
      targets: this.universes.map((u) => ({ host: u.host, universe: u.universe, channels: u.channels, error: u.error })),
      latency: this.latency.summary(),
      jitter: this.jitter.summary(),
      warnings: this.warnings
    }
  }
}

/** Moves a fade one frame on. Returns false once it has faded out completely. */
function fade(p: Playing, item: { fadeIn: number; fadeOut: number }, dt: number): boolean {
  if (p.on) p.fade = item.fadeIn > 0 ? Math.min(1, p.fade + dt / item.fadeIn) : 1
  else p.fade = item.fadeOut > 0 ? p.fade - dt / item.fadeOut : 0
  return p.on || p.fade > 0
}

function startRun(chaser: Chaser, now: number, fadeFrom: number, intensity: number): Running {
  return {
    ...counter(now),
    on: true,
    fade: fadeFrom,
    intensity,
    startedAt: now,
    index: chaser.order === 'backward' ? Math.max(0, chaser.steps.length - 1) : 0,
    previous: -1,
    stepStartedAt: now,
    previousStartedAt: now,
    direction: 1,
    played: 1,
    done: false
  }
}

/** Length of a step in beats. */
function stepBeats(chaser: Chaser, index: number): number {
  return Math.max(MIN_STEP, chaser.steps[index]?.beats ?? 1)
}

/**
 * Moves a chaser on by `beats`. What is left over when a step ends counts towards the next one,
 * so the chaser keeps its tempo no matter when frames happen.
 */
function advance(chaser: Chaser, r: Running, beats: number, now: number, loop: boolean): void {
  const n = chaser.steps.length
  if (n === 0) return
  if (r.index >= n) r.index = 0
  r.beat += beats
  for (let guard = 0; !r.done; guard++) {
    const length = stepBeats(chaser, r.index)
    if (r.beat < length - 1e-6) break
    if (guard > 2000) {
      // Far behind, e.g. the computer was asleep: carry on from here.
      r.beat = 0
      r.stepStartedAt = now
      break
    }
    const next = nextStep(chaser, r, loop)
    if (next < 0) {
      r.done = true
      r.on = false
      break
    }
    r.beat = Math.max(0, r.beat - length)
    r.previous = r.index
    r.previousStartedAt = r.stepStartedAt
    r.index = next
    r.stepStartedAt = now - r.beat * r.beatLength
    r.played++
  }
}

/** Index of the step after the current one, or -1 when a chaser that does not loop is finished. */
function nextStep(chaser: Chaser, r: Running, loop: boolean): number {
  const n = chaser.steps.length
  switch (chaser.order) {
    case 'backward':
      return r.index > 0 ? r.index - 1 : loop ? n - 1 : -1
    case 'pingpong': {
      if (n === 1) return loop ? 0 : -1
      const next = r.index + r.direction
      if (next >= n) {
        r.direction = -1
        return n - 2
      }
      if (next < 0) {
        if (!loop) return -1
        r.direction = 1
        return 1
      }
      return next
    }
    case 'random': {
      if (!loop && r.played >= n) return -1
      if (n === 1) return 0
      // Any step but the current one.
      const pick = Math.floor(Math.random() * (n - 1))
      return pick >= r.index ? pick + 1 : pick
    }
    default:
      return r.index < n - 1 ? r.index + 1 : loop ? 0 : -1
  }
}

function describeSendError(err: Error): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN') {
    return process.platform === 'darwin'
      ? 'No route to this address. Check the network, and on macOS allow "Local Network" access for the app HeavyLight was started from.'
      : 'No route to this address. Check that this computer is in the same network as the fixture.'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Address could not be resolved. Use an IP address.'
  return err.message
}
