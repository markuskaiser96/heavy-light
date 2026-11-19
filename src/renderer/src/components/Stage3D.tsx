import { OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { autoPlane, compilePatch, type Patch, type PatchedFixture } from '@shared/patch'
import type { Plane, Vec3 } from '@shared/types'
import { imageCanvas } from '../images'
import { deleteSelection, duplicateSelection, moveSelection, place, roundPosition, toQuaternion, toRotation, turnSelection, type Placed } from '../placement'
import { editLayer, frame, useStore } from '../store'
import { StageProps } from './StageProps'

const DEG = Math.PI / 180
const MAX_LIGHTS = 16
const ALT = navigator.platform.startsWith('Mac') ? '⌥' : 'Alt'
/** sRGB byte → linear light, so the glow on screen fades like the real LEDs. */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => Math.pow(i / 255, 2.2))

export function usePatch(): Patch {
  const fixtures = useStore((s) => s.show.fixtures)
  const definitions = useStore((s) => s.show.definitions)
  return useMemo(() => compilePatch({ fixtures, definitions }), [fixtures, definitions])
}

/**
 * The engine sends colours in the order of the saved fixtures, while the stage shows them where the
 * editor has them. For every cell on screen: where its colour is in the frame, or -1 if the fixture
 * has no light there yet (its type or mode changed and is not saved).
 */
