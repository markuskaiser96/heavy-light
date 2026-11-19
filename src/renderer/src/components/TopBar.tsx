import { FilePlus2, FolderOpen, Power, Redo2, Save, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MidiEvent } from '@shared/types'
import { newShow, openShow, saveShow, useStore, type View } from '../store'
import { noteName, TextInput } from './ui'

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'stage', label: 'Stage', hint: 'Fixtures and where they stand' },
  { id: 'looks', label: 'Looks', hint: 'Build what the lights do' },
  { id: 'effects', label: 'Effects', hint: 'Build your own effects from curves' },
  { id: 'chasers', label: 'Chasers', hint: 'Run looks one after the other, in tempo' },
  { id: 'live', label: 'Live', hint: 'Play the show' }
]

const confirmDiscard = (): boolean => !useStore.getState().dirty || window.confirm('Discard the changes you have not saved?')

function MidiIndicator() {
  const last = useStore((s) => s.midiLog[0]) as MidiEvent | undefined
  const ports = useStore((s) => s.status?.midiPorts.length ?? 0)
  const virtual = useStore((s) => s.status?.virtualPort)
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!last) return
    setLit(true)
    const t = setTimeout(() => setLit(false), 140)
    return () => clearTimeout(t)
  }, [last])
  const inputs = ports + (virtual ? 1 : 0)
  return (
    <div className="midi-indicator" title={inputs ? `Listening on ${inputs} MIDI input${inputs === 1 ? '' : 's'}` : 'No MIDI input found'}>
      <span className={`lamp${lit ? ' lit' : ''}${inputs ? '' : ' off'}`} />
      <span className="midi-text">{last && last.kind !== 'cc' ? `${noteName(last.note)} ch ${last.channel}` : inputs ? 'MIDI' : 'No MIDI'}</span>
    </div>
  )
}

export function TopBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const name = useStore((s) => s.show.name)
  const dirty = useStore((s) => s.dirty)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const status = useStore((s) => s.status)
  const edit = useStore((s) => s.edit)
  const master = status?.master ?? 1
  const blackout = status?.blackout ?? false
  const output = status?.output ?? true
  const failing = status?.targets.filter((t) => t.error).length ?? 0

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">HeavyLight</span>
      </div>

      <div className="show-name">
        <TextInput value={name} onChange={(v) => edit((s) => ({ ...s, name: v }))} />
        {dirty && <span className="edited" title="Unsaved changes" />}
      </div>

      <div className="file-actions">
        <button className="icon" title="New show" onClick={() => confirmDiscard() && newShow()}>
          <FilePlus2 size={16} />
        </button>
        <button className="icon" title="Open show…" onClick={() => confirmDiscard() && void openShow()}>
          <FolderOpen size={16} />
        </button>
        <button className="icon" title="Save show" onClick={() => void saveShow()}>
          <Save size={16} />
        </button>
        <span className="sep" />
        <button className="icon" title="Undo" disabled={!canUndo} onClick={() => useStore.getState().undo()}>
          <Undo2 size={16} />
        </button>
        <button className="icon" title="Redo" disabled={!canRedo} onClick={() => useStore.getState().redo()}>
          <Redo2 size={16} />
        </button>
      </div>

      <nav className="views" aria-label="Workspace">
        {VIEWS.map((v) => (
          <button key={v.id} className={v.id === view ? 'on' : ''} title={v.hint} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      <div className="transport">
        <MidiIndicator />
        <button
          className={`output${output ? ' on' : ''}${failing ? ' failing' : ''}`}
          title={output ? (failing ? `${failing} target${failing === 1 ? '' : 's'} cannot be reached – see Live` : 'Sending Art-Net. Click to stop.') : 'Art-Net output is off. Click to send.'}
          onClick={() => window.heavy.send({ type: 'output', on: !output })}
        >
          <Power size={14} />
          <span className="output-text">{output ? 'Output on' : 'Output off'}</span>
        </button>
        <label className="master" title="Master dimmer">
          <span>Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={master}
            style={{ '--fill': `${master * 100}%` } as React.CSSProperties}
            onChange={(e) => window.heavy.send({ type: 'master', value: Number(e.target.value) })}
          />
          <output>{Math.round(master * 100)}%</output>
        </label>
        <button className={`blackout${blackout ? ' on' : ''}`} title="Blackout (B)" onClick={() => window.heavy.send({ type: 'blackout', on: !blackout })}>
          Blackout
        </button>
      </div>
    </header>
  )
}
