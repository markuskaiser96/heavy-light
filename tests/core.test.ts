import dgram from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine/engine'
import { createArtDmx, finishArtDmx } from '../src/engine/artnet'
import { EFFECTS, prepareParams, defaultParams } from '../src/shared/effects'
import { makeGenericPixelFixture, resolveMode, type OflFixture } from '../src/shared/ofl'
import { compilePatch, layoutSegments, mapLayer, toWorld } from '../src/shared/patch'
import { demoShow, emptyShow, newChaser, newLayer, newLook, newStep, normalizeShow, LIBRARY } from '../src/shared/show'
import type { FromEngine, Show } from '../src/shared/types'

const lib = (key: string): OflFixture => LIBRARY.find((l) => l.key === key)!.fixture

describe('Art-Net', () => {
  it('builds the packet that is known to work on a WLED strip (96 RGB pixels, universe 1)', () => {
    const packet = createArtDmx(1)
    for (let i = 0; i < 96; i++) packet.set([255, 0, 0], 18 + i * 3)
    const length = finishArtDmx(packet, 0, 288)
    const reference = Buffer.concat([
      Buffer.from('Art-Net\0', 'ascii'),
      Buffer.from([0x00, 0x50, 0, 14, 0, 0, 1, 0, 0x01, 0x20]),
      Buffer.from(Array.from({ length: 96 }, () => [255, 0, 0]).flat())
    ])
    expect(packet.subarray(0, length).equals(reference)).toBe(true)
  })

  it('pads odd lengths and splits the 15-bit port address', () => {
    const packet = createArtDmx(0x123)
    expect([packet[14], packet[15]]).toEqual([0x23, 0x01])
    expect(finishArtDmx(packet, 5, 3)).toBe(18 + 4)
    expect(packet.readUInt16BE(16)).toBe(4)
  })
})

describe('OFL resolver', () => {
  it('resolves a generated pixel strip in the requested colour order', () => {
    const mode = resolveMode(makeGenericPixelFixture(96, 1, 'GRB'), 'GRB')
    expect(mode.channelCount).toBe(288)
    expect(mode.cells).toHaveLength(96)
    expect(mode.channelsPerPixel).toBe(3)
    expect(mode.writes.slice(0, 3)).toEqual([
      { offset: 0, cell: 0, comp: 1 },
      { offset: 1, cell: 0, comp: 0 },
      { offset: 2, cell: 0, comp: 2 }
    ])
    expect(mode.cells[95].x).toBe(95)
  })

  it('orders matrix pixels row by row', () => {
    const mode = resolveMode(makeGenericPixelFixture(4, 3), 'RGB')
    expect(mode.cells.slice(0, 5).map((c) => [c.x, c.y])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]])
    expect([mode.gridW, mode.gridH]).toEqual([4, 3])
  })

  it('resolves the Stairville LED Bar 240/8 from the Open Fixture Library', () => {
    const bar = lib('stairville/led-bar-240-8')
    const pixels = resolveMode(bar, '24-channel')
    expect(pixels.channelCount).toBe(24)
    expect(pixels.cells).toHaveLength(8)
    expect(pixels.channelsPerPixel).toBe(3)

    // "Red Master" etc. are template channels of the pixel group "Master": one cell in the middle.
    const five = resolveMode(bar, '5-channel')
    expect(five.channelCount).toBe(5)
    expect(five.cells).toEqual([{ x: 3.5, y: 0 }])
    expect(five.writes.map((w) => w.offset)).toEqual([0, 1, 2])
    expect(five.defaults[3]).toBe(255) // dimmer open
    expect(five.defaults[4]).toBe(0) // strobe off
  })

  it('handles fine channels and dimmer-only fixtures', () => {
    const drgb = resolveMode(lib('generic/drgb-fader'), '16 bit')
    expect(drgb.channelCount).toBe(8)
    expect(drgb.defaults[0]).toBe(255)
    // Fine channels carry the same byte as the coarse one (v × 257 in 16 bit).
    expect(drgb.writes.map((w) => w.offset)).toEqual([2, 3, 4, 5, 6, 7])

    const strobe = resolveMode(lib('generic/strobe'), 'Frequency + Dimmer')
    expect(strobe.cells).toHaveLength(1)
    expect(strobe.writes).toEqual([{ offset: 1, cell: 0, comp: 3 }])
  })
})

