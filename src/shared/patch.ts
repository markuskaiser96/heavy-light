import { resolveMode, type ResolvedMode } from './ofl'
import type { FixtureInstance, Layer, Show, Vec3 } from './types'

/**
 * Turns a show's fixture list into flat arrays: one global "cell" (pixel) index space with
 * world positions, plus where each fixture's DMX bytes go. Used by the engine and by the 3D view,
 * so both always agree on the pixel order.
 */

export interface Segment {
  /** First fixture channel (0-based) in this segment. */
  from: number
  length: number
  universe: number
  /** 0-based position inside the universe. */
  at: number
}

export interface PatchedFixture {
  fixture: FixtureInstance
  mode: ResolvedMode
  cellStart: number
  cellCount: number
  segments: Segment[]
}

export interface Patch {
  fixtures: PatchedFixture[]
  byId: Map<string, PatchedFixture>
  cellCount: number
  /** World position per cell (x, y, z). */
  positions: Float32Array
  warnings: string[]
}

const DEG = Math.PI / 180

/** Rotates a local point by Euler angles in XYZ order (same convention as three.js) and translates it. */
export function toWorld(local: Vec3, rotation: Vec3, position: Vec3): Vec3 {
  const a = Math.cos(rotation.x * DEG)
  const b = Math.sin(rotation.x * DEG)
  const c = Math.cos(rotation.y * DEG)
  const d = Math.sin(rotation.y * DEG)
  const e = Math.cos(rotation.z * DEG)
  const f = Math.sin(rotation.z * DEG)
  const { x, y, z } = local
  return {
    x: position.x + c * e * x - c * f * y + d * z,
    y: position.y + (a * f + b * e * d) * x + (a * e - b * f * d) * y - b * c * z,
    z: position.z + (b * f - a * e * d) * x + (b * e + a * f * d) * y + a * c * z
  }
}

/** Local position of a grid cell: pixels run along +X, rows go down along -Y, centred on the fixture. */
export function cellLocal(fx: FixtureInstance, mode: ResolvedMode, x: number, y: number): Vec3 {
  const lx = mode.gridW > 1 ? (x / (mode.gridW - 1) - 0.5) * fx.size.w : 0
  const ly = mode.gridH > 1 ? (0.5 - y / (mode.gridH - 1)) * fx.size.h : 0
  return { x: lx, y: ly, z: 0 }
}

/** Splits a fixture's channels over consecutive universes. */
export function layoutSegments(channelCount: number, universe: number, address: number, channelsPerPixel: number): Segment[] {
  const segments: Segment[] = []
  let from = 0
  let at = Math.max(0, address - 1)
  let uni = universe
  // Pixel fixtures keep whole pixels per universe and continue at channel 1 – this is what WLED
  // expects in "Multi RGB" mode (wled00/e131.cpp) and what most pixel controllers do.
  const unit = channelsPerPixel > 0 ? channelsPerPixel : 1
  while (from < channelCount) {
    const room = Math.floor((512 - at) / unit) * unit
    const length = Math.min(room, channelCount - from)
    if (length > 0) segments.push({ from, length, universe: uni, at })
    from += length
    uni += 1
    at = 0
  }
  return segments
}

