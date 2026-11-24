/**
 * Open Fixture Library (OFL) fixture format: types and a resolver that turns one mode of a
 * definition into something the engine can write DMX bytes for.
 * Schema reference: https://github.com/OpenLightingProject/open-fixture-library/tree/master/schemas
 */

export interface OflCapability {
  type: string
  dmxRange?: [number, number]
  color?: string
  shutterEffect?: string
  [key: string]: unknown
}

export interface OflChannel {
  name?: string
  fineChannelAliases?: string[]
  defaultValue?: number | string
  capability?: OflCapability
  capabilities?: OflCapability[]
  [key: string]: unknown
}

export type OflPixelGroup = string[] | 'all' | { x?: string[]; y?: string[]; z?: string[]; name?: string[] }

export interface OflMatrix {
  pixelCount?: [number, number, number]
  pixelKeys?: (string | null)[][][]
  pixelGroups?: Record<string, OflPixelGroup>
}

export interface OflMatrixInsert {
  insert: 'matrixChannels'
  repeatFor: string | string[]
  channelOrder: 'perPixel' | 'perChannel'
  templateChannels: (string | null)[]
}

export interface OflMode {
  name: string
  shortName?: string
  channels: (string | null | OflMatrixInsert)[]
  [key: string]: unknown
}

export interface OflFixture {
  $schema?: string
  name: string
  shortName?: string
  categories: string[]
  meta?: unknown
  physical?: { dimensions?: [number, number, number]; [key: string]: unknown }
  matrix?: OflMatrix
  availableChannels?: Record<string, OflChannel>
  templateChannels?: Record<string, OflChannel>
  modes: OflMode[]
  [key: string]: unknown
}

/** What a DMX channel is driven by. */
export const Comp = {
  Red: 0,
  Green: 1,
  Blue: 2,
  /** Brightest of R/G/B: drives a dimmer on fixtures without colour mixing. */
  Level: 3
} as const
export type Comp = (typeof Comp)[keyof typeof Comp]

export interface ChannelWrite {
  /** Channel offset inside the fixture, 0-based. */
  offset: number
  /** Index into ResolvedMode.cells. */
  cell: number
  comp: Comp
}

export interface Cell {
  /** Grid position (0-based, may be fractional for pixel groups). */
  x: number
  y: number
}

export interface ResolvedMode {
  channelCount: number
  channelNames: string[]
  /** Value of every channel before cell colours are written. */
  defaults: Uint8Array
  /** Independently controllable light sources ("pixels"). */
  cells: Cell[]
  gridW: number
  gridH: number
  writes: ChannelWrite[]
  /** >0 if the mode is nothing but equally sized per-pixel blocks (so pixels can be kept whole across universes). */
  channelsPerPixel: number
  /** Channels the engine cannot drive yet (stay at their default). */
  unsupported: string[]
}

interface Pixel {
  key: string
  x: number
  y: number
  z: number
}

function matrixPixels(matrix: OflMatrix | undefined): Pixel[] {
  if (!matrix) return []
  const pixels: Pixel[] = []
  if (matrix.pixelKeys) {
    matrix.pixelKeys.forEach((plane, z) =>
      plane.forEach((row, y) =>
        row.forEach((key, x) => {
          if (key !== null) pixels.push({ key, x, y, z })
        })
      )
    )
    return pixels
  }
  const [nx, ny, nz] = matrix.pixelCount ?? [1, 1, 1]
  const axes = [nx > 1, ny > 1, nz > 1].filter(Boolean).length
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        let key: string
        if (axes <= 1) key = String(x + y + z + 1)
        else if (axes === 2) {
          const used = [nx > 1 ? x + 1 : null, ny > 1 ? y + 1 : null, nz > 1 ? z + 1 : null].filter((v) => v !== null)
          key = `(${used.join(', ')})`
        } else key = `(${x + 1}, ${y + 1}, ${z + 1})`
        pixels.push({ key, x, y, z })
      }
  return pixels
}

