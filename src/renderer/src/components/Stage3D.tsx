import { OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { compilePatch, type Patch, type PatchedFixture } from '@shared/patch'
import type { Vec3 } from '@shared/types'
import { frame, useStore } from '../store'

const DEG = Math.PI / 180
const MAX_LIGHTS = 16
/** sRGB byte → linear light, so the glow on screen fades like the real LEDs. */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => Math.pow(i / 255, 2.2))

export function usePatch(): Patch {
  const fixtures = useStore((s) => s.show.fixtures)
  const definitions = useStore((s) => s.show.definitions)
  return useMemo(() => compilePatch({ fixtures, definitions }), [fixtures, definitions])
}

/** Size of one light cell of a fixture in metres (along the strip, across, depth). */
function cellSize(pf: PatchedFixture): [number, number, number] {
  const { gridW, gridH } = pf.mode
  const { w, h } = pf.fixture.size
  const single = gridW === 1 && gridH === 1
  const sx = gridW > 1 ? w / (gridW - 1) : Math.max(w, 0.12)
  const sy = gridH > 1 ? h / (gridH - 1) : single ? Math.max(h, 0.12) : 0.028
  return [sx, sy, gridH > 1 || single ? 0.04 : 0.028]
}

function bodySize(pf: PatchedFixture): [number, number, number] {
  const [sx, sy, sz] = cellSize(pf)
  const { gridW, gridH } = pf.mode
  return [sx * gridW + 0.03, sy * gridH + 0.03, sz + 0.03]
}

