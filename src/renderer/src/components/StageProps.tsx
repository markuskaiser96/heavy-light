import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PERSON_HEIGHT, propBox, propType } from '@shared/props'
import type { StageProp } from '@shared/types'
import { useStore } from '../store'

const DEG = Math.PI / 180
type P3 = [number, number, number]

// Scenery stays grey and matt: it is lit by the fixtures' spill and must not compete with them.
// A little glow of their own keeps them readable while the rig is dark.
const material = (color: string, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity: 0.35 })
const SKIN = material('#5d6274')
const CLOTH = material('#3b3f4d')
const WOOD = material('#6a5140', 0.6)
const WOOD_DARK = material('#3d3f55', 0.5)
const BLACK = material('#1b1c23', 0.7)
const METAL = material('#8d93a3', 0.35, 0.7)
const BRASS = material('#9a8450', 0.35, 0.8)
const DECK = material('#2b2e3b', 0.8)
const UP = new THREE.Vector3(0, 1, 0)

/** Position, turn and length of a bar that runs from one point to another. */
function between(from: P3, to: P3): { position: THREE.Vector3; quaternion: THREE.Quaternion; length: number } {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const direction = b.clone().sub(a)
  const length = direction.length()
  return { position: a.add(b).multiplyScalar(0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()), length }
}

/** A rounded bar between two points: arms, legs. */
function Limb({ from, to, radius = 0.045, material: m = CLOTH }: { from: P3; to: P3; radius?: number; material?: THREE.Material }) {
  const bar = useMemo(() => between(from, to), [from.join(), to.join()])
  return (
    <mesh position={bar.position} quaternion={bar.quaternion} material={m}>
      <capsuleGeometry args={[radius, bar.length, 3, 10]} />
    </mesh>
  )
}

/** A thin straight rod between two points: stands, sticks. */
function Rod({ from, to, radius = 0.012, material: m = METAL }: { from: P3; to: P3; radius?: number; material?: THREE.Material }) {
  const bar = useMemo(() => between(from, to), [from.join(), to.join()])
  return (
    <mesh position={bar.position} quaternion={bar.quaternion} material={m}>
      <cylinderGeometry args={[radius, radius, bar.length, 8]} />
    </mesh>
  )
}

/** An upright drum or disc. */
function Drum({ at, radius, height, tilt = [0, 0, 0], material: m = WOOD_DARK }: { at: P3; radius: number; height: number; tilt?: P3; material?: THREE.Material }) {
  return (
    <mesh position={at} rotation={tilt} material={m}>
      <cylinderGeometry args={[radius, radius, height, 20]} />
    </mesh>
  )
}

interface Arms {
  /** Elbow and hand of the left arm (the musician's left is +X), in standing coordinates. */
  left: [P3, P3]
  right: [P3, P3]
}

const HANGING: Arms = { left: [[0.26, 1.13, 0], [0.27, 0.86, 0.05]], right: [[-0.26, 1.13, 0], [-0.27, 0.86, 0.05]] }
/** How far the upper body comes down when sitting. */
const SIT = 0.38

/** A simple mannequin, 1.75 m tall, facing +Z (the audience). */
function Person({ arms = HANGING, seated = false }: { arms?: Partial<Arms>; seated?: boolean }) {
  const { left, right } = { ...HANGING, ...arms }
  return (
    <>
      <group position={[0, seated ? -SIT : 0, 0]}>
        <mesh position={[0, 1.2, 0]} scale={[1, 1, 0.68]} material={CLOTH}>
          <capsuleGeometry args={[0.17, 0.36, 4, 14]} />
        </mesh>
        <mesh position={[0, 1.64, 0.01]} material={SKIN}>
          <sphereGeometry args={[0.115, 16, 12]} />
        </mesh>
        <Limb from={[0.21, 1.42, 0]} to={left[0]} />
        <Limb from={left[0]} to={left[1]} radius={0.04} material={SKIN} />
        <Limb from={[-0.21, 1.42, 0]} to={right[0]} />
        <Limb from={right[0]} to={right[1]} radius={0.04} material={SKIN} />
      </group>
      {seated ? (
        <>
          <Limb from={[0.1, 0.56, 0]} to={[0.3, 0.56, 0.38]} radius={0.07} />
          <Limb from={[0.3, 0.56, 0.38]} to={[0.34, 0.07, 0.5]} radius={0.06} />
          <Limb from={[-0.1, 0.56, 0]} to={[-0.3, 0.56, 0.38]} radius={0.07} />
          <Limb from={[-0.3, 0.56, 0.38]} to={[-0.34, 0.07, 0.5]} radius={0.06} />
          <Drum at={[0, 0.46, -0.02]} radius={0.17} height={0.06} material={BLACK} />
          <Rod from={[0, 0, -0.02]} to={[0, 0.44, -0.02]} radius={0.02} />
        </>
      ) : (
        <>
          <Limb from={[0.1, 0.92, 0]} to={[0.12, 0.07, 0]} radius={0.07} />
          <Limb from={[-0.1, 0.92, 0]} to={[-0.12, 0.07, 0]} radius={0.07} />
        </>
      )}
    </>
  )
}

