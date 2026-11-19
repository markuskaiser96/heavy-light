import { customKey, newCustomEffect, newDrive, normalizeEffect } from './custom'
import { defaultParams } from './effects'
import { encodeImage, isImageAsset } from './images'
import { genericPixelKey, isOflFixture, makeGenericPixelFixture, type OflFixture } from './ofl'
import { isPropKind, newProp, propType } from './props'
import type { Chaser, ChaserStep, FixtureInstance, Folder, ImageAsset, Layer, Look, Show } from './types'
import drgbFader from './library/drgb-fader.json'
import ledBar from './library/led-bar-240-8.json'
import rgbFader from './library/rgb-fader.json'
import rgbwFader from './library/rgbw-fader.json'
import strobe from './library/strobe.json'

export const newId = (): string => Math.random().toString(36).slice(2, 10)

/** Fixture types that ship with the app (Open Fixture Library definitions). */
export const LIBRARY: { key: string; maker: string; fixture: OflFixture }[] = [
  { key: 'generic/rgb-fader', maker: 'Generic', fixture: rgbFader as unknown as OflFixture },
  { key: 'generic/drgb-fader', maker: 'Generic', fixture: drgbFader as unknown as OflFixture },
  { key: 'generic/rgbw-fader', maker: 'Generic', fixture: rgbwFader as unknown as OflFixture },
  { key: 'generic/strobe', maker: 'Generic', fixture: strobe as unknown as OflFixture },
  { key: 'stairville/led-bar-240-8', maker: 'Stairville', fixture: ledBar as unknown as OflFixture }
]

const ORIGIN = { x: 0, y: 0, z: 0 }
const DEFAULT_SIZE = { w: 1, h: 0 }

export const LOOK_COLORS = ['#ff9f43', '#ff5c7a', '#b180ff', '#5aa9ff', '#3ddbd9', '#7ddc6f', '#f5d547', '#f0f0f5']

export function emptyShow(): Show {
  return {
    format: 'heavylight-show',
    version: 1,
    name: 'Untitled show',
    definitions: {},
    fixtures: [],
    groups: [],
    props: [],
    looks: [],
    lookFolders: [],
    fixtureFolders: [],
    effectFolders: [],
    chaserFolders: [],
    effects: [],
    chasers: [],
    images: {},
    stage: { width: 8, depth: 5 },
    settings: { outputRate: 60, gamma: 2.2, bpm: 120 }
  }
}

export function newLayer(effect = 'solid'): Layer {
  return { id: newId(), effect, params: defaultParams(effect), targets: [], mapping: 'fixture', blend: 'normal', opacity: 1 }
}

export function newLook(name: string, index: number): Look {
  return {
    id: newId(),
    name,
    color: LOOK_COLORS[index % LOOK_COLORS.length],
    layers: [newLayer()],
    fadeIn: 0,
    fadeOut: 150,
    midi: null,
    triggerMode: 'hold',
    velocity: false,
    solo: false
  }
}

export function newStep(lookId: string, beats = 1): ChaserStep {
  return { id: newId(), lookId, beats }
}

export function newChaser(name: string, index: number): Chaser {
  return {
    id: newId(),
    name,
    color: LOOK_COLORS[(index + 3) % LOOK_COLORS.length],
    steps: [],
    tempo: 'own',
    bpm: 120,
    crossfade: 0,
    order: 'forward',
    loop: true,
    fadeIn: 0,
    fadeOut: 150,
    midi: null,
    triggerMode: 'hold',
    velocity: false,
    solo: false
  }
}

/** Validates a parsed file and fills in anything a newer or older version may lack. Throws with a readable message. */
const folders = (raw: Folder[] | undefined): Folder[] => (raw ?? []).filter((f) => typeof f?.id === 'string' && typeof f.name === 'string')

