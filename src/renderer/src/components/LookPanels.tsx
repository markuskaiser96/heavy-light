import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Folder, FolderOpen, FolderPlus, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { defaultParams, EFFECT_BY_ID, EFFECTS } from '@shared/effects'
import { LOOK_COLORS, newId, newLayer, newLook } from '@shared/show'
import type { Blend, Layer, Look, Mapping, Triggerable } from '@shared/types'
import { autoPlane } from '@shared/patch'
import { imageUrl, loadImageFile } from '../images'
import { editLayer, editLook, useStore } from '../store'
import { usePatch } from './Stage3D'
import { ColorInput, Field, noteName, NumberInput, Section, Segmented, Select, Slider, TextInput, Toggle } from './ui'

const MAPPINGS: { value: Mapping; label: string }[] = [
  { value: 'fixture', label: 'Along each fixture' },
  { value: 'span', label: 'Through all fixtures, end to end' },
  { value: 'index', label: 'Fixture by fixture' },
  { value: 'stageX', label: 'Across the stage, left to right' },
  { value: 'stageY', label: 'From the floor up' },
  { value: 'stageZ', label: 'From back to front' }
]

const BLENDS: { value: Blend; label: string }[] = [
  { value: 'normal', label: 'Cover what is below' },
  { value: 'add', label: 'Add light' },
  { value: 'max', label: 'Brightest wins' },
  { value: 'multiply', label: 'Mask what is below' }
]

export const midiLabel = (look: Triggerable): string => (look.midi ? `${noteName(look.midi.note)} (${look.midi.note})` : '')

const DRAG_TYPE = 'application/x-heavylight-look'

/** Does the look fit what was typed? Name, note name ("C2") and note number all count. */
const lookMatches = (look: Look, query: string): boolean =>
  look.name.toLowerCase().includes(query) || midiLabel(look).toLowerCase().includes(query)