function Singer() {
  return (
    <>
      <Person arms={{ right: [[-0.27, 1.16, 0.12], [-0.04, 1.42, 0.27]] }} />
      <Drum at={[0, 0.012, 0.32]} radius={0.14} height={0.024} material={BLACK} />
      <Rod from={[0, 0, 0.32]} to={[0, 1.46, 0.32]} />
      <Rod from={[0, 1.45, 0.33]} to={[0, 1.53, 0.23]} radius={0.022} material={BLACK} />
    </>
  )
}

/** Guitar or bass, hanging in front of the body with the neck towards the musician's left. */
function Strings({ neck, tilt, body }: { neck: number; tilt: number; body: THREE.Material }) {
  return (
    <group position={[0.02, 1.02, 0.17]} rotation={[0, 0, tilt]}>
      <mesh position={[-0.14, 0, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 1, 1]} material={body}>
        <cylinderGeometry args={[0.18, 0.18, 0.06, 20]} />
      </mesh>
      <mesh position={[0.08, 0, 0]} rotation={[Math.PI / 2, 0, 0]} material={body}>
        <cylinderGeometry args={[0.13, 0.13, 0.06, 18]} />
      </mesh>
      <mesh position={[0.16 + neck / 2, 0, 0.02]} material={BLACK}>
        <boxGeometry args={[neck, 0.05, 0.03]} />
      </mesh>
      <mesh position={[0.23 + neck, 0.01, 0.015]} material={body}>
        <boxGeometry args={[0.15, 0.075, 0.025]} />
      </mesh>
    </group>
  )
}

function Guitarist() {
  return (
    <>
      <Person arms={{ left: [[0.37, 1.15, 0.08], [0.53, 1.23, 0.2]], right: [[-0.31, 1.14, 0.08], [-0.1, 1.0, 0.23]] }} />
      <Strings neck={0.6} tilt={0.38} body={WOOD} />
    </>
  )
}

function Bassist() {
  return (
    <>
      <Person arms={{ left: [[0.43, 1.19, 0.05], [0.7, 1.24, 0.2]], right: [[-0.31, 1.14, 0.08], [-0.08, 0.99, 0.23]] }} />
      <Strings neck={0.82} tilt={0.3} body={WOOD_DARK} />
    </>
  )
}

function Keyboardist() {
  return (
    <>
      <Person arms={{ left: [[0.26, 1.14, 0.1], [0.17, 1.0, 0.36]], right: [[-0.26, 1.14, 0.1], [-0.17, 1.0, 0.36]] }} />
      <mesh position={[0, 0.93, 0.4]} material={BLACK}>
        <boxGeometry args={[1.28, 0.07, 0.33]} />
      </mesh>
      <mesh position={[0, 0.968, 0.45]} material={SKIN}>
        <boxGeometry args={[1.2, 0.006, 0.16]} />
      </mesh>
      <Rod from={[-0.45, 0, 0.4]} to={[0.45, 0.9, 0.4]} radius={0.018} />
      <Rod from={[0.45, 0, 0.4]} to={[-0.45, 0.9, 0.4]} radius={0.018} />
    </>
  )
}