describe('patch', () => {
  it('keeps pixels whole across universes like WLED expects', () => {
    // 16×16 RGB matrix from address 1: 170 pixels per universe.
    expect(layoutSegments(768, 1, 1, 3)).toEqual([
      { from: 0, length: 510, universe: 1, at: 0 },
      { from: 510, length: 258, universe: 2, at: 0 }
    ])
    // Start address 4: first universe holds floor(509 / 3) pixels.
    expect(layoutSegments(768, 1, 4, 3)[0]).toEqual({ from: 0, length: 507, universe: 1, at: 3 })
  })

  it('matches three.js XYZ Euler rotation', () => {
    const p = toWorld({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 90 }, { x: 2, y: 3, z: 4 })
    expect(p.x).toBeCloseTo(2)
    expect(p.y).toBeCloseTo(4)
    expect(p.z).toBeCloseTo(4)
  })

  it('places demo beams upright with pixel 1 at the floor and maps layers', () => {
    const show = demoShow()
    const patch = compilePatch(show)
    expect(patch.warnings).toEqual([])
    expect(patch.cellCount).toBe(13 * 96)
    expect(patch.positions[1]).toBeCloseTo(0) // first pixel of beam 1: y = 0
    expect(patch.positions[95 * 3 + 1]).toBeCloseTo(1)

    const stage = mapLayer(show, patch, { ...newLayer(), mapping: 'stageX' })
    expect(stage.u[0]).toBeCloseTo(0)
    expect(stage.u[stage.u.length - 1]).toBeCloseTo(1)
    const group = mapLayer(show, patch, { ...newLayer(), targets: ['g-left', 'beam-1'], mapping: 'index' })
    expect(group.cells.length).toBe(6 * 96)
  })

  it('reports overlapping addresses', () => {
    const show = demoShow()
    show.fixtures[1] = { ...show.fixtures[1], host: show.fixtures[0].host, universe: 1, address: 100 }
    expect(compilePatch(show).warnings).toEqual(['Beam 1 and Beam 2 overlap on the same DMX channels'])
  })
})

describe('effects', () => {
  it('every effect renders finite values in range with default parameters', () => {
    const u = Float32Array.from({ length: 50 }, (_, i) => i / 49)
    for (const def of EFFECTS) {
      const out = new Float32Array(150)
      for (const t of [0, 0.37, 12.5]) {
        def.render({ out, u, count: 50, t, p: prepareParams(def, defaultParams(def.id)) })
        for (const v of out) expect(v >= 0 && v <= 1.0001, `${def.id} at t=${t}: ${v}`).toBe(true)
      }
    }
  })
})

describe('show files', () => {
  it('round-trips through JSON and rejects foreign files', () => {
    const show = demoShow()
    expect(normalizeShow(JSON.parse(JSON.stringify(show)))).toEqual(show)
    expect(() => normalizeShow({ hello: 1 })).toThrow('not a HeavyLight show')
  })
})

