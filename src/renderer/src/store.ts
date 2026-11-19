import { create } from 'zustand'
import { changedIds, discardItems, editBoth, editDraft, regrouped, saveItems, unsaved, type Drafts, type ItemKind } from '@shared/drafts'
import { demoShow, emptyShow, normalizeShow } from '@shared/show'
import type { Chaser, CustomEffect, EngineStatus, FixtureInstance, Layer, Look, Mapping, MidiEvent, Show, StageProp } from '@shared/types'
import type { HeavyApi } from '../../preload'

declare global {
  interface Window {
    heavy: HeavyApi
  }
}

/** Side panels the user can resize. `rightWide` is the editor panel of Looks and Chasers. */
export type PanelName = 'left' | 'right' | 'rightWide'
export const PANEL_DEFAULTS: Record<PanelName, number> = { left: 264, right: 320, rightWide: 372 }
const PANEL_MIN = 200
const PANEL_MAX = 640
const PANELS_KEY = 'heavylight.panels'

function storedPanels(): Record<PanelName, number> {
  const panels = { ...PANEL_DEFAULTS }
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') as Partial<Record<PanelName, unknown>>
    for (const name of Object.keys(panels) as PanelName[]) {
      const w = saved[name]
      if (typeof w === 'number' && Number.isFinite(w)) panels[name] = Math.min(PANEL_MAX, Math.max(PANEL_MIN, w))
    }
  } catch {
    /* no stored layout, or storage unavailable */
  }
  return panels
}

export type View = 'stage' | 'looks' | 'effects' | 'chasers' | 'midi' | 'live'

/** Latest pixel colours from the engine. Kept outside React state: it changes 60 times a second. */
export const frame: { pixels: Uint8Array } = { pixels: new Uint8Array(0) }

export { changedIds, regrouped, unsaved, type ItemKind }

/** One undo step: the show as the editors have it, and the show as it is saved. */
type Snapshot = Drafts

export interface State {
  /**
   * The show as the editors have it. Fixtures, stage objects, looks, effects and chasers in here can
   * be ahead of `saved`: they are drafts until the user saves them. Everything else is always the same in both.
   */
  show: Show
  /** The show as it is saved: what MIDI plays and what goes into the file. The same object as `show` while nothing is unsaved. */
  saved: Show
  path: string | null
  dirty: boolean
  view: View
  /** Widths of the side panels in pixels. */
  panels: Record<PanelName, number>
  selectedFixtures: string[]
  /** Selected stage objects (musicians, risers …). Can be selected together with fixtures. */
  selectedProps: string[]
  lookId: string | null
  /** Look folders shown collapsed. Not part of the show. */
  closedFolders: string[]
  layerId: string | null
  chaserId: string | null
  /** Nodes selected in the flow chart of the chaser being edited. */
  flowNodes: string[]
  effectId: string | null
  /** How the effect being built in the Effects tab is laid over the fixtures on stage. */
  effectMapping: Mapping
  /** Send the look or chaser being edited to the stage. */
  preview: boolean
  learning: boolean
  /** MIDI tab: the look or chaser that takes the next note. In the editors, the one being edited learns. */
  learnId: string | null
  status: EngineStatus | null
  midiLog: MidiEvent[]
  notice: { kind: 'error' | 'info'; text: string } | null
  past: Snapshot[]
  future: Snapshot[]
  lastEditKey: string
  lastEditAt: number

  /**
   * Applies an edit from an editor. Changes to fixtures, stage objects, looks, effects and chasers stay
   * drafts; anything else it changes applies right away. Edits sharing a `key` in quick succession
   * (e.g. dragging a slider) form one undo step.
   */
  edit: (fn: (show: Show) => Show, key?: string) => void
  /**
   * Applies a change to the show itself, drafts or not: adding, deleting, duplicating, sorting.
   * `fn` runs on the saved show and on the drafts, so it must find what it changes by id.
   */
  editNow: (fn: (show: Show) => Show, key?: string) => void
  /** Puts the drafts with these ids into the show. */
  saveItems: (kind: ItemKind, ids: string[]) => void
  /** Drops the drafts with these ids and goes back to what is saved. */
  discardItems: (kind: ItemKind, ids: string[]) => void
  undo: () => void
  redo: () => void
  setView: (view: View) => void
  setPanel: (panel: PanelName, width: number) => void
  /** Selects these fixtures and nothing else. */
  selectFixtures: (ids: string[]) => void
  /** Selects these stage objects and nothing else. */
  selectProps: (ids: string[]) => void
  selectLook: (id: string | null) => void
  selectLayer: (id: string | null) => void
  selectChaser: (id: string | null) => void
  set: (partial: Partial<State>) => void
  load: (show: Show, path: string | null) => void
}