function Pixels({ patch }: { patch: Patch }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const count = Math.max(1, patch.cellCount)

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    for (const pf of patch.fixtures) {
      const r = pf.fixture.rotation
      quaternion.setFromEuler(new THREE.Euler(r.x * DEG, r.y * DEG, r.z * DEG, 'XYZ'))
      scale.set(...cellSize(pf))
      for (let i = 0; i < pf.cellCount; i++) {
        position.fromArray(patch.positions, (pf.cellStart + i) * 3)
        m.setMatrixAt(pf.cellStart + i, matrix.compose(position, quaternion, scale))
      }
    }
    m.count = patch.cellCount
    m.instanceMatrix.needsUpdate = true
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    m.computeBoundingSphere()
  }, [patch, count])

  useFrame(() => {
    const m = mesh.current
    const colors = m?.instanceColor
    if (!m || !colors) return
    const px = frame.pixels
    const out = colors.array as Float32Array
    const n = Math.min(px.length, patch.cellCount * 3)
    // Values above 1 feed the bloom pass; a dark pixel keeps a faint tint so the fixture stays visible.
    for (let i = 0; i < n; i++) out[i] = 0.03 + LINEAR[px[i]] * 3
    for (let i = n; i < patch.cellCount * 3; i++) out[i] = 0.03
    colors.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} key={count} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

/** One soft light per fixture so beams spill onto the stage floor. */
function Spill({ patch }: { patch: Patch }) {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const fixtures = patch.fixtures.slice(0, MAX_LIGHTS)

  useFrame(() => {
    const px = frame.pixels
    fixtures.forEach((pf, index) => {
      const light = lights.current[index]
      if (!light) return
      let r = 0
      let g = 0
      let b = 0
      const end = Math.min(px.length, (pf.cellStart + pf.cellCount) * 3)
      for (let i = pf.cellStart * 3; i < end; i += 3) {
        r += LINEAR[px[i]]
        g += LINEAR[px[i + 1]]
        b += LINEAR[px[i + 2]]
      }
      const n = Math.max(1, pf.cellCount)
      const peak = Math.max(r, g, b) / n
      if (peak > 0.0005) light.color.setRGB(r / n / peak, g / n / peak, b / n / peak)
      light.intensity = peak * 2.2
    })
  })

  return (
    <>
      {fixtures.map((pf, i) => (
        <pointLight
          key={pf.fixture.id}
          ref={(l) => void (lights.current[i] = l)}
          position={[pf.fixture.position.x, Math.max(0.3, pf.fixture.position.y), pf.fixture.position.z + 0.25]}
          intensity={0}
          distance={7}
          decay={1.6}
        />
      ))}
    </>
  )
}

function FixtureBodies({ patch, editable, mode }: { patch: Patch; editable: boolean; mode: 'translate' | 'rotate' }) {
  const selected = useStore((s) => s.selectedFixtures)
  const selectFixtures = useStore((s) => s.selectFixtures)
  const [hover, setHover] = useState<string | null>(null)
  const [handle, setHandle] = useState<THREE.Group | null>(null)
  const picked = editable ? patch.fixtures.filter((pf) => selected.includes(pf.fixture.id)).map((pf) => pf.fixture) : []
  const single = picked.length === 1 ? picked[0] : null
  // The drag handle sits in the middle of the selection. With one fixture it also takes on its rotation.
  const centre = picked.reduce((sum, f) => sum.add(new THREE.Vector3(f.position.x, f.position.y, f.position.z)), new THREE.Vector3()).divideScalar(Math.max(1, picked.length))
  /** Where the handle and the selected fixtures were when the drag began. */
  const drag = useRef<{ position: THREE.Vector3; rotation: THREE.Quaternion; fixtures: Map<string, { position: Vec3; rotation: THREE.Quaternion }> } | null>(null)

  const beginDrag = () => {
    if (!handle) return
    drag.current = {
      position: handle.position.clone(),
      rotation: handle.quaternion.clone(),
      fixtures: new Map(
        picked.map((f) => [f.id, { position: f.position, rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(f.rotation.x * DEG, f.rotation.y * DEG, f.rotation.z * DEG, 'XYZ')) }])
      )
    }
  }

  const applyDrag = () => {
    const start = drag.current
    if (!handle || !start) return
    const round = (v: number, digits: number) => +v.toFixed(digits) || 0
    const moved = handle.position.clone().sub(start.position)
    const turned = handle.quaternion.clone().multiply(start.rotation.clone().invert())
    const euler = new THREE.Euler()
    useStore.getState().edit(
      (show) => ({
        ...show,
        fixtures: show.fixtures.map((f) => {
          const from = start.fixtures.get(f.id)
          if (!from) return f
          if (mode === 'translate') {
            return { ...f, position: { x: round(from.position.x + moved.x, 3), y: round(from.position.y + moved.y, 3), z: round(from.position.z + moved.z, 3) } }
          }
          // Every fixture turns about its own centre.
          euler.setFromQuaternion(turned.clone().multiply(from.rotation), 'XYZ')
          return { ...f, rotation: { x: round(euler.x / DEG, 1), y: round(euler.y / DEG, 1), z: round(euler.z / DEG, 1) } }
        })
      }),
      `drag-${mode}-${[...start.fixtures.keys()].join()}`
    )
  }

  const endDrag = () => {
    drag.current = null
    // For several fixtures the handle only measures the turn; start the next drag from zero.
    if (!single) handle?.quaternion.identity()
  }

  return (
    <>
      {patch.fixtures.map((pf) => {
        const { id, position: p, rotation: r } = pf.fixture
        const isSelected = selected.includes(id)
        const size = bodySize(pf)
        return (
          <group key={id} position={[p.x, p.y, p.z]} rotation={[r.x * DEG, r.y * DEG, r.z * DEG]}>
            <mesh
              onClick={(e) => {
                if (!editable) return
                e.stopPropagation()
                if (e.shiftKey || e.metaKey || e.ctrlKey) selectFixtures(isSelected ? selected.filter((s) => s !== id) : [...selected, id])
                else selectFixtures([id])
              }}
              onPointerOver={(e) => {
                if (!editable) return
                e.stopPropagation()
                setHover(id)
              }}
              onPointerOut={() => setHover((h) => (h === id ? null : h))}
            >
              <boxGeometry args={size} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {(isSelected || hover === id) && editable && (
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
                <lineBasicMaterial color={isSelected ? '#ffb347' : '#8b91a8'} toneMapped={false} />
              </lineSegments>
            )}
          </group>
        )
      })}
      {picked.length > 0 && (
        <>
          <group
            ref={setHandle}
            position={[centre.x, centre.y, centre.z]}
            rotation={single ? [single.rotation.x * DEG, single.rotation.y * DEG, single.rotation.z * DEG] : [0, 0, 0]}
          />
          {handle && (
            <TransformControls
              object={handle}
              mode={mode}
              space={mode === 'rotate' && single ? 'local' : 'world'}
              size={0.7}
              rotationSnap={5 * DEG}
              translationSnap={0.05}
              onMouseDown={beginDrag}
              onObjectChange={applyDrag}
              onMouseUp={endDrag}
            />
          )}
        </>
      )}
    </>
  )
}