function matchesConstraint(position: number, constraint: string): boolean {
  let m: RegExpMatchArray | null
  if ((m = constraint.match(/^=(\d+)$/))) return position === Number(m[1])
  if ((m = constraint.match(/^>=(\d+)$/))) return position >= Number(m[1])
  if ((m = constraint.match(/^<=(\d+)$/))) return position <= Number(m[1])
  if ((m = constraint.match(/^(\d+)n$/))) return position % Number(m[1]) === 0
  if ((m = constraint.match(/^(\d+)n\+(\d+)$/))) return position % Number(m[1]) === Number(m[2])
  if (constraint === 'even') return position % 2 === 0
  if (constraint === 'odd') return position % 2 === 1
  return false
}

function groupMembers(group: OflPixelGroup, pixels: Pixel[]): Pixel[] {
  if (group === 'all') return pixels
  if (Array.isArray(group)) return pixels.filter((p) => group.includes(p.key))
  return pixels.filter((p) => {
    // Constraints use 1-based positions; every listed constraint of an axis must hold.
    for (const axis of ['x', 'y', 'z'] as const) {
      const list = group[axis]
      if (list && !list.every((c) => matchesConstraint(p[axis] + 1, c))) return false
    }
    if (group.name && !group.name.every((pattern) => new RegExp(pattern).test(p.key))) return false
    return true
  })
}

const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare

function orderedPixelKeys(repeatFor: string | string[], pixels: Pixel[], groupKeys: string[]): string[] {
  if (Array.isArray(repeatFor)) return repeatFor
  if (repeatFor === 'eachPixelGroup') return groupKeys
  if (repeatFor === 'eachPixelABC') return pixels.map((p) => p.key).sort(naturalCompare)
  const m = repeatFor.match(/^eachPixel([XYZ])([XYZ])([XYZ])$/)
  if (!m) return pixels.map((p) => p.key)
  // First letter is the fastest-changing axis.
  const axes = [m[3], m[2], m[1]].map((a) => a.toLowerCase() as 'x' | 'y' | 'z')
  return [...pixels].sort((a, b) => a[axes[0]] - b[axes[0]] || a[axes[1]] - b[axes[1]] || a[axes[2]] - b[axes[2]]).map((p) => p.key)
}

function defaultByte(channel: OflChannel): number {
  const fine = channel.fineChannelAliases?.length ?? 0
  const dv = channel.defaultValue
  if (typeof dv === 'string') return Math.round((parseFloat(dv) / 100) * 255)
  if (typeof dv === 'number') return Math.min(255, Math.max(0, dv >> (8 * fine)))
  // Without an explicit default, at least open the shutter if the channel has one.
  const open = channel.capabilities?.find((c) => c.type === 'ShutterStrobe' && c.shutterEffect === 'Open')
  if (open?.dmxRange) return Math.min(255, open.dmxRange[0] >> (8 * fine))
  return 0
}

interface Resolved {
  channel: OflChannel
  /** Pixel or pixel-group key for template channels. */
  pixelKey: string | null
  /** 0 = coarse channel, 1+ = fine channels. */
  fine: number
}

const COLOR_COMP: Record<string, Comp> = { Red: Comp.Red, Green: Comp.Green, Blue: Comp.Blue }

