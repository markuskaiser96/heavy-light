import { X } from 'lucide-react'
import { useEffect } from 'react'
import { ChaserEditor, ChaserList } from './components/ChaserPanels'
import { EffectEditor, EffectList } from './components/EffectPanels'
import { LookPads, SignalPanel } from './components/LivePanels'
import { LookEditor, LookList } from './components/LookPanels'
import { Resizer } from './components/Resizer'
import { Stage3D } from './components/Stage3D'
import { FixtureInspector, FixtureList } from './components/StagePanels'
import { TopBar } from './components/TopBar'
import { editChaser, editing, editLook, frame, loadInitialShow, saveShow, unsaved, useStore, VIEW_OF, type ItemKind } from './store'

/** Connects the store to the engine process. Runs once for the lifetime of the window. */
function connectEngine(): void {
  const { heavy } = window
  type S = ReturnType<typeof useStore.getState>
  let sendQueued = false
  let sentSaved: unknown = null
  let sentWork: unknown = undefined
  /** Sends the engine the saved show, which MIDI plays, and the show with the unsaved edits, which the preview plays. */
  const sendShow = () => {
    if (sendQueued) return
    sendQueued = true
    // Coalesce bursts of edits (dragging a slider) into one message per animation frame.
    requestAnimationFrame(() => {
      sendQueued = false
      const s = useStore.getState()
      const work = s.show === s.saved ? null : s.show
      if (s.saved !== sentSaved) heavy.send({ type: 'show', show: s.saved })
      if (work !== sentWork) heavy.send({ type: 'work', show: work })
      sentSaved = s.saved
      sentWork = work
    })
  }
  /** Edits to the file, or drafts that are not saved into the show yet. */
  const edited = (s: S) => s.dirty || s.show !== s.saved
  const previewId = (s: S) =>
    !s.preview ? null : s.view === 'looks' ? s.lookId : s.view === 'chasers' ? s.chaserId : s.view === 'effects' && s.effectId ? `effect:${s.effectId}` : null
  const sendPreview = (s: S) => heavy.send({ type: 'preview', id: previewId(s), mapping: s.effectMapping })

  heavy.onEngine((message) => {
    if (message.type === 'frame') frame.pixels = message.pixels
    else if (message.type === 'status') useStore.setState({ status: message.status })
    else {
      const s = useStore.getState()
      const event = message.event
      if (s.learning && event.kind === 'noteon') {
        const midi = { channel: event.channel, note: event.note }
        if (s.view === 'chasers' && s.chaserId) editChaser(s.chaserId, { midi })
        else if (s.view === 'looks' && s.lookId) editLook(s.lookId, { midi })
        useStore.setState({ learning: false })
      }
      useStore.setState({ midiLog: [event, ...s.midiLog].slice(0, 30) })
    }
  })

  heavy.onEngineRestarted(() => {
    sentSaved = null
    sentWork = undefined
    sendShow()
    sendPreview(useStore.getState())
  })

  heavy.onSaveAndClose(() => {
    const s = useStore.getState()
    const open = unsaved(s)
    if (open.length === 0) return void saveShow().then((saved) => saved && heavy.close())
    // Closing must not decide for the user whether half-finished edits go into the show.
    showUnsaved(open[0])
    s.set({ notice: { kind: 'info', text: `${open.length === 1 ? 'One change is' : `${open.length} changes are`} not saved into the show yet. Save or discard ${open.length === 1 ? 'it' : 'them'}, then close again.` } })
  })

  useStore.subscribe((s, prev) => {
    if (s.show !== prev.show || s.saved !== prev.saved) sendShow()
    if (previewId(s) !== previewId(prev) || s.effectMapping !== prev.effectMapping) sendPreview(s)
    if (edited(s) !== edited(prev) || s.saved.name !== prev.saved.name) heavy.setDirty(edited(s), s.saved.name)
  })

  void loadInitialShow().then(() => {
    const s = useStore.getState()
    heavy.setDirty(edited(s), s.saved.name)
    sendPreview(s)
  })
}

/** Brings an entry with unsaved changes on screen. */
function showUnsaved({ kind, id }: { kind: ItemKind; id: string }): void {
  const s = useStore.getState()
  s.setView(VIEW_OF[kind])
  if (kind === 'looks') s.selectLook(id)
  else if (kind === 'chasers') s.selectChaser(id)
  else if (kind === 'effects') s.set({ effectId: id })
  else if (kind === 'fixtures') s.selectFixtures([id])
  else s.selectProps([id])
}

let connected = false

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveShow(e.shiftKey)
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        // A text field hands over what was typed when it loses focus.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        for (const { kind, ids } of editing(useStore.getState())) useStore.getState().saveItems(kind, ids)
      } else if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (!typing && !mod && e.key.toLowerCase() === 'b') {
        window.heavy.send({ type: 'blackout', on: !(s.status?.blackout ?? false) })
      } else if (!typing && e.key === 'Escape') {
        if (s.learning) s.set({ learning: false })
        else if (s.view === 'live') window.heavy.send({ type: 'releaseAll' })
      } else if (!typing && !mod && ['1', '2', '3', '4', '5'].includes(e.key)) {
        s.setView((['stage', 'looks', 'effects', 'chasers', 'live'] as const)[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  const view = useStore((s) => s.view)
  const notice = useStore((s) => s.notice)
  const set = useStore((s) => s.set)
  const panels = useStore((s) => s.panels)
  const widths = { '--left-w': `${panels.left}px`, '--right-w': `${panels.right}px`, '--right-wide-w': `${panels.rightWide}px` } as React.CSSProperties

  useEffect(() => {
    if (connected) return
    connected = true
    connectEngine()
  }, [])
  useShortcuts()

  return (
    <div className={`app view-${view}`}>
      <TopBar />
      <main className="workspace" style={widths}>
        {view === 'stage' && <FixtureList />}
        {view === 'looks' && <LookList />}
        {view === 'effects' && <EffectList />}
        {view === 'chasers' && <ChaserList />}
        {view !== 'live' && <Resizer panel="left" />}
        <div className="center">
          <Stage3D />
          {view === 'live' && <LookPads />}
        </div>
        <Resizer panel={view === 'looks' || view === 'chasers' || view === 'effects' ? 'rightWide' : 'right'} />
        {view === 'stage' && <FixtureInspector />}
        {view === 'looks' && <LookEditor />}
        {view === 'effects' && <EffectEditor />}
        {view === 'chasers' && <ChaserEditor />}
        {view === 'live' && <SignalPanel />}
      </main>
      {notice && (
        <div className={`notice ${notice.kind}`} role="alert">
          {notice.text}
          <button className="icon" onClick={() => set({ notice: null })} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