function Drummer() {
  const flat: P3 = [Math.PI / 2, 0, 0]
  return (
    <>
      <Person seated arms={{ left: [[0.31, 1.16, 0.1], [0.17, 1.1, 0.4]], right: [[-0.31, 1.16, 0.1], [-0.17, 1.1, 0.4]] }} />
      {/* Sticks, in hand. */}
      <Rod from={[0.17, 0.72, 0.4]} to={[0.4, 0.8, 0.62]} radius={0.008} material={WOOD} />
      <Rod from={[-0.17, 0.72, 0.4]} to={[-0.04, 0.7, 0.66]} radius={0.008} material={WOOD} />
      {/* Kick, snare, two rack toms, floor tom. */}
      <Drum at={[0, 0.28, 0.98]} radius={0.28} height={0.42} tilt={flat} />
      <Drum at={[0, 0.28, 1.195]} radius={0.265} height={0.01} tilt={flat} material={SKIN} />
      <Drum at={[0.02, 0.6, 0.55]} radius={0.17} height={0.14} material={METAL} />
      <Drum at={[0.18, 0.76, 0.92]} radius={0.14} height={0.16} tilt={[-0.35, 0, 0]} />
      <Drum at={[-0.18, 0.76, 0.92]} radius={0.15} height={0.18} tilt={[-0.35, 0, 0]} />
      <Drum at={[-0.55, 0.42, 0.5]} radius={0.2} height={0.36} />
      <Rod from={[0.02, 0, 0.55]} to={[0.02, 0.54, 0.55]} />
      {/* Hi-hat on the musician's left, crash and ride above the kit. */}
      <Drum at={[0.56, 0.84, 0.55]} radius={0.17} height={0.02} material={BRASS} />
      <Rod from={[0.56, 0, 0.55]} to={[0.56, 0.9, 0.55]} />
      <Drum at={[0.52, 1.26, 1.02]} radius={0.22} height={0.012} tilt={[-0.25, 0, 0.12]} material={BRASS} />
      <Rod from={[0.52, 0, 1.08]} to={[0.52, 1.26, 1.02]} />
      <Drum at={[-0.56, 1.1, 0.98]} radius={0.25} height={0.012} tilt={[-0.3, 0, -0.1]} material={BRASS} />
      <Rod from={[-0.56, 0, 1.06]} to={[-0.56, 1.1, 0.98]} />
    </>
  )
}

function Riser({ w, h, d }: { w: number; h: number; d: number }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, h, d])
  return (
    <group position={[0, h / 2, 0]}>
      <mesh material={DECK}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#4d5269" />
      </lineSegments>
    </group>
  )
}

/** A floor wedge. Unrotated, the sloped speaker side looks upstage, at the band. */
function Monitor({ w, h, d }: { w: number; h: number; d: number }) {
  const [body, edges, grille] = useMemo(() => {
    // Side view: flat underside, upright back towards the audience, slope facing the musician.
    const side = new THREE.Shape([
      new THREE.Vector2(-d / 2, 0),
      new THREE.Vector2(d / 2, 0),
      new THREE.Vector2(d / 2, h * 0.28),
      new THREE.Vector2(-d * 0.12, h),
      new THREE.Vector2(-d / 2, h)
    ])
    const geometry = new THREE.ExtrudeGeometry(side, { depth: w, bevelEnabled: false })
    // The shape was drawn with X pointing upstage; stand it across the stage.
    geometry.rotateY(Math.PI / 2).translate(-w / 2, 0, 0)
    const slope = between([0, h * 0.28, -d / 2], [0, h, d * 0.12])
    return [geometry, new THREE.EdgesGeometry(geometry), slope] as const
  }, [w, h, d])
  return (
    <>
      <mesh geometry={body} material={BLACK} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#4d5269" />
      </lineSegments>
      <mesh position={[0, grille.position.y, grille.position.z - 0.004]} quaternion={grille.quaternion} material={CLOTH}>
        <boxGeometry args={[w * 0.86, grille.length * 0.8, 0.008]} />
      </mesh>
    </>
  )
}