export function resolveMode(fixture: OflFixture, modeName: string): ResolvedMode {
  const mode = fixture.modes.find((m) => m.name === modeName) ?? fixture.modes[0]
  if (!mode) throw new Error(`Fixture "${fixture.name}" has no modes`)

  const pixels = matrixPixels(fixture.matrix)
  const pixelByKey = new Map(pixels.map((p) => [p.key, p]))
  const groups = fixture.matrix?.pixelGroups ?? {}
  const groupKeys = Object.keys(groups)

  // Every channel key a mode may reference → what it is.
  const lookup = new Map<string, Resolved>()
  const register = (key: string, channel: OflChannel, pixelKey: string | null, subst: (s: string) => string) => {
    lookup.set(subst(key), { channel, pixelKey, fine: 0 })
    channel.fineChannelAliases?.forEach((alias, i) => lookup.set(subst(alias), { channel, pixelKey, fine: i + 1 }))
  }
  for (const [key, channel] of Object.entries(fixture.availableChannels ?? {})) register(key, channel, null, (s) => s)
  for (const [key, channel] of Object.entries(fixture.templateChannels ?? {}))
    for (const pk of [...pixels.map((p) => p.key), ...groupKeys]) register(key, channel, pk, (s) => s.replaceAll('$pixelKey', pk))

  // Expand the mode's channel list (matrix inserts → concrete keys).
  const keys: (string | null)[] = []
  let pixelBlock = 0
  let onlyPixelBlocks = true
  for (const entry of mode.channels) {
    if (entry === null || typeof entry === 'string') {
      keys.push(entry)
      onlyPixelBlocks = false
      continue
    }
    const pks = orderedPixelKeys(entry.repeatFor, pixels, groupKeys)
    const expand = (template: string | null, pk: string) => keys.push(template === null ? null : template.replaceAll('$pixelKey', pk))
    if (entry.channelOrder === 'perPixel') {
      for (const pk of pks) for (const t of entry.templateChannels) expand(t, pk)
      if (pixelBlock === 0 || pixelBlock === entry.templateChannels.length) pixelBlock = entry.templateChannels.length
      else onlyPixelBlocks = false
    } else {
      for (const t of entry.templateChannels) for (const pk of pks) expand(t, pk)
      onlyPixelBlocks = false
    }
  }

  const channelCount = keys.length
  const defaults = new Uint8Array(channelCount)
  const channelNames: string[] = []
  const unsupported: string[] = []

  // Collect colour channels per owner: '' = whole fixture, otherwise pixel or group key.
  const colorOf = new Map<string, { offset: number; comp: Comp }[]>()
  const dimmers: number[] = []

  keys.forEach((key, offset) => {
    channelNames.push(key ?? '(unused)')
    if (key === null) return
    const r = lookup.get(key)
    if (!r) {
      unsupported.push(key)
      return
    }
    defaults[offset] = r.fine === 0 ? defaultByte(r.channel) : 0
    const cap = r.channel.capability
    if (cap?.type === 'ColorIntensity' && cap.color !== undefined && cap.color in COLOR_COMP) {
      const owner = r.pixelKey ?? ''
      if (!colorOf.has(owner)) colorOf.set(owner, [])
      colorOf.get(owner)!.push({ offset, comp: COLOR_COMP[cap.color] })
    } else if (cap?.type === 'Intensity') {
      dimmers.push(offset)
    } else if (r.fine === 0 && cap?.type !== 'NoFunction') {
      unsupported.push(key)
    }
  })

  // Pick the finest colour resolution the mode offers: single pixels, else pixel groups, else the whole fixture.
  const owners = [...colorOf.keys()]
  const pixelOwners = owners.filter((o) => pixelByKey.has(o))
  const groupOwners = owners.filter((o) => o !== '' && !pixelByKey.has(o))
  const chosen = pixelOwners.length ? pixelOwners : groupOwners.length ? groupOwners : owners

  const gridW = pixels.length ? Math.max(...pixels.map((p) => p.x)) + 1 : 1
  const gridH = pixels.length ? Math.max(...pixels.map((p) => p.y)) + 1 : 1
  const cells: Cell[] = []
  const writes: ChannelWrite[] = []

  for (const owner of chosen) {
    let x = (gridW - 1) / 2
    let y = (gridH - 1) / 2
    const pixel = pixelByKey.get(owner)
    if (pixel) {
      x = pixel.x
      y = pixel.y
    } else if (owner !== '' && groups[owner]) {
      const members = groupMembers(groups[owner], pixels)
      if (members.length) {
        x = members.reduce((s, p) => s + p.x, 0) / members.length
        y = members.reduce((s, p) => s + p.y, 0) / members.length
      }
    }
    const cell = cells.push({ x, y }) - 1
    for (const c of colorOf.get(owner)!) writes.push({ offset: c.offset, cell, comp: c.comp })
  }

  if (cells.length) {
    // Colour is mixed per cell, so dimmers just need to be open.
    for (const offset of dimmers) defaults[offset] = 255
  } else if (dimmers.length) {
    // No colour mixing: one white cell that drives the dimmer(s).
    cells.push({ x: (gridW - 1) / 2, y: (gridH - 1) / 2 })
    for (const offset of dimmers) writes.push({ offset, cell: 0, comp: Comp.Level })
  }

  const channelsPerPixel =
    onlyPixelBlocks && pixelBlock > 0 && cells.length * pixelBlock === channelCount && pixelOwners.length === cells.length ? pixelBlock : 0

  return { channelCount, channelNames, defaults, cells, gridW, gridH, writes, channelsPerPixel, unsupported }
}