export function normalizeShow(value: unknown): Show {
  if (typeof value !== 'object' || value === null || (value as Show).format !== 'heavylight-show') {
    throw new Error('This file is not a HeavyLight show.')
  }
  const raw = value as Partial<Show>
  const base = emptyShow()
  const definitions: Record<string, OflFixture> = {}
  for (const [key, def] of Object.entries(raw.definitions ?? {})) if (isOflFixture(def)) definitions[key] = def
  const images: Record<string, ImageAsset> = {}
  for (const [key, image] of Object.entries(raw.images ?? {})) if (isImageAsset(image)) images[key] = image
  return {
    ...base,
    images,
    name: typeof raw.name === 'string' ? raw.name : base.name,
    definitions,
    fixtures: (raw.fixtures ?? []).map((f) => ({
      ...f,
      position: { ...ORIGIN, ...f.position },
      rotation: { ...ORIGIN, ...f.rotation },
      size: { ...DEFAULT_SIZE, ...f.size }
    })),
    groups: raw.groups ?? [],
    props: (raw.props ?? [])
      .filter((p) => isPropKind(p.kind))
      .map((p) => ({ ...p, position: { ...ORIGIN, ...p.position }, rotation: { ...ORIGIN, ...p.rotation }, size: { ...propType(p.kind).size, ...p.size } })),
    looks: (raw.looks ?? []).map((l, i) => ({ ...newLook(l.name ?? 'Look', i), ...l, layers: (l.layers ?? []).map((layer) => ({ ...newLayer(layer.effect), ...layer })) })),
    effects: (raw.effects ?? []).filter((e) => typeof e?.id === 'string').map(normalizeEffect),
    lookFolders: folders(raw.lookFolders),
    fixtureFolders: folders(raw.fixtureFolders),
    effectFolders: folders(raw.effectFolders),
    chaserFolders: folders(raw.chaserFolders),
    chasers: (raw.chasers ?? []).map((c, i) => ({ ...newChaser(c.name ?? 'Chaser', i), ...c, steps: (c.steps ?? []).map((step) => ({ ...newStep(''), ...step })) })),
    stage: { ...base.stage, ...raw.stage },
    settings: { ...base.settings, ...raw.settings }
  }
}

/** Next free host / universe when adding fixtures in a row: last octet and universe count up together. */
export function nextHost(host: string, step: number): string {
  const m = /^(\d+\.\d+\.\d+\.)(\d+)$/.exec(host)
  return m ? `${m[1]}${Math.min(254, Number(m[2]) + step)}` : host
}

/** A small flame texture for the demo show: bright and yellow at the bottom, red tongues fading out towards the top. */
function flames(): ImageAsset {
  const w = 48
  const h = 64
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const up = 1 - y / (h - 1)
      // Tongues: sines that tile horizontally and vertically, so the image can travel without a seam.
      const a = (x / w) * Math.PI * 2
      const b = (y / h) * Math.PI * 2
      const tongue = 0.5 + 0.25 * Math.sin(a * 2 + Math.sin(b) * 1.5) + 0.25 * Math.sin(a * 5 - b * 2)
      const heat = Math.max(0, Math.min(1, 0.35 + 0.65 * tongue - 0.25 * Math.cos(b)))
      const o = (y * w + x) * 3
      rgb[o] = Math.round(255 * Math.min(1, heat * 1.6))
      rgb[o + 1] = Math.round(255 * Math.max(0, heat * 1.5 - 0.55))
      rgb[o + 2] = Math.round(255 * Math.max(0, heat * 2 - 1.7) * up)
    }
  }
  return encodeImage('Flames', w, h, rgb)
}