/** Box truss along X: four chords and zigzag bracing on every side. */
function Truss({ w, h, d }: { w: number; h: number; d: number }) {
  const geometry = useMemo(() => {
    const chord = Math.min(0.025, h / 5, d / 5)
    const bar = (from: P3, to: P3, radius: number) => {
      const b = between(from, to)
      return new THREE.CylinderGeometry(radius, radius, b.length, 6).applyQuaternion(b.quaternion).translate(b.position.x, b.position.y, b.position.z)
    }
    const corners: [number, number][] = [
      [chord, -d / 2 + chord],
      [chord, d / 2 - chord],
      [h - chord, d / 2 - chord],
      [h - chord, -d / 2 + chord]
    ]
    const parts = corners.map(([y, z]) => bar([-w / 2, y, z], [w / 2, y, z], chord))
    const bays = Math.max(1, Math.round(w / Math.max(h, d, 0.1)))
    corners.forEach(([y, z], side) => {
      const [y2, z2] = corners[(side + 1) % 4]
      for (let i = 0; i < bays; i++) {
        const x = -w / 2 + (w * i) / bays
        const x2 = -w / 2 + (w * (i + 1)) / bays
        parts.push(i % 2 === 0 ? bar([x, y, z], [x2, y2, z2], chord * 0.5) : bar([x, y2, z2], [x2, y, z], chord * 0.5))
      }
    })
    return mergeGeometries(parts)
  }, [w, h, d])
  return <mesh geometry={geometry} material={METAL} />
}

function Model({ prop }: { prop: StageProp }) {
  const { w, h, d } = prop.size
  switch (prop.kind) {
    case 'riser':
      return <Riser w={w} h={h} d={d} />
    case 'monitor':
      return <Monitor w={w} h={h} d={d} />
    case 'truss':
      return <Truss w={w} h={h} d={d} />
    default: {
      const scale = h / PERSON_HEIGHT
      return (
        <group scale={[scale, scale, scale]}>
          {prop.kind === 'singer' && <Singer />}
          {prop.kind === 'guitarist' && <Guitarist />}
          {prop.kind === 'bassist' && <Bassist />}
          {prop.kind === 'keyboardist' && <Keyboardist />}
          {prop.kind === 'drummer' && <Drummer />}
        </group>
      )
    }
  }
}

/** Musicians, risers, monitors and truss on the stage. In the Stage tab they can be picked. */
export function StageProps({ editable }: { editable: boolean }) {
  const props = useStore((s) => s.show.props)
  const selected = useStore((s) => s.selectedProps)
  const [hover, setHover] = useState<string | null>(null)

  return (
    <>
      {props.map((prop) => {
        const { id, position: p, rotation: r } = prop
        const box = propBox(prop)
        const isSelected = editable && selected.includes(id)
        // A fixture inside the box (a bar hanging in a truss, a beam on a riser) wins the click.
        const fixtureHit = (e: { intersections: { object: THREE.Object3D }[] }) => e.intersections.some((i) => i.object.userData.fixture)
        return (
          <group key={id} position={[p.x, p.y, p.z]} rotation={[r.x * DEG, r.y * DEG, r.z * DEG]}>
            <Model prop={prop} />
            <mesh
              position={box.centre}
              userData={{ label: propType(prop.kind).label }}
              onClick={(e) => {
                if (!editable || fixtureHit(e)) return
                e.stopPropagation()
                const s = useStore.getState()
                if (e.shiftKey || e.metaKey || e.ctrlKey) s.set({ selectedProps: isSelected ? selected.filter((x) => x !== id) : [...selected, id] })
                else s.selectProps([id])
              }}
              onPointerOver={(e) => {
                if (!editable || fixtureHit(e)) return
                e.stopPropagation()
                setHover(id)
              }}
              onPointerOut={() => setHover((h) => (h === id ? null : h))}
            >
              <boxGeometry args={box.size} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {(isSelected || hover === id) && editable && (
              <lineSegments position={box.centre}>
                <edgesGeometry args={[new THREE.BoxGeometry(...box.size)]} />
                <lineBasicMaterial color={isSelected ? '#ffb347' : '#8b91a8'} toneMapped={false} />
              </lineSegments>
            )}
          </group>
        )
      })}
    </>
  )
}