function StageFloor() {
  const { width, depth } = useStore((s) => s.show.stage)
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.001, depth)), [width, depth])
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#0b0c12" roughness={0.9} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1b1d27" roughness={0.55} metalness={0.1} />
      </mesh>
      <lineSegments geometry={outline} position={[0, 0.002, 0]}>
        <lineBasicMaterial color="#3a3f55" />
      </lineSegments>
    </>
  )
}

type CameraName = 'front' | 'top' | 'side'
const CAMERAS: Record<CameraName, { position: [number, number, number]; target: [number, number, number] }> = {
  front: { position: [0, 3.4, 9.5], target: [0, 0.7, 0] },
  top: { position: [0, 11, 0.01], target: [0, 0, 0] },
  side: { position: [10, 2, 1], target: [0, 0.9, 0] }
}

function CameraRig({ preset }: { preset: { name: CameraName; n: number } }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    const c = CAMERAS[preset.name]
    camera.position.set(...c.position)
    if (controls) {
      controls.target.set(...c.target)
      controls.update()
    }
  }, [preset, camera, controls])
  return null
}

export function Stage3D() {
  const patch = usePatch()
  const editable = useStore((s) => s.view === 'stage')
  const selected = useStore((s) => s.selectedFixtures.length)
  const selectFixtures = useStore((s) => s.selectFixtures)
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')
  const [preset, setPreset] = useState<{ name: CameraName; n: number }>({ name: 'front', n: 0 })

  return (
    <div className="stage">
      <Canvas
        camera={{ position: [0, 3.4, 9.5], fov: 38, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        onPointerMissed={() => editable && selectFixtures([])}
      >
        <color attach="background" args={['#06070b']} />
        <fog attach="fog" args={['#06070b', 14, 40]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 8, 6]} intensity={0.35} />
        <StageFloor />
        <Pixels patch={patch} />
        <Spill patch={patch} />
        <FixtureBodies patch={patch} editable={editable} mode={mode} />
        <OrbitControls makeDefault target={[0, 0.7, 0]} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={1.5} maxDistance={40} />
        <CameraRig preset={preset} />
        <EffectComposer>
          <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.6} luminanceSmoothing={0.3} radius={0.75} />
        </EffectComposer>
      </Canvas>

      <div className="stage-tools">
        <div className="segmented" role="group" aria-label="Camera">
          {(Object.keys(CAMERAS) as CameraName[]).map((name) => (
            <button key={name} onClick={() => setPreset({ name, n: preset.n + 1 })}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        {editable && selected > 0 && (
          <div className="segmented" role="group" aria-label="Drag handle">
            <button className={mode === 'translate' ? 'on' : ''} onClick={() => setMode('translate')}>
              Move
            </button>
            <button className={mode === 'rotate' ? 'on' : ''} onClick={() => setMode('rotate')}>
              Rotate
            </button>
          </div>
        )}
      </div>
      {patch.cellCount === 0 && (
        <div className="stage-empty">
          <p>The stage is empty.</p>
          <p className="muted">Add your first fixture in the Stage tab to see it here.</p>
        </div>
      )}
    </div>
  )
}