export const COLOR_ORDERS = ['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR'] as const
export type ColorOrder = (typeof COLOR_ORDERS)[number]

/** Key under which a generated pixel fixture is stored in Show.definitions. */
export function genericPixelKey(w: number, h: number, order: ColorOrder): string {
  return `generic/pixel-${w}x${h}-${order.toLowerCase()}`
}

/** Builds a valid OFL definition for a plain RGB pixel strip (h = 1) or matrix. */
export function makeGenericPixelFixture(w: number, h: number, order: ColorOrder = 'RGB'): OflFixture {
  const names = { R: 'Red', G: 'Green', B: 'Blue' } as const
  const today = '2026-11-18'
  return {
    $schema: 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json',
    name: h === 1 ? `RGB Pixel Strip ${w}` : `RGB Pixel Matrix ${w}x${h}`,
    categories: [h === 1 ? 'Pixel Bar' : 'Matrix'],
    meta: { authors: ['HeavyLight'], createDate: today, lastModifyDate: today },
    matrix: { pixelCount: [w, h, 1] },
    templateChannels: {
      'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
      'Green $pixelKey': { capability: { type: 'ColorIntensity', color: 'Green' } },
      'Blue $pixelKey': { capability: { type: 'ColorIntensity', color: 'Blue' } }
    },
    modes: [
      {
        name: order,
        channels: [
          {
            insert: 'matrixChannels',
            repeatFor: 'eachPixelXYZ',
            channelOrder: 'perPixel',
            templateChannels: [...order].map((c) => `${names[c as 'R' | 'G' | 'B']} $pixelKey`)
          }
        ]
      }
    ]
  }
}

/**
 * Extent of a library fixture's cell grid on stage in metres. Cells sit on the grid points, so the drawn
 * body is one cell longer than the grid: the size is chosen so that the body is as long as the real fixture
 * (OFL `physical.dimensions`, width × height × depth in mm).
 */
export function stageSize(fixture: OflFixture, mode: Pick<ResolvedMode, 'gridW' | 'gridH'>): { w: number; h: number } {
  const d = fixture.physical?.dimensions
  const known = Array.isArray(d) && d.length === 3 && d.every((v) => typeof v === 'number' && v > 0)
  const along = (metres: number | null, grid: number, fallback: number) =>
    metres === null ? fallback : +(grid > 1 ? (metres * (grid - 1)) / grid : metres).toFixed(3)
  return {
    w: along(known ? d[0] / 1000 : null, mode.gridW, mode.gridW > 1 ? 1 : 0.25),
    h: along(known ? d[1] / 1000 : null, mode.gridH, 0.15)
  }
}

/** Loose structural check for files a user imports. */
export function isOflFixture(value: unknown): value is OflFixture {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Partial<OflFixture>
  return (
    typeof f.name === 'string' &&
    Array.isArray(f.modes) &&
    f.modes.length > 0 &&
    f.modes.every((m) => typeof m?.name === 'string' && Array.isArray(m.channels)) &&
    (typeof f.availableChannels === 'object' || typeof f.templateChannels === 'object')
  )
}