describe('engine', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => cleanup?.())

  /** Starts a UDP listener and an engine that sends to it. */
  async function rig(show: Show) {
    const receiver = dgram.createSocket('udp4')
    await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve))
    const packets: Buffer[] = []
    receiver.on('message', (m) => packets.push(m))
    const messages: FromEngine[] = []
    const engine = new Engine({ emit: (m) => messages.push(m), port: receiver.address().port })
    engine.handle({ type: 'show', show })
    engine.start()
    cleanup = () => {
      engine.stop()
      receiver.close()
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    return { engine, packets, messages, wait }
  }

  function oneStrip(): Show {
    const show = emptyShow()
    show.settings.gamma = 1
    show.definitions.strip = makeGenericPixelFixture(4, 1, 'GRB')
    show.fixtures = [
      { id: 'a', name: 'A', definition: 'strip', mode: 'GRB', host: '127.0.0.1', universe: 7, address: 11, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { w: 1, h: 0 } }
    ]
    const look = { ...newLook('Red', 0), id: 'red', fadeOut: 0, midi: { channel: 0, note: 60 } }
    look.layers[0].params = { color: '#ff8000' }
    show.looks = [look]
    return show
  }

  it('sends the look on a MIDI note and goes dark on note off', async () => {
    const { engine, packets, wait } = await rig(oneStrip())
    await wait(60)
    const idle = packets.at(-1)!
    expect(idle.subarray(0, 8).toString('ascii')).toBe('Art-Net\0')
    expect(idle[14]).toBe(7)
    expect(idle.readUInt16BE(16)).toBe(22) // address 11 + 12 channels = 22 channels
    expect([...idle.subarray(18)].every((b) => b === 0)).toBe(true)

    engine.handleMidi({ port: 'test', kind: 'noteon', channel: 3, note: 60, velocity: 100, time: performance.now() })
    await wait(40)
    const lit = packets.at(-1)!
    // GRB order, starting at channel 11.
    expect([...lit.subarray(18 + 10, 18 + 16)]).toEqual([128, 255, 0, 128, 255, 0])
    expect([...lit.subarray(18, 18 + 10)].every((b) => b === 0)).toBe(true)

    engine.handleMidi({ port: 'test', kind: 'noteoff', channel: 3, note: 60, velocity: 0, time: performance.now() })
    await wait(40)
    expect([...packets.at(-1)!.subarray(18)].every((b) => b === 0)).toBe(true)
  })

  it('applies master, blackout and reports timing', async () => {
    const { engine, packets, messages, wait } = await rig(oneStrip())
    engine.handle({ type: 'trigger', id: 'red', on: true })
    engine.handle({ type: 'master', value: 0.5 })
    await wait(40)
    expect(packets.at(-1)![18 + 11]).toBe(128)
    engine.handle({ type: 'blackout', on: true })
    await wait(40)
    expect(packets.at(-1)![18 + 11]).toBe(0)

    engine.handleMidi({ port: 'test', kind: 'noteon', channel: 1, note: 60, velocity: 100, time: performance.now() })
    await wait(1200)
    const status = messages.filter((m) => m.type === 'status').at(-1)
    expect(status?.type === 'status' && status.status.latency.count).toBe(1)
    if (status?.type === 'status') {
      console.log('latency ms', status.status.latency.p50.toFixed(3), 'jitter p50/p99/max ms', status.status.jitter.p50.toFixed(3), status.status.jitter.p99.toFixed(3), status.status.jitter.max.toFixed(3), 'fps', status.status.fps.toFixed(1))
      expect(status.status.fps).toBeGreaterThan(50)
      expect(status.status.targets).toEqual([{ host: '127.0.0.1', universe: 7, channels: 22, error: null }])
    }
    expect(messages.some((m) => m.type === 'frame' && m.pixels.length === 12)).toBe(true)
  })

  function twoLooks(patch: Partial<ReturnType<typeof newChaser>> = {}): Show {
    const show = oneStrip()
    const blue = { ...newLook('Blue', 1), id: 'blue', fadeOut: 0 }
    blue.layers[0].params = { color: '#0000ff' }
    show.looks.push(blue)
    // 600 bpm: one beat lasts 100 ms.
    show.chasers = [{ ...newChaser('Chase', 0), id: 'chase', bpm: 600, fadeOut: 0, midi: { channel: 0, note: 72 }, steps: [newStep('red', 1), newStep('blue', 2), newStep('', 1)], ...patch }]
    return show
  }
  // First pixel as R, G, B (the strip is GRB and starts at address 11).
  const pixel = (packet: Buffer) => [packet[18 + 11], packet[18 + 10], packet[18 + 12]]

  it('steps a chaser through its looks in tempo, started by a MIDI note', async () => {
    const { engine, packets, messages, wait } = await rig(twoLooks())
    const start = performance.now()
    const at = (ms: number) => wait(Math.max(0, start + ms - performance.now()))
    engine.handleMidi({ port: 'test', kind: 'noteon', channel: 1, note: 72, velocity: 100, time: start })
    await at(50)
    expect(pixel(packets.at(-1)!)).toEqual([255, 128, 0])
    await at(150)
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 255])
    await at(250)
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 255])
    await at(350) // the dark step
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
    await at(450) // looped back to the first step
    expect(pixel(packets.at(-1)!)).toEqual([255, 128, 0])
    const statuses = messages.flatMap((m) => (m.type === 'status' ? [m.status] : []))
    expect(new Set(statuses.flatMap((x) => x.chasers.map((c) => `${c.chaserId}:${c.step}`)))).toEqual(new Set(['chase:0', 'chase:1', 'chase:2']))
    expect(statuses.some((x) => x.active.length === 1 && x.active[0].lookId === 'blue')).toBe(true)

    engine.handleMidi({ port: 'test', kind: 'noteoff', channel: 1, note: 72, velocity: 0, time: performance.now() })
    await wait(40)
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
  })

  it('crossfades between steps and stops after one pass when not looping', async () => {
    const { engine, packets, wait } = await rig(twoLooks({ crossfade: 1, loop: false, order: 'backward', steps: [newStep('blue', 1), newStep('red', 1)] }))
    const start = performance.now()
    const at = (ms: number) => wait(Math.max(0, start + ms - performance.now()))
    engine.handle({ type: 'toggle', id: 'chase' })
    await at(50) // backward: starts on the last step, red
    expect(pixel(packets.at(-1)!)).toEqual([255, 128, 0])
    await at(150) // halfway from red to blue
    const [r, g, b] = pixel(packets.at(-1)!)
    expect(r).toBeGreaterThan(60)
    expect(r).toBeLessThan(200)
    expect(b).toBeGreaterThan(60)
    expect(b).toBeLessThan(200)
    expect(g).toBeGreaterThan(0)
    await at(260) // finished
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
  })
})
