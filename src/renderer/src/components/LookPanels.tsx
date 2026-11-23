import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { Fragment, useMemo, useRef } from 'react'
import { customId, resolveEffect } from '@shared/custom'
import { defaultParams, EFFECT_BY_ID } from '@shared/effects'
import { LOOK_COLORS, newId, newLayer, newLook } from '@shared/show'
import type { Blend, Layer, Look, Mapping, Show, Triggerable } from '@shared/types'
import { autoPlane, resolveTargets } from '@shared/patch'
import { imageUrl, loadImageFile } from '../images'
import { editLayer, editLook, useStore } from '../store'
import { EffectPicker } from './EffectPicker'
import { folderIn, ItemList } from './ItemList'
import { lookReplay, useReplay } from './replay'
import { SaveBar } from './SaveBar'
import { usePatch } from './Stage3D'
import { BeatLength, ColorInput, Field, noteName, NumberInput, Section, Segmented, Select, Slider, TextInput, Toggle } from './ui'

const MAPPINGS: { value: Mapping; label: string }[] = [
  { value: 'fixture', label: 'Along each fixture' },
  { value: 'span', label: 'Through all fixtures, end to end' },
  { value: 'index', label: 'Fixture by fixture' },
  { value: 'stageX', label: 'Across the stage, left to right' },
  { value: 'stageY', label: 'From the floor up' },
  { value: 'stageZ', label: 'From back to front' }
]

/** What each direction becomes when it is turned around. */
const REVERSED: Record<Mapping, string> = {
  fixture: 'from the end of each fixture',
  span: 'from the last fixture back to the first',
  index: 'last fixture first',
  stageX: 'right to left',
  stageY: 'from the top down',
  stageZ: 'from front to back'
}

const BLENDS: { value: Blend; label: string }[] = [
  { value: 'normal', label: 'Cover what is below' },
  { value: 'add', label: 'Add light' },
  { value: 'max', label: 'Brightest wins' },
  { value: 'multiply', label: 'Mask what is below' }
]

export const midiLabel = (look: Triggerable): string => (look.midi ? `${noteName(look.midi.note)} (${look.midi.note})` : '')

export function LookList() {
  const looks = useStore((s) => s.show.looks)
  const folders = useStore((s) => s.show.lookFolders)
  const lookId = useStore((s) => s.lookId)
  const closed = useStore((s) => s.closedFolders)
  const selectLook = useStore((s) => s.selectLook)
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)
  const active = useStore((s) => s.status?.active)

  const add = () => {
    // A new look lands next to the one being worked on.
    const current = looks.find((l) => l.id === lookId)
    const folder = current ? folderIn(folders, current) : ''
    const look: Look = { ...newLook(`Scene ${looks.length + 1}`, looks.length), ...(folder ? { folder } : {}) }
    editNow((s) => ({ ...s, looks: [...s.looks, look] }))
    set({ closedFolders: closed.filter((id) => id !== folder) })
    selectLook(look.id)
  }

  return (
    <aside className="panel left">
      <ItemList
        kind="looks"
        folderList="lookFolders"
        title="Scenes"
        noun="scene"
        items={looks}
        selected={lookId ? [lookId] : []}
        onSelect={(id) => selectLook(id)}
        matches={(l, query) => midiLabel(l).toLowerCase().includes(query)}
        lead={(l) => <span className="look-chip" style={{ background: l.color, opacity: 0.35 + 0.65 * Math.min(1, (active?.find((a) => a.lookId === l.id)?.level ?? 0) * 2) }} />}
        meta={midiLabel}
        empty="A scene is what your lights do on one MIDI note: colours and effects on some or all fixtures."
        action={
          <button className="button small primary" onClick={add}>
            <Plus size={14} /> New scene
          </button>
        }
      />
    </aside>
  )
}

function TargetPicker({ layer, lookId }: { layer: Layer; lookId: string }) {
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)
  const toggle = (id: string) =>
    editLayer(lookId, layer.id, { targets: layer.targets.includes(id) ? layer.targets.filter((t) => t !== id) : [...layer.targets, id] })
  return (
    <div className="chips">
      <button className={`chip${layer.targets.length === 0 ? ' on' : ''}`} onClick={() => editLayer(lookId, layer.id, { targets: [] })}>
        All fixtures
      </button>
      {groups.map((g) => (
        <button key={g.id} className={`chip group${layer.targets.includes(g.id) ? ' on' : ''}`} onClick={() => toggle(g.id)}>
          {g.name}
        </button>
      ))}
      {fixtures.map((f) => (
        <button key={f.id} className={`chip${layer.targets.includes(f.id) ? ' on' : ''}`} onClick={() => toggle(f.id)}>
          {f.name}
        </button>
      ))}
    </div>
  )
}

