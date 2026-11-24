import dgram from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine/engine'
import { createArtDmx, finishArtDmx } from '../src/engine/artnet'
import { compileCustom, evalCurve, newCustomEffect, newDrive, normalizeEffect, oneShotSeconds } from '../src/shared/custom'
import { EFFECT_PREVIEW, LookRenderer } from '../src/engine/render'
import { EFFECT_BY_ID, EFFECTS, prepareParams, defaultParams, type EffectDef, type RenderArgs } from '../src/shared/effects'
import { canCopyPreset, copyPreset, presetKey, PRESETS } from '../src/shared/presets'
import { isOflFixture, makeGenericPixelFixture, resolveMode, stageSize, type OflFixture } from '../src/shared/ofl'
import { encodeImage } from '../src/shared/images'
import { autoPlane, compilePatch, layoutSegments, mapImage, mapLayer, toWorld } from '../src/shared/patch'
import { changedIds, discardItems, editBoth, editDraft, regrouped, saveItems, unsaved } from '../src/shared/drafts'
import { newProp, propBox, PROP_TYPES } from '../src/shared/props'
import { makeDraw } from '../src/shared/random'
import { addScenes, advanceFlow, flowFromSteps, flowOver, link, newNode, normalizeFlow, removeNodes, START, startFlow, startNode } from '../src/shared/flow'
import { demoShow, emptyShow, fixtureLibrary, importKey, makerOf, newChaser, newLayer, newLook, normalizeShow, LIBRARY } from '../src/shared/show'
import type { CustomEffect, FromEngine, Show } from '../src/shared/types'

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

  it('resolves the built-in Varytec Giga Bar 240', () => {
    const bar = lib('varytec/giga-bar-240-led-rgb')
    expect(isOflFixture(bar)).toBe(true)

    // 24-channel: red, green, blue per segment, segment 1 first (manual 7.7).
    const pixels = resolveMode(bar, '24-channel')
    expect(pixels.channelCount).toBe(24)
    expect(pixels.cells.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(pixels.channelsPerPixel).toBe(3)
    expect(pixels.writes.slice(3, 6)).toEqual([
      { offset: 3, cell: 1, comp: 0 },
      { offset: 4, cell: 1, comp: 1 },
      { offset: 5, cell: 1, comp: 2 }
    ])
    expect(pixels.unsupported).toEqual([])

    const five = resolveMode(bar, '5-channel')
    expect(five.cells).toHaveLength(1)
    expect([...five.defaults]).toEqual([0, 0, 0, 255, 0]) // dimmer open, strobe at 0
    expect(resolveMode(bar, '3-channel').channelCount).toBe(3)
    expect(resolveMode(bar, '2-channel').cells).toHaveLength(0)

    // Eight segments drawn over the real length of 1084 mm.
    const size = stageSize(bar, pixels)
    expect((size.w / 7) * 8).toBeCloseTo(1.084, 2)
    expect(stageSize(lib('generic/rgb-fader'), { gridW: 1, gridH: 1 })).toEqual({ w: 0.25, h: 0.15 })
  })

  it('files imported fixture types under a key of their own', () => {
    // Downloads from open-fixture-library.org say who made the fixture.
    const bar = lib('varytec/giga-bar-240-led-rgb')
    expect(importKey({ ...bar, manufacturerKey: 'varytec', fixtureKey: 'giga-bar-240-led-rgb' }, 'whatever', {})).toBe('varytec/giga-bar-240-led-rgb')
    expect(makerOf('varytec/giga-bar-240-led-rgb')).toBe('Varytec')

    // Without the keys of an OFL download the file name decides; the same file again keeps its key,
    // a different one of the same name gets a new key.
    const plain = bar
    const key = importKey(plain, 'My Bar (v2)', {})
    expect(key).toBe('import/my-bar-v2')
    expect(importKey(plain, 'My Bar (v2)', { [key]: plain })).toBe(key)
    expect(importKey({ ...plain, name: 'Other' }, 'My Bar (v2)', { [key]: plain })).toBe('import/my-bar-v2-2')

    const offered = fixtureLibrary({ [key]: plain, 'generic/pixel-96x1-rgb': makeGenericPixelFixture(96, 1), 'generic/strobe': lib('generic/strobe') })
    expect(offered).toHaveLength(LIBRARY.length + 1)
    expect(offered.at(-1)).toMatchObject({ key, maker: 'Imported' })
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

  it('opens shows saved before look folders and clock-following chasers existed', () => {
    const old = JSON.parse(JSON.stringify(demoShow()))
    delete old.lookFolders
    delete old.effectFolders
    for (const c of old.chasers) delete c.tempo
    const show = normalizeShow(old)
    expect(show.lookFolders).toEqual([])
    expect(show.chasers.map((c) => c.tempo)).toEqual(['own', 'own'])
  })

  it('opens shows saved before stage objects existed and drops objects of an unknown kind', () => {
    const { props: _props, ...old } = demoShow()
    expect(normalizeShow(JSON.parse(JSON.stringify(old))).props).toEqual([])
    const show = { ...emptyShow(), props: [{ id: 'a', name: 'Riser', kind: 'riser', position: { x: 1 } }, { id: 'b', name: 'Fog', kind: 'fog-machine' }] }
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).props).toEqual([{ ...newProp('riser', 'a', 'Riser'), position: { x: 1, y: 0, z: 0 } }])
  })
})