export function compilePatch(show: Pick<Show, 'fixtures' | 'definitions'>): Patch {
  const fixtures: PatchedFixture[] = []
  const warnings: string[] = []
  let cellCount = 0

  for (const fixture of show.fixtures) {
    const def = show.definitions[fixture.definition]
    if (!def) {
      warnings.push(`${fixture.name}: fixture type "${fixture.definition}" is missing from the show`)
      continue
    }
    let mode: ResolvedMode
    try {
      mode = resolveMode(def, fixture.mode)
    } catch (err) {
      warnings.push(`${fixture.name}: ${(err as Error).message}`)
      continue
    }
    if (mode.cells.length === 0) warnings.push(`${fixture.name}: mode "${fixture.mode}" has no colour or dimmer channels HeavyLight can drive yet`)
    const segments = layoutSegments(mode.channelCount, fixture.universe, fixture.address, mode.channelsPerPixel)
    fixtures.push({ fixture, mode, cellStart: cellCount, cellCount: mode.cells.length, segments })
    cellCount += mode.cells.length
  }

  // Two fixtures writing to the same channel of the same node is always a patch mistake.
  const used = new Map<string, string>()
  const clashes = new Set<string>()
  for (const pf of fixtures)
    for (const s of pf.segments)
      for (let ch = s.at; ch < s.at + s.length; ch++) {
        const key = `${pf.fixture.host}|${s.universe}|${ch}`
        const other = used.get(key)
        if (other !== undefined && other !== pf.fixture.id) clashes.add([other, pf.fixture.id].sort().join('|'))
        else used.set(key, pf.fixture.id)
      }
  const nameOf = (id: string) => fixtures.find((f) => f.fixture.id === id)?.fixture.name ?? id
  for (const clash of clashes) {
    const [a, b] = clash.split('|')
    warnings.push(`${nameOf(a)} and ${nameOf(b)} overlap on the same DMX channels`)
  }

  const positions = new Float32Array(cellCount * 3)
  for (const pf of fixtures)
    pf.mode.cells.forEach((cell, i) => {
      const w = toWorld(cellLocal(pf.fixture, pf.mode, cell.x, cell.y), pf.fixture.rotation, pf.fixture.position)
      positions.set([w.x, w.y, w.z], (pf.cellStart + i) * 3)
    })

  return { fixtures, byId: new Map(fixtures.map((f) => [f.fixture.id, f])), cellCount, positions, warnings }
}

/** Resolves a layer's targets (fixture and group ids, empty = everything) to patched fixtures, in order, without duplicates. */
export function resolveTargets(show: Show, patch: Patch, targets: string[]): PatchedFixture[] {
  if (targets.length === 0) return patch.fixtures
  const groups = new Map(show.groups.map((g) => [g.id, g]))
  const seen = new Set<string>()
  const result: PatchedFixture[] = []
  const add = (id: string) => {
    const pf = patch.byId.get(id)
    if (pf && !seen.has(id)) {
      seen.add(id)
      result.push(pf)
    }
  }
  for (const target of targets) {
    const group = groups.get(target)
    if (group) group.fixtureIds.forEach(add)
    else add(target)
  }
  return result
}

/** Global cell indices and effect coordinates (0..1) for one layer. */
export function mapLayer(show: Show, patch: Patch, layer: Layer): { cells: Uint32Array; u: Float32Array } {
  const targets = resolveTargets(show, patch, layer.targets)
  const total = targets.reduce((n, pf) => n + pf.cellCount, 0)
  const cells = new Uint32Array(total)
  const u = new Float32Array(total)

  let k = 0
  for (const pf of targets) for (let i = 0; i < pf.cellCount; i++) cells[k++] = pf.cellStart + i

  const along = (pf: PatchedFixture, i: number): number => {
    const { gridW, gridH, cells: c } = pf.mode
    if (gridW > 1) return c[i].x / (gridW - 1)
    if (gridH > 1) return c[i].y / (gridH - 1)
    return 0.5
  }

  k = 0
  switch (layer.mapping) {
    case 'fixture':
      for (const pf of targets) for (let i = 0; i < pf.cellCount; i++) u[k++] = along(pf, i)
      break
    case 'span': {
      const n = targets.length
      targets.forEach((pf, fi) => {
        for (let i = 0; i < pf.cellCount; i++) u[k++] = n > 0 ? (fi + along(pf, i) * (pf.cellCount > 1 ? 1 : 0)) / n : 0
      })
      break
    }
    case 'index': {
      // Spread fixtures over 0..1 without reaching 1, so looping effects treat first and last as neighbours.
      const n = targets.length
      targets.forEach((pf, fi) => {
        for (let i = 0; i < pf.cellCount; i++) u[k++] = n > 0 ? fi / n : 0
      })
      break
    }
    default: {
      const axis = layer.mapping === 'stageX' ? 0 : layer.mapping === 'stageY' ? 1 : 2
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < total; i++) {
        const v = patch.positions[cells[i] * 3 + axis]
        if (v < min) min = v
        if (v > max) max = v
      }
      const range = max - min
      for (let i = 0; i < total; i++) u[i] = range > 1e-6 ? (patch.positions[cells[i] * 3 + axis] - min) / range : 0.5
    }
  }
  return { cells, u }
}
