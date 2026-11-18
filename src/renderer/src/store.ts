import { create } from 'zustand'
import { demoShow, emptyShow, normalizeShow } from '@shared/show'
import type { Chaser, EngineStatus, FixtureInstance, Layer, Look, MidiEvent, Show } from '@shared/types'
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

export type View = 'stage' | 'looks' | 'chasers' | 'live'

/** Latest pixel colours from the engine. Kept outside React state: it changes 60 times a second. */
export const frame: { pixels: Uint8Array } = { pixels: new Uint8Array(0) }

interface State {
  show: Show
  path: string | null
  dirty: boolean
  view: View
  /** Widths of the side panels in pixels. */
  panels: Record<PanelName, number>
  selectedFixtures: string[]
  lookId: string | null
  layerId: string | null
  chaserId: string | null
  /** Send the look or chaser being edited to the stage. */
  preview: boolean
  learning: boolean
  status: EngineStatus | null
  midiLog: MidiEvent[]
  notice: { kind: 'error' | 'info'; text: string } | null
  past: Show[]
  future: Show[]
  lastEditKey: string
  lastEditAt: number

  /** Applies an edit. Edits sharing a `key` in quick succession (e.g. dragging a slider) form one undo step. */
  edit: (fn: (show: Show) => Show, key?: string) => void
  undo: () => void
  redo: () => void
  setView: (view: View) => void
  setPanel: (panel: PanelName, width: number) => void
  selectFixtures: (ids: string[]) => void
  selectLook: (id: string | null) => void
  selectLayer: (id: string | null) => void
  selectChaser: (id: string | null) => void
  set: (partial: Partial<State>) => void
  load: (show: Show, path: string | null) => void
}

const initialView = (new URLSearchParams(location.search).get('view') as View | null) ?? 'stage'

export const useStore = create<State>((set, get) => ({
  show: emptyShow(),
  path: null,
  dirty: false,
  view: initialView,
  panels: storedPanels(),
  selectedFixtures: [],
  lookId: null,
  layerId: null,
  chaserId: null,
  preview: true,
  learning: false,
  status: null,
  midiLog: [],
  notice: null,
  past: [],
  future: [],
  lastEditKey: '',
  lastEditAt: 0,

  edit: (fn, key = '') => {
    const s = get()
    const next = fn(s.show)
    if (next === s.show) return
    const now = Date.now()
    const merge = key !== '' && key === s.lastEditKey && now - s.lastEditAt < 800
    set({
      show: next,
      dirty: true,
      past: merge ? s.past : [...s.past.slice(-99), s.show],
      future: [],
      lastEditKey: key,
      lastEditAt: now
    })
  },
  undo: () => {
    const s = get()
    const previous = s.past.at(-1)
    if (!previous) return
    set({ show: previous, past: s.past.slice(0, -1), future: [s.show, ...s.future], dirty: true, lastEditKey: '' })
  },
  redo: () => {
    const s = get()
    const next = s.future[0]
    if (!next) return
    set({ show: next, past: [...s.past, s.show], future: s.future.slice(1), dirty: true, lastEditKey: '' })
  },
  setView: (view) => set({ view, learning: false }),
  setPanel: (panel, width) => {
    const panels = { ...get().panels, [panel]: Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width))) }
    set({ panels })
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(panels))
    } catch {
      /* the layout just is not remembered */
    }
  },
  selectFixtures: (ids) => set({ selectedFixtures: ids }),
  selectLook: (id) => {
    const look = get().show.looks.find((l) => l.id === id)
    set({ lookId: id, layerId: look?.layers[0]?.id ?? null, learning: false })
  },
  selectLayer: (id) => set({ layerId: id }),
  selectChaser: (id) => set({ chaserId: id, learning: false }),
  set: (partial) => set(partial),
  load: (show, path) =>
    set({
      show,
      path,
      dirty: false,
      past: [],
      future: [],
      selectedFixtures: [],
      lookId: show.looks[0]?.id ?? null,
      layerId: show.looks[0]?.layers[0]?.id ?? null,
      chaserId: show.chasers[0]?.id ?? null,
      learning: false
    })
}))

// ---------- edit helpers ----------

const { edit } = useStore.getState()

export const editFixture = (id: string, patch: Partial<FixtureInstance>, key?: string): void =>
  edit((show) => ({ ...show, fixtures: show.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), key)

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

// ---------- files ----------

export async function saveShow(saveAs = false): Promise<boolean> {
  const s = useStore.getState()
  try {
    const path = await window.heavy.saveShow({ path: saveAs ? null : s.path, text: JSON.stringify(s.show, null, 2), name: s.show.name })
    if (!path) return false
    // Only clear the edited mark if nothing changed while the file was being written.
    useStore.setState((now) => ({ path, dirty: now.show !== s.show }))
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