describe('custom effects', () => {
  /** Five pixels from one end to the other, rendered at a time and beat. */
  const render = (effect: ReturnType<typeof newCustomEffect>, t: number, beat?: number, speed = 1) => {
    const out = new Float32Array(15)
    compileCustom(effect).render({ out, u: Float32Array.from([0, 0.25, 0.5, 0.75, 1]), count: 5, t, beat, p: { speed } })
    return Array.from(out, (v) => +v.toFixed(3))
  }
  const white = (patch: Partial<ReturnType<typeof newCustomEffect>['brightness']>) => {
    const effect = newCustomEffect('e', 'Effect')
    effect.colour.color = '#ffffff'
    effect.brightness = { ...effect.brightness, ...patch }
    return effect
  }

  it('reads a drawn curve: eased, straight or in steps', () => {
    const points = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }]
    expect(evalCurve({ shape: 'smooth', points }, 0.25)).toBeCloseTo(0.5)
    expect(evalCurve({ shape: 'smooth', points }, 0.125)).toBeCloseTo(0.15625)
    expect(evalCurve({ shape: 'linear', points }, 0.125)).toBeCloseTo(0.25)
    expect(evalCurve({ shape: 'step', points }, 0.6)).toBe(1)
    expect(evalCurve({ shape: 'linear', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.9 }] }, 0)).toBe(0.3)
    expect(evalCurve({ shape: 'linear', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.9 }] }, 1)).toBe(0.9)
  })

  it('a curve over time makes all pixels pulse together, in seconds or in beats', () => {
    const pulse = white({ drive: newDrive('sine', { hz: 1 }) })
    expect(render(pulse, 0)).toEqual(Array(15).fill(0))
    expect(render(pulse, 0.5)).toEqual(Array(15).fill(1))
    expect(render(pulse, 0.25, undefined, 2)).toEqual(Array(15).fill(1))
    // In beats the time does not matter, only the beat count: one pass every two beats peaks on beat 1.
    const onBeat = white({ drive: newDrive('sine', { sync: 'beats', beats: 2 }) })
    expect(render(onBeat, 123.4, 1)).toEqual(Array(15).fill(1))
    expect(render(onBeat, 123.4, 2)).toEqual(Array(15).fill(0))
  })

  it('a curve over position lies along the pixels and can travel', () => {
    const ramp = white({ drive: newDrive('decay', { over: 'position', hz: 0 }) })
    expect(render(ramp, 7).filter((_, i) => i % 3 === 0)).toEqual([1, 0.75, 0.5, 0.25, 0])
    // Half a length further on, the bright start of the curve sits in the middle.
    const moving = white({ drive: newDrive('decay', { over: 'position', hz: 1 }) })
    expect(render(moving, 0.5).filter((_, i) => i % 3 === 0)).toEqual([0.5, 0.25, 1, 0.75, 0.5])
    const back = white({ drive: newDrive('decay', { over: 'position', hz: 1, direction: 'backward' }) })
    expect(render(back, 0.25).filter((_, i) => i % 3 === 0)).toEqual([0.75, 0.5, 0.25, 1, 0.75])
  })

  it('a colour curve picks its colours from the gradient', () => {
    const effect = newCustomEffect('e', 'Effect')
    effect.brightness = { ...effect.brightness, mode: 'fixed', value: 0.5 }
    effect.colour = { ...effect.colour, mode: 'curve', gradient: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }], drive: newDrive('rise', { over: 'position', hz: 0 }) }
    const out = render(effect, 3)
    expect(out.slice(0, 3)).toEqual([0.5, 0, 0])
    expect(out.slice(6, 9)).toEqual([0.25, 0, 0.25])
    expect(out.slice(12)).toEqual([0, 0, 0.5])
  })

  it('runs once per note and then stays at the end of the curve', () => {
    const effect = newCustomEffect('e', 'Hit')
    effect.brightness.drive = newDrive('decay', { sync: 'beats', beats: 0.5, once: true })
    const def = compileCustom(effect)
    const out = new Float32Array(3)
    const level = (beat: number) => (def.render({ out, u: new Float32Array([0.5]), count: 1, t: 0, beat, p: { speed: 1 } }), out[0])
    expect(level(0)).toBeCloseTo(1)
    expect(level(0.25)).toBeCloseTo(0.5, 1)
    // Looping, it would be back at full on every half beat.
    expect(level(0.5)).toBeCloseTo(0)
    expect(level(7.5)).toBeCloseTo(0)
    expect(oneShotSeconds(effect, 120)).toBeCloseTo(0.25)
    expect(oneShotSeconds(newCustomEffect('f', 'Loop'), 120)).toBeNull()
  })

  it('lets a curve over position pass through once without coming back', () => {
    const effect = newCustomEffect('e', 'Sweep')
    effect.brightness.drive = newDrive('bump', { over: 'position', hz: 1, once: true })
    const def = compileCustom(effect)
    const u = Float32Array.from({ length: 11 }, (_, i) => i / 10)
    const out = new Float32Array(33)
    const lit = (t: number) => (def.render({ out, u, count: 11, t, p: { speed: 1 } }), [...out].filter((_, i) => i % 3 === 0).findIndex((v) => v > 0.5))
    expect(lit(0)).toBe(-1)
    expect(lit(0.5)).toBe(5)
    expect(lit(0.3)).toBeLessThan(lit(0.7))
    expect(lit(1)).toBe(-1)
    expect(lit(5)).toBe(-1)
  })

  it('repairs what a file got wrong', () => {
    const e = normalizeEffect({ id: 'x', brightness: { mode: 'curve', value: 9, drive: { hz: -3, curve: { shape: 'wobbly', points: [{ x: 2, y: -1 }] } } } } as never)
    expect(e.name).toBe('Effect')
    expect(e.brightness.value).toBe(1)
    expect(e.brightness.drive).toMatchObject({ hz: 0, over: 'time', curve: { shape: 'smooth', points: [{ x: 1, y: 0 }] } })
    expect(e.colour.gradient).toHaveLength(2)
  })

  it('plays in a look like a built-in effect', () => {
    const show = demoShow()
    const patch = compilePatch(show)
    const renderer = new LookRenderer(show, patch)
    const frame = new Float32Array(patch.cellCount * 3)
    renderer.render(frame, [{ lookId: 'look-11', level: 1, t: 0.4, beat: 0.8 }])
    expect(Math.max(...frame)).toBeGreaterThan(0.9)
    expect(frame.filter((v) => v === 0).length).toBeGreaterThan(frame.length / 3)
    expect(defaultParams('custom:comet')).toEqual({ speed: 1 })
  })
})