/** The band's rig from the project briefing: 13 WLED beams, one Art-Net universe each. */
export function demoShow(): Show {
  const show = emptyShow()
  show.name = 'Demo rig'
  const key = genericPixelKey(96, 1, 'RGB')
  show.definitions[key] = makeGenericPixelFixture(96, 1, 'RGB')

  const count = 13
  const fixtures: FixtureInstance[] = []
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1) - 0.5
    fixtures.push({
      id: `beam-${i + 1}`,
      name: `Beam ${i + 1}`,
      definition: key,
      mode: 'RGB',
      host: `192.168.0.${201 + i}`,
      universe: 1 + i,
      address: 1,
      // A shallow arc along the back of the stage, beams standing upright (pixel 1 at the foot).
      position: { x: +(f * 6).toFixed(2), y: 0.5, z: +(-1.6 + 3.2 * f * f).toFixed(2) },
      rotation: { x: 0, y: 0, z: 90 },
      size: { w: 1, h: 0 }
    })
  }
  show.fixtures = fixtures
  const ids = fixtures.map((f) => f.id)
  show.groups = [
    { id: 'g-left', name: 'Left', fixtureIds: ids.slice(0, 6) },
    { id: 'g-right', name: 'Right', fixtureIds: ids.slice(7) },
    { id: 'g-odd', name: 'Odd', fixtureIds: ids.filter((_, i) => i % 2 === 0) },
    { id: 'g-even', name: 'Even', fixtureIds: ids.filter((_, i) => i % 2 === 1) }
  ]

  // The band, so the preview shows the lights in proportion: drums on a riser, three up front, wedges at the stage edge.
  show.props = [
    newProp('riser', 'prop-riser', 'Drum riser', { z: -0.2 }),
    newProp('drummer', 'prop-drums', 'Drums', { y: 0.4, z: -0.55 }),
    newProp('singer', 'prop-vocals', 'Vocals', { z: 1.5 }),
    { ...newProp('guitarist', 'prop-guitar', 'Guitar', { x: -2.1, z: 1.2 }), rotation: { x: 0, y: 15, z: 0 } },
    { ...newProp('bassist', 'prop-bass', 'Bass', { x: 2.1, z: 1.2 }), rotation: { x: 0, y: -15, z: 0 } },
    { ...newProp('keyboardist', 'prop-keys', 'Keys', { x: -2.9, z: -0.4 }), rotation: { x: 0, y: 35, z: 0 } },
    newProp('monitor', 'prop-monitor-1', 'Monitor 1', { x: -2.1, z: 2.15 }),
    newProp('monitor', 'prop-monitor-2', 'Monitor 2', { z: 2.2 }),
    newProp('monitor', 'prop-monitor-3', 'Monitor 3', { x: 2.1, z: 2.15 })
  ]

  const look = (i: number, name: string, note: number, patch: Partial<Look>, layers: Partial<Layer>[]): Look => ({
    ...newLook(name, i),
    id: `look-${i + 1}`,
    midi: { channel: 0, note },
    ...patch,
    layers: layers.map((l, n) => ({ ...newLayer(l.effect), ...l, id: `look-${i + 1}-layer-${n + 1}`, params: { ...defaultParams(l.effect ?? 'solid'), ...l.params } }))
  })

  show.looks = [
    look(0, 'Warm wash', 36, { fadeIn: 300, fadeOut: 800 }, [{ effect: 'solid', params: { color: '#ff7a1a' } }]),
    look(1, 'Blue tide', 37, { fadeIn: 400, fadeOut: 800 }, [
      { effect: 'wave', mapping: 'stageX', params: { colorA: '#18b6ff', colorB: '#050a3c', repeats: 1.5, speed: 0.35 } }
    ]),
    look(2, 'Rainbow sweep', 38, { fadeIn: 200, fadeOut: 400 }, [{ effect: 'rainbow', mapping: 'stageX', params: { repeats: 1, speed: 0.2 } }]),
    look(3, 'Risers', 39, {}, [{ effect: 'chase', mapping: 'fixture', params: { color: '#ffffff', count: 2, width: 0.35, speed: 1.5, tail: 1 } }]),
    look(4, 'Beam runner', 40, {}, [
      { effect: 'chase', mapping: 'index', params: { color: '#ff2d6f', count: 1, width: 0.2, speed: 1, tail: 0.8, bounce: true } }
    ]),
    look(5, 'Embers', 41, { fadeIn: 500, fadeOut: 1000 }, [
      { effect: 'plasma', mapping: 'fixture', params: { colorA: '#ff3c00', colorB: '#3a0018', scale: 1.4, speed: 0.5 } },
      { effect: 'sparkle', blend: 'add', params: { color: '#ffc46b', density: 0.06, rate: 3 } }
    ]),
    look(6, 'Kick hit', 42, { fadeOut: 0, velocity: true }, [{ effect: 'pulse', params: { color: '#ff2a1f', rate: 2, floor: 0, hit: true } }]),
    look(7, 'Odd / even', 43, {}, [
      { effect: 'strobe', targets: ['g-odd'], params: { color: '#27e0ff', rate: 4, duty: 0.5 } },
      { effect: 'solid', targets: ['g-even'], params: { color: '#6a1bff' } }
    ]),
    look(8, 'Strobe', 44, { fadeOut: 0 }, [{ effect: 'strobe', blend: 'max', params: { color: '#ffffff', rate: 12, duty: 0.3 } }]),
    look(9, 'Fire', 45, { fadeIn: 300, fadeOut: 600 }, [{ effect: 'image', params: { image: 'flames', moveY: 0.35, moveX: 0.04 } }])
  ]
  show.images.flames = flames()

  // Two effects built from curves, as a starting point for the Effects tab.
  const breathing = newCustomEffect('breathing', 'Breathing')
  breathing.brightness.drive = newDrive('sine', { sync: 'beats', beats: 2 })
  breathing.colour.color = '#ff5a1f'
  const comet = newCustomEffect('comet', 'Comet')
  comet.brightness.drive = newDrive('bump', { over: 'position', hz: 0.6 })
  comet.brightness.drive.curve = { shape: 'smooth', points: [{ x: 0, y: 0 }, { x: 0.55, y: 0 }, { x: 0.9, y: 1 }, { x: 1, y: 0 }] }
  comet.colour = { ...comet.colour, mode: 'curve', gradient: [{ at: 0, color: '#2d4bff' }, { at: 0.6, color: '#18b6ff' }, { at: 1, color: '#ffffff' }], drive: { ...comet.brightness.drive, curve: comet.brightness.drive.curve } }
  show.effects = [breathing, comet]
  show.looks.push(look(10, 'Comets', 46, { fadeOut: 300 }, [{ effect: customKey('comet') }]))
  show.lookFolders = [
    { id: 'folder-washes', name: 'Washes' },
    { id: 'folder-hits', name: 'Hits and strobes' }
  ]
  for (const l of show.looks) {
    if (['Warm wash', 'Blue tide', 'Rainbow sweep', 'Embers', 'Fire'].includes(l.name)) l.folder = 'folder-washes'
    else if (['Kick hit', 'Odd / even', 'Strobe'].includes(l.name)) l.folder = 'folder-hits'
  }

  const chaser = (i: number, name: string, note: number, patch: Partial<Chaser>, steps: [look: number, beats: number][]): Chaser => ({
    ...newChaser(name, i),
    id: `chaser-${i + 1}`,
    midi: { channel: 0, note },
    ...patch,
    steps: steps.map(([n, beats], k) => ({ id: `chaser-${i + 1}-step-${k + 1}`, lookId: `look-${n}`, beats }))
  })
  show.chasers = [
    chaser(0, 'Colour walk', 48, { bpm: 120, crossfade: 0.5, fadeOut: 600 }, [[1, 2], [2, 2], [6, 2], [3, 2]]),
    chaser(1, 'Drive', 49, { bpm: 120 }, [[4, 1], [5, 1], [8, 1], [9, 1]])
  ]
  return show
}
