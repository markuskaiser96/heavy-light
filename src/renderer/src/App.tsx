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
import { editChaser, editLook, frame, loadInitialShow, saveShow, useStore } from './store'

/** Connects the store to the engine process. Runs once for the lifetime of the window. */
function connectEngine(): void {
  const { heavy } = window
  let sendQueued = false
  const sendShow = () => {
    if (sendQueued) return
    sendQueued = true
    // Coalesce bursts of edits (dragging a slider) into one message per animation frame.
    requestAnimationFrame(() => {
      sendQueued = false
      heavy.send({ type: 'show', show: useStore.getState().show })
    })
  }
  type S = ReturnType<typeof useStore.getState>
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
    sendShow()
    sendPreview(useStore.getState())
  })

  heavy.onSaveAndClose(() => void saveShow().then((saved) => saved && heavy.close()))

  useStore.subscribe((s, prev) => {
    if (s.show !== prev.show) sendShow()
    if (previewId(s) !== previewId(prev) || s.effectMapping !== prev.effectMapping) sendPreview(s)
    if (s.dirty !== prev.dirty || s.show.name !== prev.show.name) heavy.setDirty(s.dirty, s.show.name)
  })

  void loadInitialShow().then(() => {
    const s = useStore.getState()
    heavy.setDirty(s.dirty, s.show.name)
    sendPreview(s)
  })
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