describe('randomness', () => {
  it('draws like from a shuffled deck: everything once per round, nothing twice in a row', () => {
    for (const n of [2, 3, 5, 8]) {
      const draw = makeDraw(n, 1234 + n)
      const drawn = Array.from({ length: n * 40 }, (_, q) => draw(q))
      for (let round = 0; round < 40; round++) expect(new Set(drawn.slice(round * n, round * n + n)).size).toBe(n)
      expect(drawn.some((v, i) => i > 0 && v === drawn[i - 1])).toBe(false)
      // The same question always gets the same answer.
      expect(draw(17)).toBe(drawn[17])
    }
    expect(makeDraw(1, 5)(9)).toBe(0)
  })

  it('lets a section jump to a new place on every pass and keeps it whole', () => {
    const effect = newCustomEffect('e', 'Section')
    effect.brightness.drive = newDrive('bump', { over: 'position', sync: 'beats', beats: 1, direction: 'random' })
    const def = compileCustom(effect)
    const count = 200
    const u = Float32Array.from({ length: count }, (_, i) => i / (count - 1))
    const out = new Float32Array(count * 3)
    const lit = (beat: number) => {
      def.render({ out, u, count, t: 0, beat, p: { speed: 1 } })
      const on = Array.from({ length: count }, (_, i) => out[i * 3] > 0.02)
      return { first: on.indexOf(true), last: on.lastIndexOf(true), width: on.filter(Boolean).length }
    }
    const places = new Set<number>()
    for (let beat = 0; beat < 12; beat++) {
      const now = lit(beat + 0.1)
      // One piece, as wide as the bump is, never cut off at an end.
      expect(now.last - now.first + 1).toBe(now.width)
      expect(now.width).toBeGreaterThan(50)
      expect(lit(beat + 0.9).first).toBe(now.first)
      places.add(now.first)
    }
    expect(places.size).toBeGreaterThan(6)
  })

  it('turns the direction of a layer around', () => {
    const show = demoShow()
    const patch = compilePatch(show)
    for (const mapping of ['fixture', 'span', 'index', 'stageX'] as const) {
      const layer = { ...newLayer('solid'), mapping }
      const there = mapLayer(show, patch, layer).u
      const back = mapLayer(show, patch, { ...layer, reverse: true }).u
      const top = mapping === 'index' ? (patch.fixtures.length - 1) / patch.fixtures.length : 1
      expect(back[0]).toBeCloseTo(top - there[0])
      expect(back[back.length - 1]).toBeCloseTo(top - there[there.length - 1])
      expect(Math.min(...back)).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('plays a layer on random fixtures, a different one every beat', () => {
    const show = demoShow()
    const layer = { ...newLayer('solid'), id: 'pick', params: { color: '#ffffff' }, pick: { count: 1, beats: 1 } }
    show.looks = [{ ...newLook('Random', 0), id: 'random', layers: [layer] }]
    const patch = compilePatch(show)
    const renderer = new LookRenderer(show, patch)
    const frame = new Float32Array(patch.cellCount * 3)
    const litFixtures = (beat: number) => {
      renderer.render(frame, [{ lookId: 'random', level: 1, t: beat / 2, beat }])
      return patch.fixtures.filter((pf) => frame[pf.cellStart * 3] > 0).map((pf) => pf.fixture.id)
    }
    const seen: string[] = []
    for (let beat = 0; beat < patch.fixtures.length; beat++) {
      const now = litFixtures(beat + 0.5)
      expect(now.length).toBe(1)
      expect(litFixtures(beat + 0.01)).toEqual(now)
      seen.push(now[0])
    }
    // One round: every fixture had its turn.
    expect(new Set(seen).size).toBe(patch.fixtures.length)
  })
})

describe('drafts', () => {
  const start = () => {
    const show = demoShow()
    return { show, saved: show }
  }
  const rename = (id: string, name: string) => (s: Show) => ({ ...s, looks: s.looks.map((l) => (l.id === id ? { ...l, name } : l)) })

  it('keep an edit out of the saved show until it is saved', () => {
    const before = start()
    const id = before.show.looks[0].id
    const edited = editDraft(before, rename(id, 'Changed'))
    expect(edited.saved).toBe(before.saved)
    expect(edited.show.looks[0].name).toBe('Changed')
    expect(changedIds(edited, 'looks')).toEqual([id])
    expect(unsaved(edited)).toEqual([{ kind: 'looks', id }])

    const kept = saveItems(edited, 'looks', [id])
    expect(kept.saved.looks[0].name).toBe('Changed')
    expect(kept.show).toBe(kept.saved)

    const dropped = discardItems(edited, 'looks', [id])
    expect(dropped.show).toBe(before.saved)
  })

  it('notice when an edit is taken back by hand', () => {
    const before = start()
    const id = before.show.looks[0].id
    const back = editDraft(editDraft(before, rename(id, 'Changed')), rename(id, before.show.looks[0].name))
    expect(back.show).toBe(before.saved)
  })

  it('apply settings and structure right away, and keep the drafts through it', () => {
    const before = start()
    const [first, second] = before.show.looks.map((l) => l.id)
    let now = editDraft(before, rename(first, 'Changed'))
    now = editDraft(now, (s) => ({ ...s, settings: { ...s.settings, bpm: 97 } }))
    expect(now.saved.settings.bpm).toBe(97)
    expect(now.show.settings).toBe(now.saved.settings)

    now = editBoth(now, (s) => ({ ...s, looks: s.looks.filter((l) => l.id !== second) }))
    expect(now.saved.looks.some((l) => l.id === second)).toBe(false)
    expect(now.show.looks.some((l) => l.id === second)).toBe(false)
    expect(now.saved.looks[0].name).not.toBe('Changed')
    expect(changedIds(now, 'looks')).toEqual([first])

    // Saving one draft leaves the other one a draft.
    now = editDraft(now, (s) => ({ ...s, fixtures: s.fixtures.map((f, i) => (i === 0 ? { ...f, universe: 99 } : f)) }))
    now = saveItems(now, 'looks', [first])
    expect(unsaved(now)).toEqual([{ kind: 'fixtures', id: now.show.fixtures[0].id }])
    expect(now.saved.fixtures[0].universe).not.toBe(99)
  })
})

describe('groups as drafts', () => {
  it('treats putting a fixture into a group as a change of that fixture, until it is saved', () => {
    const show = demoShow()
    const [group] = show.groups
    const outsider = show.fixtures.find((f) => !group.fixtureIds.includes(f.id))!.id
    const before = { show, saved: show }
    const now = editDraft(before, (s) => ({ ...s, groups: s.groups.map((g) => (g.id === group.id ? { ...g, fixtureIds: [...g.fixtureIds, outsider] } : g)) }))
    expect(now.saved.groups).toBe(show.groups)
    expect(regrouped(now)).toEqual({ fixtures: [outsider], groups: [group.id] })
    expect(regrouped(now, [group.fixtureIds[0]]).groups).toEqual([])
    expect(unsaved(now)).toEqual([{ kind: 'groups', id: group.id }])

    const kept = saveItems(now, 'groups', regrouped(now, [outsider]).groups)
    expect(kept.saved.groups[0].fixtureIds).toContain(outsider)
    expect(kept.show).toBe(kept.saved)
    expect(discardItems(now, 'groups', [group.id]).show).toBe(show)
  })
})

describe('stage objects', () => {
  it('stand on their position: the box starts at the underside', () => {
    for (const type of PROP_TYPES) {
      const box = propBox(newProp(type.kind, 'p', type.label))
      expect(box.centre[1] - box.size[1] / 2).toBeCloseTo(0)
    }
  })

  it('scale a musician with the body height, a riser with its own size', () => {
    const tall = propBox({ ...newProp('drummer', 'p', 'Drums'), size: { w: 0, h: 3.5, d: 0 } })
    expect(tall.size).toEqual([3.8, 3.5, 3.4])
    expect(propBox({ ...newProp('riser', 'p', 'Riser'), size: { w: 3, h: 0.2, d: 1 } }).size).toEqual([3, 0.2, 1])
  })
})

describe('image effect', () => {
  // Four strips of four pixels, stacked into a 4 × 4 square: x from -1.5 to 1.5, y from 3 (top) down to 0.
  function square(): Show {
    const show = emptyShow()
    show.definitions.strip = makeGenericPixelFixture(4, 1, 'RGB')
    show.fixtures = [0, 1, 2, 3].map((row) => ({
      id: `row${row}`, name: `Row ${row}`, definition: 'strip', mode: 'RGB', host: '127.0.0.1', universe: row, address: 1,
      position: { x: 0, y: 3 - row, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, size: { w: 3, h: 0 }
    }))
    // 2 × 2 picture: red, green / blue, white.
    show.images.quad = encodeImage('Quad', 2, 2, Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))
    return show
  }
  const render = (show: Show, params: Record<string, number | string | boolean>, t = 0, plane?: Show['looks'][0]['layers'][0]['plane']) => {
    const patch = compilePatch(show)
    const layer = { ...newLayer('image'), params: { ...defaultParams('image'), image: 'quad', smooth: false, ...params }, plane }
    const def = EFFECTS.find((e) => e.id === 'image')!
    const out = new Float32Array(48)
    def.render({ out, u: new Float32Array(16), count: 16, t, p: prepareParams(def, layer.params), image: { width: 2, height: 2, pixels: Uint8Array.from(atob(show.images.quad.data), (c) => c.charCodeAt(0)) }, ...mapImage(show, patch, layer) })
    // Colour of the pixel in a column (0 = left) and row (0 = top).
    return (col: number, row: number) => [...out.subarray((row * 4 + col) * 3, (row * 4 + col) * 3 + 3)]
  }

  it('stretches the picture over the fixtures, seen from the front', () => {
    const show = square()
    expect(autoPlane(show, compilePatch(show), [])).toEqual({ position: { x: 0, y: 1.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 3.06, height: 3.06 })
    const at = render(show, {})
    expect(at(0, 0)).toEqual([1, 0, 0])
    expect(at(3, 0)).toEqual([0, 1, 0])
    expect(at(0, 3)).toEqual([0, 0, 1])
    expect(at(3, 3)).toEqual([1, 1, 1])
  })

  it('travels, turns and can stay dark outside the picture', () => {
    const show = square()
    // Half a picture to the right after one second: the left half now shows what was on the right.
    expect(render(show, { moveX: 0.5 }, 1)(0, 0)).toEqual([0, 1, 0])
    // Turned by 180°: corners swap diagonally.
    expect(render(show, { angle: 180 })(0, 0)).toEqual([1, 1, 1])
    // A quarter turn anticlockwise moves the top-right corner (green) to the top left.
    expect(render(show, { angle: 90 })(0, 0)).toEqual([0, 1, 0])
    // At half size the picture only covers the middle; the corners are outside.
    const small = render(show, { zoom: 0.5, edge: 'dark' })
    expect(small(0, 0)).toEqual([0, 0, 0])
    expect(small(1, 1)).toEqual([1, 0, 0])
  })

  it('projects from a freely placed frame', () => {
    const show = square()
    // A frame over the top-left quarter only: its right half is green.
    const at = render(show, { edge: 'dark' }, 0, { position: { x: -1, y: 2.5, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, width: 2, height: 2 })
    expect(at(0, 0)).toEqual([1, 0, 0])
    expect(at(1, 0)).toEqual([0, 1, 0])
    expect(at(3, 3)).toEqual([0, 0, 0])
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

  it('previews the unsaved look from the editor while MIDI keeps playing the saved one', async () => {
    const show = oneStrip()
    const { engine, packets, messages, wait } = await rig(show)
    const work = structuredClone(show)
    work.looks[0].layers[0].params = { color: '#0000ff' }
    engine.handle({ type: 'work', show: work })
    engine.handle({ type: 'preview', id: 'red' })
    await wait(40)
    // GRB order: the edited look is blue.
    expect([...packets.at(-1)!.subarray(18 + 10, 18 + 13)]).toEqual([0, 0, 255])

    // The saved show changes elsewhere: the preview stays.
    engine.handle({ type: 'show', show: { ...show, name: 'Renamed' } })
    // Long enough for the next status report, which comes every 100 ms.
    await wait(150)
    expect([...packets.at(-1)!.subarray(18 + 10, 18 + 13)]).toEqual([0, 0, 255])
    const status = messages.filter((m) => m.type === 'status').at(-1)
    expect(status?.type === 'status' && status.status.active.map((a) => a.lookId)).toEqual(['red'])

    engine.handle({ type: 'preview', id: null })
    engine.handleMidi({ port: 'test', kind: 'noteon', channel: 0, note: 60, velocity: 127, time: performance.now() })
    await wait(40)
    expect([...packets.at(-1)!.subarray(18 + 10, 18 + 13)]).toEqual([128, 255, 0])

    // Saved: nothing is unsaved any more, the preview plays the show itself.
    engine.handleMidi({ port: 'test', kind: 'noteoff', channel: 0, note: 60, velocity: 0, time: performance.now() })
    engine.handle({ type: 'show', show: work })
    engine.handle({ type: 'work', show: null })
    engine.handle({ type: 'preview', id: 'red' })
    await wait(40)
    expect([...packets.at(-1)!.subarray(18 + 10, 18 + 13)]).toEqual([0, 0, 255])
  })

  function twoLooks(patch: Partial<ReturnType<typeof newChaser>> = {}): Show {
    const show = oneStrip()
    const blue = { ...newLook('Blue', 1), id: 'blue', fadeOut: 0 }
    blue.layers[0].params = { color: '#0000ff' }
    show.looks.push(blue)
    // 600 bpm: one beat lasts 100 ms.
    show.chasers = [{ ...newChaser('Chase', 0), id: 'chase', bpm: 600, fadeOut: 0, midi: { channel: 0, note: 72 }, ...steps([['red', 1], ['blue', 2], ['', 1]]), ...patch }]
    return show
  }
  /** A flow that plays these steps one after the other, with node ids n1, n2 … */
  function steps(list: [lookId: string, beats: number][], old: { order?: 'forward' | 'backward'; loop?: boolean } = {}) {
    const flow = flowFromSteps({ steps: list.map(([lookId, beats]) => ({ lookId, beats })), ...old })
    const names = new Map(flow.nodes.map((n, i) => [n.id, i === 0 ? START : `n${i}`]))
    return { nodes: flow.nodes.map((n) => ({ ...n, id: names.get(n.id)! })), links: flow.links.map((l) => ({ from: names.get(l.from)!, to: names.get(l.to)! })) }
  }
  it('lets a chaser follow the MIDI clock instead of its own tempo', async () => {
    // Its own tempo is far too slow: 20 bpm, three seconds a beat. The clock runs at about 250 bpm.
    const { engine, messages, wait } = await rig(twoLooks({ tempo: 'midi', bpm: 20 }))
    const clock = setInterval(() => engine.handleClock('daw', 'tick', performance.now()), 10)
    try {
      await wait(150)
      engine.handleMidi({ port: 'daw', kind: 'noteon', channel: 1, note: 72, velocity: 100, time: performance.now() })
      const step = () => messages.flatMap((m) => (m.type === 'status' ? [m.status] : [])).at(-1)!.chasers[0]?.nodes.join()
      await wait(130)
      expect(step()).toBe('n1')
      // One beat is 24 ticks, about a quarter of a second: by now the second step (two beats) plays.
      await wait(330)
      expect(step()).toBe('n2')
      const status = messages.flatMap((m) => (m.type === 'status' ? [m.status] : [])).at(-1)!
      expect(status.clock?.port).toBe('daw')
      expect(status.clock!.bpm).toBeGreaterThan(150)
      expect(status.clock!.bpm).toBeLessThan(260)

      // The clock stops: the chaser carries on at its own slow tempo and the status says so.
      clearInterval(clock)
      engine.handleClock('daw', 'stop', performance.now())
      await wait(250)
      expect(messages.flatMap((m) => (m.type === 'status' ? [m.status] : [])).at(-1)!.clock).toBeNull()
      expect(step()).toBe('n2')
    } finally {
      clearInterval(clock)
    }
  })

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
    expect(new Set(statuses.flatMap((x) => x.chasers.map((c) => `${c.chaserId}:${c.nodes.join()}`)))).toEqual(new Set(['chase:n1', 'chase:n2', 'chase:n3']))
    expect(statuses.some((x) => x.active.length === 1 && x.active[0].lookId === 'blue')).toBe(true)

    engine.handleMidi({ port: 'test', kind: 'noteoff', channel: 1, note: 72, velocity: 0, time: performance.now() })
    await wait(40)
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
  })

  it('runs a chaser faster by its speed factor', async () => {
    // 600 bpm × 2: the first step (1 beat) is over after 50 ms instead of 100.
    const { engine, packets, wait } = await rig(twoLooks({ speed: 2 }))
    engine.handle({ type: 'toggle', id: 'chase' })
    await wait(75)
    expect([...packets.at(-1)!.subarray(18 + 10, 18 + 13)]).toEqual([0, 0, 255])
  })

  it('crossfades between steps and stops after one pass when not looping', async () => {
    const { engine, packets, wait } = await rig(twoLooks({ crossfade: 1, ...steps([['blue', 1], ['red', 1]], { order: 'backward', loop: false }) }))
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
    await at(250) // blue is over and fades out for as long as it faded in
    expect(pixel(packets.at(-1)!)[2]).toBeGreaterThan(40)
    expect(pixel(packets.at(-1)!)[0]).toBe(0)
    await at(340) // finished
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
  })

  it('plays the branches of a flow side by side', async () => {
    // On the note: red for two beats, and after a wait of one beat blue on top of it for one.
    const red = newNode('scene', 'red', 2, 200, 0)
    const wait1 = newNode('wait', '', 1, 200, 80)
    const blue = newNode('scene', 'blue', 1, 400, 80)
    const show = twoLooks({ nodes: [startNode(), red, wait1, blue], links: [{ from: START, to: red.id }, { from: START, to: wait1.id }, { from: wait1.id, to: blue.id }] })
    // Adding light, so both can be seen at once.
    show.looks[1].layers[0].blend = 'add'
    const { engine, packets, wait } = await rig(show)
    const start = performance.now()
    const at = (ms: number) => wait(Math.max(0, start + ms - performance.now()))
    engine.handle({ type: 'toggle', id: 'chase' })
    await at(50)
    expect(pixel(packets.at(-1)!)).toEqual([255, 128, 0])
    await at(150)
    expect(pixel(packets.at(-1)!)).toEqual([255, 128, 255])
    await at(260) // both are over, nothing follows: the flow has ended by itself
    expect(pixel(packets.at(-1)!)).toEqual([0, 0, 0])
  })
})

describe('flows', () => {
  type Graph = ReturnType<typeof flowFromSteps>
  const chaser = (graph: Graph, crossfade = 0) => ({ ...graph, crossfade })
  const at = (state: ReturnType<typeof startFlow>, graph: Graph) =>
    state.tokens
      .map((t) => graph.nodes.find((n) => n.id === t.node)!.lookId)
      .sort()
      .join()

  it('turns the old step lists into flows that play the same', () => {
    const list = [
      { lookId: 'a', beats: 1 },
      { lookId: 'b', beats: 2 },
      { lookId: 'c', beats: 1 }
    ]
    const play = (graph: Graph, beats: number[]) => {
      const state = startFlow(0)
      return beats.map((b) => (advanceFlow(chaser(graph), state, b, 0, 100), at(state, graph)))
    }
    expect(play(flowFromSteps({ steps: list }), [0, 1, 2, 1, 1])).toEqual(['a', 'b', 'c', 'a', 'b'])
    expect(play(flowFromSteps({ steps: list, order: 'backward', loop: false }), [0, 1, 2, 1])).toEqual(['c', 'b', 'a', ''])
    expect(play(flowFromSteps({ steps: list, order: 'pingpong' }), [0, 1, 2, 1, 2, 1])).toEqual(['a', 'b', 'c', 'b', 'a', 'b'])
    // What is left over when a node ends counts towards the next one.
    expect(play(flowFromSteps({ steps: list }), [0, 3.5])).toEqual(['a', 'c'])

    const old = normalizeShow({ ...JSON.parse(JSON.stringify(emptyShow())), chasers: [{ id: 'c', name: 'Old', steps: list, order: 'forward', loop: true, bpm: 100 }] })
    expect(old.chasers[0].nodes.map((n) => n.lookId)).toEqual(['', 'a', 'b', 'c'])
    expect(old.chasers[0].links.length).toBe(4)
    expect('steps' in old.chasers[0]).toBe(false)
    expect(normalizeFlow(old.chasers[0])).toEqual({ nodes: old.chasers[0].nodes, links: old.chasers[0].links })
  })

  it('draws one of several arrows at random, never straight back', () => {
    const graph = flowFromSteps({ steps: ['a', 'b', 'c', 'd'].map((lookId) => ({ lookId, beats: 1 })), order: 'random' })
    const state = startFlow(0)
    const seen: string[] = []
    for (let i = 0; i < 200; i++) {
      advanceFlow(chaser(graph), state, i === 0 ? 0 : 1, 0, 100)
      expect(state.tokens.length).toBe(1)
      seen.push(at(state, graph))
    }
    expect(new Set(seen).size).toBe(4)
    expect(seen.some((v, i) => i > 0 && v === seen[i - 1])).toBe(false)
  })

  it('does not multiply where arrows meet again, and ends when nothing follows', () => {
    // a → b and a → c, both → a: every round would double the places.
    // Added scenes are loose: nothing leads to them until the user says so.
    let graph = addScenes({ nodes: [startNode()], links: [] }, ['a'], 1).graph
    expect(graph.links).toEqual([])
    const a = graph.nodes[1].id
    graph = link(graph, START, a)
    const b = newNode('scene', 'b', 1, 0, 0)
    const c = newNode('scene', 'c', 1, 0, 0)
    graph = { nodes: [...graph.nodes, b, c], links: [...graph.links, { from: a, to: b.id }, { from: a, to: c.id }, { from: b.id, to: a }, { from: c.id, to: a }] }
    const state = startFlow(0)
    for (let i = 0; i < 40; i++) advanceFlow(chaser(graph), state, i === 0 ? 0 : 1, 0, 100)
    expect(state.tokens.length).toBeLessThanOrEqual(2)

    // Without the arrows back, and with a node removed, it runs out.
    const open = removeNodes({ nodes: graph.nodes, links: graph.links.filter((l) => l.to !== a || l.from === START) }, [c.id])
    expect(open.links.length).toBe(2)
    expect(link(open, a, b.id)).toBe(open)
    const once = startFlow(0)
    advanceFlow(chaser(open, 0.5), once, 0, 0, 100)
    advanceFlow(chaser(open, 0.5), once, 2, 0, 100)
    // b is over; it still fades out for half its length.
    expect(once.tokens.length).toBe(0)
    expect(flowOver(once)).toBe(false)
    advanceFlow(chaser(open, 0.5), once, 0.6, 0, 100)
    expect(flowOver(once)).toBe(true)
  })
})

describe('presets', () => {
  const N = 40
  const u = Float32Array.from({ length: N }, (_, i) => (i + 0.37) / N)
  const frame = (def: EffectDef, p: RenderArgs['p'], t: number): number[] => {
    const out = new Float32Array(N * 3)
    def.render({ out, u, count: N, t, p })
    return [...out]
  }

  it('copies a preset into curves that look like the preset with its default settings', () => {
    // Wave is left out: its copy is the same wave, a quarter wave further along.
    for (const id of ['solid', 'gradient', 'rainbow', 'chase', 'pulse', 'strobe', 'wipe']) {
      const preset = EFFECT_BY_ID.get(id)!
      const copy = copyPreset(id, 'c', 'Copy')!
      const own = compileCustom(copy)
      for (const t of [0.013, 0.21, 0.4731, 0.77, 1.31, 2.6]) {
        const want = frame(preset, prepareParams(preset, defaultParams(id)), t)
        const got = frame(own, { speed: 1 }, t)
        // Off by more than a little on at most one pixel: the one a hard edge is passing through.
        const off = want.filter((v, i) => Math.abs(v - got[i]) > 0.03).length
        expect(off, `${id} at ${t} s`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('gives a copy that is a complete effect of its own', () => {
    for (const { id } of EFFECTS) {
      const copy = copyPreset(id, 'c')
      expect(copy !== null).toBe(canCopyPreset(id))
      if (copy) expect(normalizeEffect(copy)).toEqual(copy)
    }
    expect(EFFECTS.filter((e) => !canCopyPreset(e.id)).map((e) => e.id)).toEqual(['image'])
    expect(PRESETS.map((e) => e.id)).not.toContain('image')
    expect(copyPreset('nothing', 'c')).toBeNull()
  })

  it('adds up several curves on one channel', () => {
    const effect = newCustomEffect('s', 'Stack')
    const level = (y: number) => ({ ...newDrive('rise'), curve: { shape: 'linear' as const, points: [{ x: 0, y }] } })
    const run = (more: CustomEffect['brightness']['more'], amount?: number) => {
      const own: CustomEffect = { ...effect, brightness: { mode: 'curve', value: 1, drive: level(0.5), amount, more }, colour: { ...effect.colour, mode: 'fixed', color: '#ffffff' } }
      return +frame(compileCustom(own), { speed: 1 }, 0.3)[0].toFixed(3)
    }
    expect(run(undefined)).toBe(0.5)
    expect(run(undefined, 0.5)).toBe(0.25)
    expect(run([{ drive: level(0.4), mix: 'add', amount: 0.5 }])).toBe(0.7)
    expect(run([{ drive: level(1), mix: 'add', amount: 1 }])).toBe(1)
    expect(run([{ drive: level(0.8), mix: 'max', amount: 1 }])).toBe(0.8)
    expect(run([{ drive: level(0), mix: 'multiply', amount: 0.5 }])).toBe(0.25)
    // The copy of plasma is three waves whose shares add up to the whole gradient.
    const plasma = copyPreset('plasma', 'p')!.colour
    expect((plasma.amount ?? 1) + plasma.more!.reduce((n, m) => n + m.amount, 0)).toBeCloseTo(1)
  })

  it('lets every pixel run on its own, with only a share of them taking part', () => {
    const sparkle = compileCustom(copyPreset('sparkle', 'k')!)
    const count = 4000
    const out = new Float32Array(count * 3)
    const lit = (t: number) => {
      sparkle.render({ out, u: new Float32Array(count), count, t, p: { speed: 1 } })
      return Array.from({ length: count }, (_, i) => out[i * 3])
    }
    const a = lit(1)
    // 15 % take part; a few of those have just faded to nothing.
    const share = a.filter((v) => v > 0).length / count
    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.16)
    // Not in step: the pixels that are lit are at different heights of the curve.
    expect(new Set(a.filter((v) => v > 0).map((v) => v.toFixed(1))).size).toBeGreaterThan(5)
    // The same moment looks the same again; a pass later other pixels are lit.
    expect(lit(1)).toEqual(a)
    const b = lit(1.25)
    expect(b.filter((v, i) => v > 0 !== a[i] > 0).length).toBeGreaterThan(count * 0.1)
  })

  it('fades to a background colour, and lets a layer replace the colours', () => {
    const effect: CustomEffect = { ...newCustomEffect('b', 'Back'), background: '#0000ff' }
    effect.brightness = { mode: 'fixed', value: 0.25, drive: newDrive('sine') }
    effect.colour = { ...effect.colour, mode: 'fixed', color: '#ff0000' }
    const def = compileCustom(effect)
    expect(def.params.map((p) => p.key)).toEqual(['speed', 'color', 'background'])
    expect(frame(def, prepareParams(def, {}), 0).slice(0, 3)).toEqual([0.25, 0, 0.75])
    expect(frame(def, prepareParams(def, { color: '#00ff00', background: '#000000' }), 0).slice(0, 3)).toEqual([0, 0.25, 0])

    const graded: CustomEffect = { ...newCustomEffect('g', 'Graded') }
    graded.brightness = { mode: 'fixed', value: 1, drive: newDrive('sine') }
    graded.colour = { ...graded.colour, mode: 'curve', gradient: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }], drive: newDrive('rise', { over: 'position', hz: 0 }) }
    const g = compileCustom(graded)
    expect(g.params.map((p) => p.key)).toEqual(['speed', 'stop1', 'stop2'])
    const last = (p: Record<string, string>) => frame(g, prepareParams(g, p), 0).slice(-3).map((v) => Math.round(v * 10) / 10)
    expect(last({})).toEqual([0, 0, 1])
    expect(last({ stop2: '#00ff00' })).toEqual([0, 1, 0])
  })

  it('previews a preset on the fixtures with its default settings', () => {
    const show = demoShow()
    const patch = compilePatch(show)
    const renderer = new LookRenderer(show, patch)
    renderer.previewEffect(presetKey('solid'), 'fixture')
    const out = new Float32Array(patch.cellCount * 3)
    renderer.render(out, [{ lookId: EFFECT_PREVIEW, level: 1, t: 0, beat: 0 }])
    expect([out[0], out[1], out[2]].map((v) => +v.toFixed(2))).toEqual([1, 0.48, 0.1])
  })
})