const initialView = (new URLSearchParams(location.search).get('view') as View | null) ?? 'stage'

const same = (show: Show): Snapshot => ({ show, saved: show })

/** Takes over an edit and remembers the state before it for undo. */
function commit(to: Snapshot, key = ''): void {
  const s = useStore.getState()
  const next = { show: to.show, saved: to.saved }
  if (next.show === s.show && next.saved === s.saved) return
  const now = Date.now()
  const merge = key !== '' && key === s.lastEditKey && now - s.lastEditAt < 800
  useStore.setState({
    ...next,
    dirty: s.dirty || next.saved !== s.saved,
    past: merge ? s.past : [...s.past.slice(-99), { show: s.show, saved: s.saved }],
    future: [],
    lastEditKey: key,
    lastEditAt: now
  })
}

export const useStore = create<State>((set, get) => ({
  ...same(emptyShow()),
  path: null,
  dirty: false,
  view: initialView,
  panels: storedPanels(),
  selectedFixtures: [],
  selectedProps: [],
  lookId: null,
  closedFolders: [],
  layerId: null,
  chaserId: null,
  flowNodes: [],
  effectId: null,
  effectMapping: 'fixture',
  preview: true,
  learning: false,
  learnId: null,
  status: null,
  midiLog: [],
  notice: null,
  past: [],
  future: [],
  lastEditKey: '',
  lastEditAt: 0,

  edit: (fn, key) => commit(editDraft(get(), fn), key),
  editNow: (fn, key) => commit(editBoth(get(), fn), key),
  saveItems: (kind, ids) => commit(saveItems(get(), kind, ids)),
  discardItems: (kind, ids) => commit(discardItems(get(), kind, ids)),
  undo: () => {
    const s = get()
    const previous = s.past.at(-1)
    if (!previous) return
    set({ ...previous, past: s.past.slice(0, -1), future: [{ show: s.show, saved: s.saved }, ...s.future], dirty: s.dirty || previous.saved !== s.saved, lastEditKey: '' })
  },
  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({ ...next, past: [...s.past, { show: s.show, saved: s.saved }], future: s.future.slice(1), dirty: s.dirty || next.saved !== s.saved, lastEditKey: '' })
  },
  setView: (view) => set({ view, learning: false, learnId: null }),
  setPanel: (panel, width) => {
    const panels = { ...get().panels, [panel]: Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width))) }
    set({ panels })
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(panels))
    } catch {
      /* the layout just is not remembered */
    }
  },
  selectFixtures: (ids) => set({ selectedFixtures: ids, selectedProps: [] }),
  selectProps: (ids) => set({ selectedProps: ids, selectedFixtures: [] }),
  selectLook: (id) => {
    const look = get().show.looks.find((l) => l.id === id)
    set({ lookId: id, layerId: look?.layers[0]?.id ?? null, learning: false })
  },
  selectLayer: (id) => set({ layerId: id }),
  selectChaser: (id) => set({ chaserId: id, flowNodes: [], learning: false }),
  set: (partial) => set(partial),
  load: (show, path) =>
    set({
      ...same(show),
      path,
      dirty: false,
      past: [],
      future: [],
      selectedFixtures: [],
      selectedProps: [],
      lookId: show.looks[0]?.id ?? null,
      layerId: show.looks[0]?.layers[0]?.id ?? null,
      chaserId: show.chasers[0]?.id ?? null,
      effectId: show.effects[0]?.id ?? null,
      learning: false
    })
}))

// ---------- edit helpers ----------

const { edit } = useStore.getState()