/** Picture and placement of an image layer. */
function ImageSource({ look, layer }: { look: Look; layer: Layer }) {
  const id = String(layer.params.image ?? '')
  const asset = useStore((s) => s.show.images[id])
  const groups = useStore((s) => s.show.groups)
  const edit = useStore((s) => s.edit)
  const set = useStore((s) => s.set)
  const patch = usePatch()
  const input = useRef<HTMLInputElement>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    try {
      const image = await loadImageFile(file)
      const key = newId()
      // The picture goes into the show right away (unused ones are left out of the file); the layer is part of the draft.
      edit((s) => ({ ...s, images: { ...s.images, [key]: image } }))
      editLayer(look.id, layer.id, { params: { ...layer.params, image: key } })
    } catch {
      set({ notice: { kind: 'error', text: `${file.name} could not be read as a picture. Use a PNG, JPEG, WebP or GIF file.` } })
    }
  }

  return (
    <>
      <div className="image-source">
        <button className={`image-thumb${asset ? '' : ' none'}`} title="Choose a picture" onClick={() => input.current?.click()}>
          {asset ? <img src={imageUrl(id, asset)} alt="" /> : <ImagePlus size={20} />}
        </button>
        <div className="image-meta">
          <strong>{asset ? asset.name : 'No picture yet'}</strong>
          <span className="muted">{asset ? `${asset.width} × ${asset.height} pixels in the show` : 'Dark until you choose one'}</span>
          <button className="button small ghost" onClick={() => input.current?.click()}>
            {asset ? 'Replace picture…' : 'Choose picture…'}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          hidden
          onChange={(e) => {
            void choose(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div className="form-grid">
        <Field label="Placed" wide>
          <Segmented
            value={layer.plane ? 'free' : 'auto'}
            onChange={(v) => editLayer(look.id, layer.id, { plane: v === 'free' ? autoPlane({ groups }, patch, layer.targets) : undefined })}
            options={[
              { value: 'auto', label: 'Over the fixtures' },
              { value: 'free', label: 'Freely on stage' }
            ]}
          />
        </Field>
        <p className="form-note">
          {layer.plane
            ? 'Drag the frame on the stage: Move, Rotate and Size are at the top left. Each pixel takes the colour of the spot straight in front of or behind it.'
            : 'The picture is stretched over the fixtures of this layer, as seen from the front. The frame on the stage shows where it lies.'}
        </p>
      </div>
    </>
  )
}

function LayerEditor({ look, layer }: { look: Look; layer: Layer }) {
  const custom = useStore((s) => s.show.effects)
  const set = useStore((s) => s.set)
  const def = useMemo(() => resolveEffect(custom, layer.effect), [custom, layer.effect])
  const ownId = customId(layer.effect)
  const patch = usePatch()
  const groups = useStore((s) => s.show.groups)
  const fixtureCount = useMemo(() => resolveTargets({ groups } as Show, patch, layer.targets).length, [groups, patch, layer.targets])
  const setParam = (key: string, value: number | string | boolean) =>
    editLayer(look.id, layer.id, { params: { ...layer.params, [key]: value } }, `param-${layer.id}-${key}`)

  const changeEffect = (effect: string) => {
    const next = defaultParams(effect)
    // Keep the colours the user already chose where the new effect has the same parameter.
    for (const key of Object.keys(next)) if (typeof next[key] === 'string' && typeof layer.params[key] === 'string' && key !== 'edge') next[key] = layer.params[key]
    if (typeof layer.params.image === 'string') next.image = layer.params.image
    editLayer(look.id, layer.id, { effect, params: next })
  }

  return (
    <>
      <Section title="Effect">
        <EffectPicker value={layer.effect} onChange={changeEffect} />
        {ownId !== null && (
          <p className="summary">
            {def ? 'One of your own effects. ' : 'This effect no longer exists, so the layer stays dark. '}
            <button className="link-button" onClick={() => set({ view: 'effects', ...(def ? { effectId: ownId } : {}) })}>
              {def ? 'Edit its curves' : 'Open the Effects tab'}
            </button>
          </p>
        )}
        {layer.effect === 'image' && <ImageSource look={look} layer={layer} />}
        <div className="params">
          {def?.params.map((p) => {
            const v = layer.params[p.key] ?? p.default
            return (
              <Fragment key={p.key}>
                {p.section && <h4 className="params-title">{p.section}</h4>}
                {p.type === 'toggle' ? (
                  <Toggle value={Boolean(v)} onChange={(b) => setParam(p.key, b)} label={p.label} />
                ) : (
                  <Field label={p.label} wide>
                    {p.type === 'color' ? (
                      <>
                        <ColorInput value={String(v)} onChange={(c) => setParam(p.key, c)} />
                        {ownId !== null && typeof layer.params[p.key] === 'string' && (
                          <button
                            className="link-button reset-colour"
                            title="This layer has its own colour. Go back to the colour of the effect, and follow it when it changes."
                            onClick={() => {
                              const { [p.key]: _, ...rest } = layer.params
                              editLayer(look.id, layer.id, { params: rest })
                            }}
                          >
                            Use the colour of the effect
                          </button>
                        )}
                      </>
                    ) : p.type === 'select' ? (
                      <Select value={String(v)} onChange={(o) => setParam(p.key, o)} options={p.options} />
                    ) : (
                      <Slider value={Number(v)} min={p.min} max={p.max} step={p.step} unit={p.unit} onChange={(n) => setParam(p.key, n)} />
                    )}
                  </Field>
                )}
              </Fragment>
            )
          })}
        </div>
      </Section>

      <Section title="Where">
        <TargetPicker layer={layer} lookId={look.id} />
        <div className="form-grid">
          {fixtureCount > 1 && (
            <Field label="Plays on" wide>
              <Segmented
                value={layer.pick ? 'random' : 'all'}
                onChange={(v) => editLayer(look.id, layer.id, { pick: v === 'random' ? { count: 1, beats: 1 } : undefined })}
                options={[
                  { value: 'all', label: `All ${fixtureCount} fixtures` },
                  { value: 'random', label: 'Random ones' }
                ]}
              />
            </Field>
          )}
          {fixtureCount > 1 && layer.pick && (
            <>
              <Field label="How many at once">
                <NumberInput
                  value={Math.min(layer.pick.count, fixtureCount - 1)}
                  min={1}
                  max={fixtureCount - 1}
                  onChange={(count) => editLayer(look.id, layer.id, { pick: { ...layer.pick!, count: Math.round(count) } }, `pick-count-${layer.id}`)}
                />
              </Field>
              <Field label="Draws again every">
                <BeatLength value={layer.pick.beats} min={1 / 8} onChange={(beats) => editLayer(look.id, layer.id, { pick: { ...layer.pick!, beats } }, `pick-beats-${layer.id}`)} />
              </Field>
              <p className="form-note">
                Like a shuffled deck: every fixture gets its turn before one comes up again, never the same one twice in a row. Counted in beats from the moment the scene starts. The other
                fixtures keep what the layers below show.
              </p>
            </>
          )}
          {layer.effect !== 'image' && (
            <Field label="Direction" wide>
              <Select value={layer.mapping} onChange={(mapping) => editLayer(look.id, layer.id, { mapping })} options={MAPPINGS} />
            </Field>
          )}
          {layer.effect !== 'image' && (
            <Toggle
              value={!!layer.reverse}
              onChange={(reverse) => editLayer(look.id, layer.id, { reverse: reverse || undefined })}
              label={`The other way round: ${REVERSED[layer.mapping]}`}
            />
          )}
          <Field label="Mixing" wide>
            <Select value={layer.blend} onChange={(blend) => editLayer(look.id, layer.id, { blend })} options={BLENDS} />
          </Field>
          <Field label="Opacity" wide>
            <Slider value={layer.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => editLayer(look.id, layer.id, { opacity }, `opacity-${layer.id}`)} />
          </Field>
        </div>
      </Section>
    </>
  )
}

/** How a look or a chaser is started. `onEdit` receives the changed fields. */
export function TriggerEditor({ item, onEdit }: { item: Triggerable; onEdit: (patch: Partial<Triggerable>, key?: string) => void }) {
  const learning = useStore((s) => s.learning)
  const set = useStore((s) => s.set)
  const looks = useStore((s) => s.show.looks)
  const chasers = useStore((s) => s.show.chasers)
  const m = item.midi
  const others = m
    ? [...looks, ...chasers].filter((l) => l.id !== item.id && l.midi && l.midi.note === m.note && (l.midi.channel === 0 || m.channel === 0 || l.midi.channel === m.channel))
    : []
  const change = (patch: Partial<Triggerable>, key?: string) => onEdit(patch, key && `${key}-${item.id}`)

  return (
    <Section title="Trigger">
      <div className="trigger">
        {learning ? (
          <div className="learn-wait">
            <span className="lamp lit pulse" />
            Play the note in Reaper or on a keyboard…
            <button className="button small ghost" onClick={() => set({ learning: false })}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className={`note-badge${item.midi ? '' : ' none'}`}>{item.midi ? noteName(item.midi.note) : 'No note'}</div>
            <button className="button small primary" onClick={() => set({ learning: true })}>
              Learn from MIDI
            </button>
            {item.midi && (
              <button className="button small ghost" onClick={() => change({ midi: null })}>
                Clear
              </button>
            )}
          </>
        )}
      </div>
      {!learning && (
        <div className="form-grid">
          {/* Also without a note yet: typing a number sets it, no MIDI needed. */}
          <Field label="Note number">
            <NumberInput
              value={item.midi?.note ?? NaN}
              min={0}
              max={127}
              placeholder="0 to 127"
              onChange={(note) => change({ midi: { channel: item.midi?.channel ?? 0, note: Math.round(note) } }, 'note')}
            />
          </Field>
          <Field label="Channel">
            <Select
              value={String(item.midi?.channel ?? 0)}
              onChange={(c) => item.midi && change({ midi: { ...item.midi, channel: Number(c) } })}
              options={[{ value: '0', label: 'Any' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
            />
          </Field>
        </div>
      )}
      {others.length > 0 && <p className="summary">Also triggers {others.map((l) => l.name).join(', ')}.</p>}
      <div className="form-grid">
        <Field label="Plays" wide>
          <Segmented
            value={item.triggerMode}
            onChange={(triggerMode) => change({ triggerMode })}
            options={[
              { value: 'hold', label: 'While the note is held' },
              { value: 'toggle', label: 'Note switches on / off' }
            ]}
          />
        </Field>
        <Toggle value={item.velocity} onChange={(velocity) => change({ velocity })} label="Velocity sets brightness" />
        <Toggle value={item.solo} onChange={(solo) => change({ solo })} label="Stops everything else that is playing" />
        <Field label="Fade in" wide>
          <Slider value={item.fadeIn} min={0} max={5000} step={50} format={(v) => (v === 0 ? 'Instant' : `${(v / 1000).toFixed(2)} s`)} onChange={(fadeIn) => change({ fadeIn }, 'fadeIn')} />
        </Field>
        <Field label="Fade out" wide>
          <Slider value={item.fadeOut} min={0} max={5000} step={50} format={(v) => (v === 0 ? 'Instant' : `${(v / 1000).toFixed(2)} s`)} onChange={(fadeOut) => change({ fadeOut }, 'fadeOut')} />
        </Field>
      </div>
    </Section>
  )
}

export function LookEditor() {
  const look = useStore((s) => s.show.looks.find((l) => l.id === s.lookId))
  const layerId = useStore((s) => s.layerId)
  const preview = useStore((s) => s.preview)
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)
  const selectLook = useStore((s) => s.selectLook)
  const selectLayer = useStore((s) => s.selectLayer)
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)
  const folders = useStore((s) => s.show.lookFolders)
  const custom = useStore((s) => s.show.effects)
  const effectName = (effect: string) => EFFECT_BY_ID.get(effect)?.name ?? custom.find((e) => e.id === customId(effect))?.name ?? 'Missing effect'
  const inFolder = (l: Look) => folderIn(folders, l)
  useReplay(useStore((s) => lookReplay(s, look)))

  if (!look) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select a scene on the left, or create a new one.</p>
      </aside>
    )
  }

  const layer = look.layers.find((l) => l.id === layerId) ?? look.layers.at(-1)
  const setLayers = (layers: Layer[]) => editLook(look.id, { layers })
  const move = (dir: -1 | 1) =>
    editNow((s) => {
      // Swap places with the neighbour in the same folder: that is the one next to it in the list.
      const i = s.looks.findIndex((l) => l.id === look.id)
      let j = i + dir
      while (s.looks[j] && inFolder(s.looks[j]) !== inFolder(s.looks[i])) j += dir
      if (i < 0 || j < 0 || j >= s.looks.length) return s
      const looks = [...s.looks]
      ;[looks[i], looks[j]] = [looks[j], looks[i]]
      return { ...s, looks }
    })

  const targetSummary = (y: Layer): string => {
    if (y.targets.length === 0) return 'All fixtures'
    const names = y.targets.map((t) => groups.find((g) => g.id === t)?.name ?? fixtures.find((f) => f.id === t)?.name).filter(Boolean)
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
  }

  return (
    <aside className="panel right wide">
      <Section
        title="Scene"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Shown on stage while you edit. Click to hide.' : 'Show on stage while editing'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon" title="Move up in the list (drawn below later scenes)" onClick={() => move(-1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" title="Move down in the list (drawn on top)" onClick={() => move(1)}>
              <ArrowDown size={15} />
            </button>
            <button
              className="icon"
              title="Duplicate scene"
              onClick={() => {
                const copy: Look = { ...look, id: newId(), name: `${look.name} copy`, midi: null, layers: look.layers.map((y) => ({ ...y, id: newId() })) }
                editNow((s) => ({ ...s, looks: [...s.looks, copy] }))
                selectLook(copy.id)
              }}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon"
              title="Delete scene"
              onClick={() => {
                editNow((s) => ({
                  ...s,
                  looks: s.looks.filter((l) => l.id !== look.id),
                  // Nodes that showed this look stay in place as dark ones, so chasers keep their timing.
                  chasers: s.chasers.map((c) => (c.nodes.some((n) => n.lookId === look.id) ? { ...c, nodes: c.nodes.map((n) => (n.lookId === look.id ? { ...n, lookId: '' } : n)) } : c))
                }))
                selectLook(null)
              }}
            >
              <Trash2 size={15} />
            </button>
          </span>
        }
      >
        <div className="form-grid">
          <Field label="Name" wide>
            <TextInput value={look.name} onChange={(name) => editLook(look.id, { name })} />
          </Field>
          {folders.length > 0 && (
            <Field label="Folder" wide>
              <Select
                value={inFolder(look)}
                onChange={(folder) => editLook(look.id, { folder: folder || undefined })}
                options={[{ value: '', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
              />
            </Field>
          )}
          <div className="look-colors wide">
            {LOOK_COLORS.map((c) => (
              <button key={c} className={c === look.color ? 'on' : ''} style={{ background: c }} title="Label colour" onClick={() => editLook(look.id, { color: c })} />
            ))}
          </div>
        </div>
      </Section>

      <TriggerEditor item={look} onEdit={(patch, key) => editLook(look.id, patch, key)} />

      <Section
        title="Layers"
        action={
          <button
            className="button small ghost"
            onClick={() => {
              const y = newLayer('solid')
              setLayers([...look.layers, y])
              selectLayer(y.id)
            }}
          >
            <Plus size={14} /> Add layer
          </button>
        }
      >
        {look.layers.length === 0 && <p className="empty">This scene is empty. Add a layer to put an effect on your fixtures.</p>}
        <ul className="list layers">
          {/* Shown top-most first, like layers in a drawing app. */}
          {[...look.layers].reverse().map((y) => {
            const index = look.layers.indexOf(y)
            const swap = (j: number) => {
              const layers = [...look.layers]
              ;[layers[index], layers[j]] = [layers[j], layers[index]]
              setLayers(layers)
            }
            return (
              <li key={y.id} className={`row layer-row${y.id === layer?.id ? ' on' : ''}`} onClick={() => selectLayer(y.id)}>
                <span className="row-name">{effectName(y.effect)}</span>
                <span className="row-meta">{targetSummary(y)}</span>
                <button className="icon subtle" title="Move up" disabled={index === look.layers.length - 1} onClick={(e) => (e.stopPropagation(), swap(index + 1))}>
                  <ArrowUp size={13} />
                </button>
                <button className="icon subtle" title="Move down" disabled={index === 0} onClick={(e) => (e.stopPropagation(), swap(index - 1))}>
                  <ArrowDown size={13} />
                </button>
                <button className="icon subtle" title="Delete layer" onClick={(e) => (e.stopPropagation(), setLayers(look.layers.filter((x) => x.id !== y.id)))}>
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      {layer && <LayerEditor look={look} layer={layer} />}

      <SaveBar items={[{ kind: 'looks', ids: [look.id] }]} noun="scene" />
    </aside>
  )
}
