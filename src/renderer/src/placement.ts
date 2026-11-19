import * as THREE from 'three'
import { compilePatch } from '@shared/patch'
import { newId, nextHost } from '@shared/show'
import type { Show, Vec3 } from '@shared/types'
import { useStore } from './store'

const DEG = Math.PI / 180
const round = (v: number, digits: number): number => +v.toFixed(digits) || 0

/** What fixtures and stage objects have in common: both can be moved and turned on stage. */
export interface Placed {
  id: string
  position: Vec3
  rotation: Vec3
}

export const toQuaternion = (r: Vec3): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(r.x * DEG, r.y * DEG, r.z * DEG, 'XYZ'))

export function toRotation(q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return { x: round(e.x / DEG, 1), y: round(e.y / DEG, 1), z: round(e.z / DEG, 1) }
}

export const roundPosition = (x: number, y: number, z: number): Vec3 => ({ x: round(x, 3), y: round(y, 3), z: round(z, 3) })

/** Everything selected on the stage, fixtures and objects alike. */
export function selection(): Placed[] {
  const s = useStore.getState()
  return [...s.show.fixtures.filter((f) => s.selectedFixtures.includes(f.id)), ...s.show.props.filter((p) => s.selectedProps.includes(p.id))]
}

/** Replaces position and rotation of the fixtures and objects that `change` returns something for. */
export function place(show: Show, change: (item: Placed) => Pick<Placed, 'position' | 'rotation'> | undefined): Show {
  const apply = <T extends Placed>(item: T): T => {
    const next = change(item)
    return next ? { ...item, position: next.position, rotation: next.rotation } : item
  }
  return { ...show, fixtures: show.fixtures.map(apply), props: show.props.map(apply) }
}

/** Shifts the selection by a distance in metres. */
export function moveSelection(delta: Vec3): void {
  const ids = new Set(selection().map((i) => i.id))
  if (ids.size === 0) return
  useStore.getState().edit(
    (show) =>
      place(show, (i) =>
        ids.has(i.id) ? { position: roundPosition(i.position.x + delta.x, i.position.y + delta.y, i.position.z + delta.z), rotation: i.rotation } : undefined
      ),
    `nudge-${[...ids].join()}`
  )
}

/**
 * Turns the selection about the vertical axis through its middle, as one rigid piece.
 * Positive is anticlockwise seen from above.
 */
export function turnSelection(degrees: number): void {
  const items = selection()
  if (items.length === 0) return
  const ids = new Set(items.map((i) => i.id))
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), degrees * DEG)
  const centre = items.reduce((sum, i) => sum.add(new THREE.Vector3(i.position.x, i.position.y, i.position.z)), new THREE.Vector3()).divideScalar(items.length)
  const p = new THREE.Vector3()
  useStore.getState().edit(
    (show) =>
      place(show, (i) => {
        if (!ids.has(i.id)) return undefined
        p.set(i.position.x, i.position.y, i.position.z).sub(centre).applyQuaternion(turn).add(centre)
        return { position: roundPosition(p.x, p.y, p.z), rotation: toRotation(turn.clone().multiply(toQuaternion(i.rotation))) }
      }),
    `turn-${[...ids].join()}`
  )
}

export function deleteSelection(): void {
  const s = useStore.getState()
  const gone = new Set([...s.selectedFixtures, ...s.selectedProps])
  if (gone.size === 0) return
  s.editNow((show) => ({
    ...show,
    fixtures: show.fixtures.filter((f) => !gone.has(f.id)),
    props: show.props.filter((p) => !gone.has(p.id)),
    groups: show.groups.map((g) => ({ ...g, fixtureIds: g.fixtureIds.filter((id) => !gone.has(id)) })),
    looks: show.looks.map((l) => ({ ...l, layers: l.layers.map((y) => ({ ...y, targets: y.targets.filter((t) => !gone.has(t)) })) }))
  }))
  s.set({ selectedFixtures: [], selectedProps: [] })
}

/** "Beam 3" → "Beam 4", "Riser" → "Riser copy". */
const copyName = (name: string): string => (/\d+$/.test(name) ? name.replace(/(\d+)$/, (n) => String(Number(n) + 1)) : `${name} copy`)

/**
 * Copies the selection half a metre to the right and selects the copies. Copied fixtures get the
 * IP addresses and universes that follow the originals.
 */
export function duplicateSelection(): void {
  const s = useStore.getState()
  const fixtures = s.show.fixtures.filter((f) => s.selectedFixtures.includes(f.id))
  const props = s.show.props.filter((p) => s.selectedProps.includes(p.id))
  if (fixtures.length + props.length === 0) return
  const patch = compilePatch(s.show)
  const first = Math.min(...fixtures.map((f) => f.universe))
  const last = Math.max(...fixtures.map((f) => patch.byId.get(f.id)?.segments.at(-1)?.universe ?? f.universe))
  const shifted = (p: Vec3): Vec3 => ({ ...p, x: round(p.x + 0.5, 3) })
  const fixtureCopies = fixtures.map((f) => ({
    ...f,
    id: newId(),
    name: copyName(f.name),
    host: nextHost(f.host, fixtures.length),
    universe: f.universe + (last - first + 1),
    position: shifted(f.position)
  }))
  const propCopies = props.map((p) => ({ ...p, id: newId(), name: copyName(p.name), position: shifted(p.position), size: { ...p.size } }))
  s.editNow((show) => ({ ...show, fixtures: [...show.fixtures, ...fixtureCopies], props: [...show.props, ...propCopies] }))
  s.set({ selectedFixtures: fixtureCopies.map((f) => f.id), selectedProps: propCopies.map((p) => p.id) })
}