export function LookList() {
  const looks = useStore((s) => s.show.looks)
  const folders = useStore((s) => s.show.lookFolders)
  const lookId = useStore((s) => s.lookId)
  const closed = useStore((s) => s.closedFolders)
  const selectLook = useStore((s) => s.selectLook)
  const set = useStore((s) => s.set)
  const edit = useStore((s) => s.edit)
  const active = useStore((s) => s.status?.active)
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  /** Folder a dragged look hovers over ('' = the looks outside folders). */
  const [dropOn, setDropOn] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const query = search.trim().toLowerCase()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const folderOf = (l: Look) => (folders.some((f) => f.id === l.folder) ? l.folder! : '')
  const add = () => {
    // A new look lands next to the one being worked on.
    const current = looks.find((l) => l.id === lookId)
    const folder = current ? folderOf(current) : ''
    const look: Look = { ...newLook(`Look ${looks.length + 1}`, looks.length), ...(folder ? { folder } : {}) }
    edit((s) => ({ ...s, looks: [...s.looks, look] }))
    set({ closedFolders: closed.filter((id) => id !== folder) })
    selectLook(look.id)
  }
  const addFolder = () => {
    const folder = { id: newId(), name: `Folder ${folders.length + 1}` }
    edit((s) => ({ ...s, lookFolders: [...s.lookFolders, folder] }))
    setRenaming(folder.id)
  }
  const removeFolder = (id: string) =>
    edit((s) => ({
      ...s,
      lookFolders: s.lookFolders.filter((f) => f.id !== id),
      looks: s.looks.map((l) => (l.folder === id ? (({ folder: _folder, ...rest }) => rest)(l) : l))
    }))
  const moveTo = (id: string, folder: string) => {
    const look = looks.find((l) => l.id === id)
    if (look && folderOf(look) !== folder) editLook(id, { folder: folder || undefined })
  }

  /** Makes a block take dropped looks into `folder`. */
  const dropTarget = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropOn !== folder) setDropOn(folder)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn((d) => (d === folder ? null : d))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDropOn(null)
      moveTo(e.dataTransfer.getData(DRAG_TYPE), folder)
    }
  })

  const rows = (list: Look[]) => (
    <ul className="list">
      {list.map((l) => {
        const level = active?.find((a) => a.lookId === l.id)?.level ?? 0
        return (
          <li key={l.id}>
            <button
              className={`row look-row${l.id === lookId ? ' on' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, l.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDropOn(null)}
              onClick={() => selectLook(l.id)}
            >
              <span className="look-chip" style={{ background: l.color, opacity: 0.35 + 0.65 * Math.min(1, level * 2) }} />
              <span className="row-name">{l.name}</span>
              <span className="row-meta">{midiLabel(l)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  // While searching, a folder whose name fits shows all of its looks; otherwise only the looks that fit.
  const shown = (folder: { id: string; name: string } | null) => {
    const own = looks.filter((l) => folderOf(l) === (folder?.id ?? ''))
    return !query || folder?.name.toLowerCase().includes(query) ? own : own.filter((l) => lookMatches(l, query))
  }
  const loose = shown(null)
  const filed = folders.map((folder) => ({ folder, list: shown(folder) })).filter((x) => !query || x.list.length > 0 || x.folder.name.toLowerCase().includes(query))
  const nothing = query !== '' && loose.length === 0 && filed.length === 0

  return (
    <aside className="panel left">
      <Section
        title="Looks"
        action={
          <span className="actions">
            <button className="icon" title="New folder" onClick={addFolder}>
              <FolderPlus size={15} />
            </button>
            <button className="button small primary" onClick={add}>
              <Plus size={14} /> New look
            </button>
          </span>
        }
      >
        {looks.length === 0 && folders.length === 0 && <p className="empty">A look is what your lights do on one MIDI note: colours and effects on some or all fixtures.</p>}
        {looks.length > 0 && (
          <div className="search">
            <Search size={14} />
            <input
              ref={searchInput}
              className="input"
              value={search}
              placeholder="Search looks"
              spellCheck={false}
              aria-label="Search looks by name or note"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                setSearch('')
                e.currentTarget.blur()
              }}
            />
            {search && (
              <button className="icon subtle shown" title="Clear search" onClick={() => setSearch('')}>
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {nothing && <p className="empty">No look or folder matches “{search.trim()}”.</p>}

        <div className={`look-group${dropOn === '' ? ' drop' : ''}`} {...dropTarget('')}>
          {rows(loose)}
          {dropOn === '' && loose.length === 0 && <p className="drop-hint">Drop here to take it out of its folder</p>}
        </div>

        {filed.map(({ folder, list }) => {
          const open = query !== '' || !closed.includes(folder.id)
          const count = looks.filter((l) => l.folder === folder.id).length
          return (
            <div key={folder.id} className={`look-group folder${dropOn === folder.id ? ' drop' : ''}`} {...dropTarget(folder.id)}>
              <div className="row folder-row">
                <button
                  className="folder-toggle"
                  aria-expanded={open}
                  title={open ? 'Collapse' : 'Expand'}
                  onClick={() => set({ closedFolders: closed.includes(folder.id) ? closed.filter((id) => id !== folder.id) : [...closed, folder.id] })}
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {open ? <FolderOpen size={14} /> : <Folder size={14} />}
                </button>
                {renaming === folder.id ? (
                  <input
                    className="input inline"
                    autoFocus
                    defaultValue={folder.name}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== folder.name) edit((s) => ({ ...s, lookFolders: s.lookFolders.map((f) => (f.id === folder.id ? { ...f, name } : f)) }))
                      setRenaming(null)
                    }}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
                  />
                ) : (
                  <span className="row-name" title="Double-click to rename" onDoubleClick={() => setRenaming(folder.id)}>
                    {folder.name}
                  </span>
                )}
                <span className="row-meta">{count}</span>
                <button className="icon subtle" title="Rename folder" onClick={() => setRenaming(folder.id)}>
                  <Pencil size={13} />
                </button>
                <button className="icon subtle" title="Delete folder (its looks are kept)" onClick={() => removeFolder(folder.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {open && (list.length > 0 ? rows(list) : <p className="drop-hint">{count === 0 ? 'Drag looks here' : 'No look in here matches'}</p>)}
            </div>
          )
        })}
      </Section>
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
      edit((s) => ({
        ...s,
        images: { ...s.images, [key]: image },
        looks: s.looks.map((l) => (l.id === look.id ? { ...l, layers: l.layers.map((y) => (y.id === layer.id ? { ...y, params: { ...y.params, image: key } } : y)) } : l))
      }))
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
  const def = EFFECT_BY_ID.get(layer.effect)
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
        <div className="effects">
          {EFFECTS.map((e) => (
            <button key={e.id} className={e.id === layer.effect ? 'on' : ''} title={e.hint} onClick={() => changeEffect(e.id)}>
              {e.name}
            </button>
          ))}
        </div>
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
                      <ColorInput value={String(v)} onChange={(c) => setParam(p.key, c)} />
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
          {layer.effect !== 'image' && (
            <Field label="Direction" wide>
              <Select value={layer.mapping} onChange={(mapping) => editLayer(look.id, layer.id, { mapping })} options={MAPPINGS} />
            </Field>
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
      {item.midi && !learning && (
        <div className="form-grid">
          <Field label="Note number">
            <NumberInput value={item.midi.note} min={0} max={127} onChange={(note) => change({ midi: { ...item.midi!, note: Math.round(note) } }, 'note')} />
          </Field>
          <Field label="Channel">
            <Select
              value={String(item.midi.channel)}
              onChange={(c) => change({ midi: { ...item.midi!, channel: Number(c) } })}
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
  const edit = useStore((s) => s.edit)
  const selectLook = useStore((s) => s.selectLook)
  const selectLayer = useStore((s) => s.selectLayer)
  const fixtures = useStore((s) => s.show.fixtures)
  const groups = useStore((s) => s.show.groups)
  const folders = useStore((s) => s.show.lookFolders)
  const inFolder = (l: Look) => (folders.some((f) => f.id === l.folder) ? l.folder! : '')

  if (!look) {
    return (
      <aside className="panel right wide">
        <p className="hint">Select a look on the left, or create a new one.</p>
      </aside>
    )
  }

  const layer = look.layers.find((l) => l.id === layerId) ?? look.layers.at(-1)
  const setLayers = (layers: Layer[]) => editLook(look.id, { layers })
  const move = (dir: -1 | 1) =>
    edit((s) => {
      // Swap places with the neighbour in the same folder: that is the one next to it in the list.
      const i = s.looks.findIndex((l) => l.id === look.id)
      let j = i + dir
      while (s.looks[j] && inFolder(s.looks[j]) !== inFolder(look)) j += dir
      if (j < 0 || j >= s.looks.length) return s
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
        title="Look"
        action={
          <span className="actions">
            <button className={`icon${preview ? ' active' : ''}`} title={preview ? 'Shown on stage while you edit. Click to hide.' : 'Show on stage while editing'} onClick={() => set({ preview: !preview })}>
              {preview ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon" title="Move up in the list (drawn below later looks)" onClick={() => move(-1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" title="Move down in the list (drawn on top)" onClick={() => move(1)}>
              <ArrowDown size={15} />
            </button>
            <button
              className="icon"
              title="Duplicate look"
              onClick={() => {
                const copy: Look = { ...look, id: newId(), name: `${look.name} copy`, midi: null, layers: look.layers.map((y) => ({ ...y, id: newId() })) }
                edit((s) => ({ ...s, looks: [...s.looks, copy] }))
                selectLook(copy.id)
              }}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon"
              title="Delete look"
              onClick={() => {
                edit((s) => ({
                  ...s,
                  looks: s.looks.filter((l) => l.id !== look.id),
                  // Steps that showed this look stay in place as dark steps, so chasers keep their timing.
                  chasers: s.chasers.map((c) => ({ ...c, steps: c.steps.map((step) => (step.lookId === look.id ? { ...step, lookId: '' } : step)) }))
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
        {look.layers.length === 0 && <p className="empty">This look is empty. Add a layer to put an effect on your fixtures.</p>}
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
                <span className="row-name">{EFFECT_BY_ID.get(y.effect)?.name ?? y.effect}</span>
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
    </aside>
  )
}