function useFrameCells(patch: Patch): Int32Array {
  const fixtures = useStore((s) => s.saved.fixtures)
  const definitions = useStore((s) => s.saved.definitions)
  return useMemo(() => {
    const saved = compilePatch({ fixtures, definitions })
    const cells = new Int32Array(patch.cellCount).fill(-1)
    for (const pf of patch.fixtures) {
      const from = saved.byId.get(pf.fixture.id)
      if (from?.cellCount === pf.cellCount) for (let i = 0; i < pf.cellCount; i++) cells[pf.cellStart + i] = from.cellStart + i
    }
    return cells
  }, [patch, fixtures, definitions])
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
  const cells = useFrameCells(patch)
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
    // Values above 1 feed the bloom pass; a dark pixel keeps a faint tint so the fixture stays visible.
    for (let c = 0; c < patch.cellCount; c++) {
      const from = cells[c] * 3
      const lit = from >= 0 && from + 2 < px.length
      for (let k = 0; k < 3; k++) out[c * 3 + k] = lit ? 0.03 + LINEAR[px[from + k]] * 3 : 0.03
    }
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
  const cells = useFrameCells(patch)
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
      for (let c = pf.cellStart; c < pf.cellStart + pf.cellCount; c++) {
        const i = cells[c] * 3
        if (i < 0 || i + 2 >= px.length) continue
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

/** Invisible boxes around the fixtures to click on, with an outline when hovered or selected. */
function FixtureBodies({ patch, editable }: { patch: Patch; editable: boolean }) {
  const selected = useStore((s) => s.selectedFixtures)
  const [hover, setHover] = useState<string | null>(null)

  return (
    <>
      {patch.fixtures.map((pf) => {
        const { id, position: p, rotation: r } = pf.fixture
        const isSelected = selected.includes(id)
        const size = bodySize(pf)
        return (
          <group key={id} position={[p.x, p.y, p.z]} rotation={[r.x * DEG, r.y * DEG, r.z * DEG]}>
            <mesh
              userData={{ fixture: true }}
              onClick={(e) => {
                if (!editable) return
                e.stopPropagation()
                const s = useStore.getState()
                if (e.shiftKey || e.metaKey || e.ctrlKey) s.set({ selectedFixtures: isSelected ? selected.filter((x) => x !== id) : [...selected, id] })
                else s.selectFixtures([id])
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
    </>
  )
}

/** Move and rotate handles for everything selected in the Stage tab: fixtures and stage objects together. */
function SelectionHandle({ mode }: { mode: 'translate' | 'rotate' }) {
  const fixtures = useStore((s) => s.show.fixtures)
  const props = useStore((s) => s.show.props)
  const selectedFixtures = useStore((s) => s.selectedFixtures)
  const selectedProps = useStore((s) => s.selectedProps)
  const [handle, setHandle] = useState<THREE.Group | null>(null)
  const picked: Placed[] = [...fixtures.filter((f) => selectedFixtures.includes(f.id)), ...props.filter((p) => selectedProps.includes(p.id))]
  const single = picked.length === 1 ? picked[0] : null
  // The handle sits in the middle of the selection. With one thing selected it also takes on its rotation.
  const centre = picked.reduce((sum, i) => sum.add(new THREE.Vector3(i.position.x, i.position.y, i.position.z)), new THREE.Vector3()).divideScalar(Math.max(1, picked.length))
  /** Where the handle and the selected things were when the drag began. */
  const drag = useRef<{ position: THREE.Vector3; rotation: THREE.Quaternion; items: Map<string, { position: Vec3; rotation: THREE.Quaternion }> } | null>(null)

  const beginDrag = () => {
    if (!handle) return
    drag.current = {
      position: handle.position.clone(),
      rotation: handle.quaternion.clone(),
      items: new Map(picked.map((i) => [i.id, { position: i.position, rotation: toQuaternion(i.rotation) }]))
    }
  }

  const applyDrag = () => {
    const start = drag.current
    if (!handle || !start) return
    const moved = handle.position.clone().sub(start.position)
    const turned = handle.quaternion.clone().multiply(start.rotation.clone().invert())
    const offset = new THREE.Vector3()
    useStore.getState().edit(
      (show) =>
        place(show, (item) => {
          const from = start.items.get(item.id)
          if (!from) return undefined
          if (mode === 'translate') return { position: roundPosition(from.position.x + moved.x, from.position.y + moved.y, from.position.z + moved.z), rotation: item.rotation }
          // Several things turn together about the handle, like one rigid piece.
          offset.set(from.position.x, from.position.y, from.position.z).sub(start.position).applyQuaternion(turned).add(start.position)
          return { position: roundPosition(offset.x, offset.y, offset.z), rotation: toRotation(turned.clone().multiply(from.rotation)) }
        }),
      `drag-${mode}-${[...start.items.keys()].join()}`
    )
  }

  const endDrag = () => {
    drag.current = null
    // For several things the handle only measures the turn; start the next drag from zero.
    if (!single) handle?.quaternion.identity()
  }

  if (picked.length === 0) return null
  return (
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
  )
}

/**
 * Keyboard control of the selection in the Stage tab. Arrow keys follow the screen: left and right
 * move across the view, up and down move away from and towards the camera, always along a stage axis.
 */
function StageKeys({ onMode }: { onMode: (mode: 'translate' | 'rotate') => void }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
      const s = useStore.getState()
      if (s.view !== 'stage' || s.selectedFixtures.length + s.selectedProps.length === 0) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const mod = e.metaKey || e.ctrlKey
      const step = e.shiftKey ? 0.5 : 0.05
      let handled = true

      if (mod && key === 'd') duplicateSelection()
      else if (mod) handled = false
      else if (key === 'Delete' || key === 'Backspace') deleteSelection()
      else if (key === 'Escape') s.set({ selectedFixtures: [], selectedProps: [] })
      else if (key === 'PageUp' || (e.altKey && key === 'ArrowUp')) moveSelection({ x: 0, y: step, z: 0 })
      else if (key === 'PageDown' || (e.altKey && key === 'ArrowDown')) moveSelection({ x: 0, y: -step, z: 0 })
      else if (key.startsWith('Arrow') && !e.altKey) {
        // Which stage axis points away from the camera? From straight above, the top of the screen counts.
        const away = camera.getWorldDirection(new THREE.Vector3())
        if (Math.hypot(away.x, away.z) < 0.05) away.set(0, 1, 0).applyQuaternion(camera.quaternion)
        const forward = Math.abs(away.x) > Math.abs(away.z) ? { x: Math.sign(away.x), z: 0 } : { x: 0, z: Math.sign(away.z) }
        const right = { x: -forward.z, z: forward.x }
        const along = key === 'ArrowUp' ? forward : key === 'ArrowDown' ? { x: -forward.x, z: -forward.z } : key === 'ArrowRight' ? right : { x: -right.x, z: -right.z }
        moveSelection({ x: along.x * step, y: 0, z: along.z * step })
      } else if (e.altKey) handled = false
      else if (key === 'q') turnSelection(e.shiftKey ? 90 : 15)
      else if (key === 'e') turnSelection(e.shiftKey ? -90 : -15)
      else if (key === 'g') onMode('translate')
      else if (key === 'r') onMode('rotate')
      else handled = false

      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, onMode])
  return null
}

/** The image layer being edited in the Looks tab, if any. */
function useImageLayer() {
  const active = useStore((s) => s.view === 'looks' && s.preview)
  const look = useStore((s) => s.show.looks.find((l) => l.id === s.lookId))
  const layerId = useStore((s) => s.layerId)
  const layer = look?.layers.find((y) => y.id === layerId) ?? look?.layers.at(-1)
  return active && look && layer?.effect === 'image' ? { look, layer } : null
}

/**
 * Shows where the picture of an image layer lies on stage, as a faint frame. A frame the user
 * placed freely can be dragged, turned and resized.
 */
function ImageFrame({ patch, mode }: { patch: Patch; mode: 'translate' | 'rotate' | 'scale' }) {
  const editing = useImageLayer()
  const groups = useStore((s) => s.show.groups)
  const id = String(editing?.layer.params.image ?? '')
  const asset = useStore((s) => s.show.images[id])
  const [handle, setHandle] = useState<THREE.Group | null>(null)
  const drag = useRef<Plane | null>(null)

  const texture = useMemo(() => {
    if (!asset) return null
    const t = new THREE.CanvasTexture(imageCanvas(id, asset))
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.NearestFilter
    return t
  }, [id, asset])
  useEffect(() => () => texture?.dispose(), [texture])

  if (!editing) return null
  const { look, layer } = editing
  const plane = layer.plane ?? autoPlane({ groups }, patch, layer.targets)
  const position: [number, number, number] = [plane.position.x, plane.position.y, plane.position.z]
  const rotation: [number, number, number] = [plane.rotation.x * DEG, plane.rotation.y * DEG, plane.rotation.z * DEG]

  const applyDrag = () => {
    const start = drag.current
    if (!handle || !start) return
    const round = (v: number, digits: number) => +v.toFixed(digits) || 0
    editLayer(
      look.id,
      layer.id,
      {
        plane: {
          position: { x: round(handle.position.x, 3), y: round(handle.position.y, 3), z: round(handle.position.z, 3) },
          rotation: { x: round(handle.rotation.x / DEG, 1), y: round(handle.rotation.y / DEG, 1), z: round(handle.rotation.z / DEG, 1) },
          width: round(Math.max(0.05, start.width * Math.abs(handle.scale.x)), 3),
          height: round(Math.max(0.05, start.height * Math.abs(handle.scale.y)), 3)
        }
      },
      `frame-${layer.id}-${mode}`
    )
  }

  return (
    <>
      <group position={position} rotation={rotation}>
        <mesh>
          <planeGeometry args={[plane.width, plane.height]} />
          <meshBasicMaterial map={texture} transparent opacity={texture ? 0.22 : 0.06} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(plane.width, plane.height)]} />
          <lineBasicMaterial color={layer.plane ? '#ffb347' : '#5f657b'} toneMapped={false} />
        </lineSegments>
      </group>
      {layer.plane && (
        <>
          <group ref={setHandle} position={position} rotation={rotation} />
          {handle && (
            <TransformControls
              object={handle}
              mode={mode}
              space="local"
              size={0.7}
              rotationSnap={5 * DEG}
              translationSnap={0.05}
              onMouseDown={() => (drag.current = plane)}
              onObjectChange={applyDrag}
              onMouseUp={() => {
                drag.current = null
                // The size handles only measure the stretch; the frame itself carries the new size.
                handle.scale.set(1, 1, 1)
              }}
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
      <FrontMark width={width} depth={depth} />
    </>
  )
}

/** Marks the downstage edge: a lit strip along it and "Audience" written on the floor in front. */
function FrontMark({ width, depth }: { width: number; depth: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#8f95ab'
    ctx.font = '600 56px system-ui, sans-serif'
    ctx.letterSpacing = '18px'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('AUDIENCE', 512 + 9, 64)
    // Arrowheads pointing away from the stage, left and right of the word.
    for (const x of [200, 824]) {
      ctx.beginPath()
      ctx.moveTo(x - 26, 44)
      ctx.lineTo(x + 26, 44)
      ctx.lineTo(x, 86)
      ctx.fill()
    }
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  const length = Math.min(width, 4)
  return (
    <>
      <mesh position={[0, 0.003, depth / 2 - 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, 0.04]} />
        <meshBasicMaterial color="#9c6a26" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.001, depth / 2 + 0.2 + length / 16]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[length, length / 8]} />
        <meshBasicMaterial map={texture} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
      </mesh>
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
  const selected = useStore((s) => s.selectedFixtures.length + s.selectedProps.length)
  const set = useStore((s) => s.set)
  const props = useStore((s) => s.show.props.length)
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate')
  const frameEditing = useImageLayer()?.layer.plane !== undefined
  const [preset, setPreset] = useState<{ name: CameraName; n: number }>({ name: 'front', n: 0 })

  return (
    <div className="stage">
      <Canvas
        camera={{ position: [0, 3.4, 9.5], fov: 38, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        onPointerMissed={() => editable && set({ selectedFixtures: [], selectedProps: [] })}
      >
        <color attach="background" args={['#06070b']} />
        <fog attach="fog" args={['#06070b', 14, 40]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 8, 6]} intensity={0.35} />
        <StageFloor />
        <Pixels patch={patch} />
        <Spill patch={patch} />
        <StageProps editable={editable} />
        <FixtureBodies patch={patch} editable={editable} />
        {editable && <SelectionHandle mode={mode === 'scale' ? 'translate' : mode} />}
        <StageKeys onMode={setMode} />
        <ImageFrame patch={patch} mode={mode} />
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
        {((editable && selected > 0) || frameEditing) && (
          <div className="segmented" role="group" aria-label="Drag handle">
            <button className={mode === 'translate' || (mode === 'scale' && !frameEditing) ? 'on' : ''} title={editable ? 'Move handles (G)' : undefined} onClick={() => setMode('translate')}>
              Move
            </button>
            <button className={mode === 'rotate' ? 'on' : ''} title={editable ? 'Rotate handles (R)' : undefined} onClick={() => setMode('rotate')}>
              Rotate
            </button>
            {frameEditing && (
              <button className={mode === 'scale' ? 'on' : ''} onClick={() => setMode('scale')}>
                Size
              </button>
            )}
          </div>
        )}
      </div>
      {editable && selected > 0 && (
        <div className="stage-keys">
          <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move on the floor</span>
          <span><kbd>{ALT}</kbd><kbd>↑</kbd><kbd>↓</kbd> height</span>
          <span><kbd>Q</kbd><kbd>E</kbd> turn</span>
          <span><kbd>Shift</kbd> big steps</span>
          <span><kbd>G</kbd><kbd>R</kbd> move / rotate handles</span>
        </div>
      )}
      {patch.cellCount === 0 && props === 0 && (
        <div className="stage-empty">
          <p>The stage is empty.</p>
          <p className="muted">Add your first fixture in the Stage tab to see it here.</p>
        </div>
      )}
    </div>
  )
}
