import type { PropKind, StageProp, Vec3 } from './types'

/** Height the musician models are built for, in metres. `size.h` scales them. */
export const PERSON_HEIGHT = 1.75

export interface PropType {
  kind: PropKind
  label: string
  group: 'Band' | 'Stage'
  /** Musicians only scale with their height; their footprint follows from it. */
  person: boolean
  /** Bounding box in metres. For musicians: the footprint at PERSON_HEIGHT, instrument included. */
  size: { w: number; h: number; d: number }
  /** Centre of the bounding box relative to the position, on the floor plane (musicians stand behind their instrument). */
  offsetZ: number
  /** Height above the floor a new one is placed at. */
  y: number
}

export const PROP_TYPES: PropType[] = [
  { kind: 'singer', label: 'Singer', group: 'Band', person: true, size: { w: 0.6, h: PERSON_HEIGHT, d: 0.8 }, offsetZ: 0.15, y: 0 },
  { kind: 'guitarist', label: 'Guitarist', group: 'Band', person: true, size: { w: 1.1, h: PERSON_HEIGHT, d: 0.6 }, offsetZ: 0.05, y: 0 },
  { kind: 'bassist', label: 'Bassist', group: 'Band', person: true, size: { w: 1.3, h: PERSON_HEIGHT, d: 0.6 }, offsetZ: 0.05, y: 0 },
  { kind: 'keyboardist', label: 'Keyboarder', group: 'Band', person: true, size: { w: 1.4, h: PERSON_HEIGHT, d: 0.9 }, offsetZ: 0.2, y: 0 },
  { kind: 'drummer', label: 'Drummer', group: 'Band', person: true, size: { w: 1.9, h: PERSON_HEIGHT, d: 1.7 }, offsetZ: 0.45, y: 0 },
  { kind: 'riser', label: 'Riser', group: 'Stage', person: false, size: { w: 2, h: 0.4, d: 2 }, offsetZ: 0, y: 0 },
  { kind: 'monitor', label: 'Monitor', group: 'Stage', person: false, size: { w: 0.6, h: 0.36, d: 0.45 }, offsetZ: 0, y: 0 },
  { kind: 'truss', label: 'Truss', group: 'Stage', person: false, size: { w: 3, h: 0.29, d: 0.29 }, offsetZ: 0, y: 2.5 }
]

export const propType = (kind: PropKind): PropType => PROP_TYPES.find((t) => t.kind === kind) ?? PROP_TYPES[5]

export const isPropKind = (kind: unknown): kind is PropKind => PROP_TYPES.some((t) => t.kind === kind)

export function newProp(kind: PropKind, id: string, name: string, position?: Partial<Vec3>): StageProp {
  const type = propType(kind)
  return { id, name, kind, position: { x: 0, y: type.y, z: 0, ...position }, rotation: { x: 0, y: 0, z: 0 }, size: { ...type.size } }
}

/**
 * Bounding box of a prop in its own coordinates: size and centre. The position of a prop is the
 * middle of its underside, so it stands on the floor at y = 0.
 */
export function propBox(prop: StageProp): { size: [number, number, number]; centre: [number, number, number] } {
  const type = propType(prop.kind)
  if (!type.person) return { size: [prop.size.w, prop.size.h, prop.size.d], centre: [0, prop.size.h / 2, 0] }
  const scale = prop.size.h / PERSON_HEIGHT
  return { size: [type.size.w * scale, prop.size.h, type.size.d * scale], centre: [0, prop.size.h / 2, type.offsetZ * scale] }
}