export const editFixture = (id: string, patch: Partial<FixtureInstance>, key?: string): void =>
  edit((show) => ({ ...show, fixtures: show.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), key)

export const editProp = (id: string, patch: Partial<StageProp>, key?: string): void =>
  edit((show) => ({ ...show, props: show.props.map((p) => (p.id === id ? { ...p, ...patch } : p)) }), key)

export const editEffect = (id: string, patch: Partial<CustomEffect>, key?: string): void =>
  edit((show) => ({ ...show, effects: show.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), key)

export const editLook = (id: string, patch: Partial<Look>, key?: string): void =>
  edit((show) => ({ ...show, looks: show.looks.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), key)

export const editChaser = (id: string, patch: Partial<Chaser>, key?: string): void =>
  edit((show) => ({ ...show, chasers: show.chasers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), key)

export const editLayer = (lookId: string, layerId: string, patch: Partial<Layer>, key?: string): void =>
  edit(
    (show) => ({
      ...show,
      looks: show.looks.map((l) => (l.id === lookId ? { ...l, layers: l.layers.map((y) => (y.id === layerId ? { ...y, ...patch } : y)) } : l))
    }),
    key
  )

// ---------- drafts ----------

/** Where each kind of entry is edited. */
export const VIEW_OF: Record<ItemKind, View> = { fixtures: 'stage', groups: 'stage', props: 'stage', looks: 'looks', effects: 'effects', chasers: 'chasers' }

/** What the save bar of the current view would save: the entries being edited there. */
export function editing(s: State): { kind: ItemKind; ids: string[] }[] {
  if (s.view === 'looks') return [{ kind: 'looks', ids: s.lookId ? [s.lookId] : [] }]
  if (s.view === 'effects') return [{ kind: 'effects', ids: s.effectId ? [s.effectId] : [] }]
  if (s.view === 'chasers') return [{ kind: 'chasers', ids: s.chaserId ? [s.chaserId] : [] }]
  if (s.view !== 'stage') return []
  // Nothing selected on stage: everything that was moved or changed there.
  const all = s.selectedFixtures.length + s.selectedProps.length === 0
  return [
    { kind: 'fixtures', ids: all ? s.show.fixtures.map((f) => f.id) : s.selectedFixtures },
    // Putting a fixture into a group or taking it out is saved with the fixture.
    { kind: 'groups', ids: all ? s.show.groups.map((g) => g.id) : regrouped(s, s.selectedFixtures).groups },
    { kind: 'props', ids: all ? s.show.props.map((p) => p.id) : s.selectedProps }
  ]
}

// ---------- files ----------

export async function saveShow(saveAs = false): Promise<boolean> {
  const s = useStore.getState()
  try {
    // Pictures that no layer uses any more (replaced ones are kept for undo) are left out of the file.
    const used = new Set(s.saved.looks.flatMap((l) => l.layers.map((y) => String(y.params.image ?? ''))))
    const images = Object.fromEntries(Object.entries(s.saved.images).filter(([id]) => used.has(id)))
    const path = await window.heavy.saveShow({ path: saveAs ? null : s.path, text: JSON.stringify({ ...s.saved, images }, null, 2), name: s.saved.name })
    if (!path) return false
    // Only clear the edited mark if nothing changed while the file was being written.
    useStore.setState((now) => ({ path, dirty: now.saved !== s.saved }))
    return true
  } catch (err) {
    useStore.setState({ notice: { kind: 'error', text: `The show could not be saved: ${(err as Error).message}` } })
    return false
  }
}

function loadText(text: string, path: string | null): boolean {
  try {
    useStore.getState().load(normalizeShow(JSON.parse(text)), path)
    return true
  } catch (err) {
    useStore.setState({ notice: { kind: 'error', text: `This file could not be opened: ${(err as Error).message}` } })
    return false
  }
}

export async function openShow(): Promise<void> {
  const file = await window.heavy.openShow()
  if (file) loadText(file.text, file.path)
}

export async function loadInitialShow(): Promise<void> {
  const last = await window.heavy.lastShow()
  if (last && loadText(last.text, last.path)) return
  useStore.getState().load(demoShow(), null)
}

export function newShow(): void {
  useStore.getState().load(emptyShow(), null)
  void window.heavy.forgetShow()
}
