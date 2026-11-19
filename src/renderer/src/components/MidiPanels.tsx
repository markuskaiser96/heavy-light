import { AlertTriangle, Play, Search, Square, X } from 'lucide-react'
import { useState } from 'react'
import type { Chaser, Look, Triggerable } from '@shared/types'
import { useStore } from '../store'
import { noteName, NumberInput, Segmented, Select } from './ui'

type Row = { item: Look | Chaser; chaser: boolean; folder: string }

const CHANNELS = [{ value: '0', label: 'Any' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]
const MODES: { value: Triggerable['triggerMode']; label: string }[] = [
  { value: 'hold', label: 'While held' },
  { value: 'toggle', label: 'On / off' }
]

/** Changes how a look or chaser is triggered, in the show right away: this table is for assigning, not for drafting. */
const assign = (id: string, patch: Partial<Pick<Triggerable, 'midi' | 'triggerMode'>>): void =>
  useStore.getState().editNow((s) => ({
    ...s,
    looks: s.looks.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    chasers: s.chasers.map((c) => (c.id === id ? { ...c, ...patch } : c))
  }))

/**
 * All looks and chasers with their MIDI notes in one table: see what a keyboard would play, what is
 * playing right now, and change the assignments in place.
 */
export function MidiTable() {
  const looks = useStore((s) => s.saved.looks)
  const chasers = useStore((s) => s.saved.chasers)
  const lookFolders = useStore((s) => s.saved.lookFolders)
  const chaserFolders = useStore((s) => s.saved.chaserFolders)
  const active = useStore((s) => s.status?.active)
  const running = useStore((s) => s.status?.chasers)
  const learning = useStore((s) => s.learning)
  const learnId = useStore((s) => s.learnId)
  const set = useStore((s) => s.set)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'note' | 'list'>('note')
  const query = search.trim().toLowerCase()

  const all: Row[] = [
    ...chasers.map((item) => ({ item, chaser: true, folder: chaserFolders.find((f) => f.id === item.folder)?.name ?? '' })),
    ...looks.map((item) => ({ item, chaser: false, folder: lookFolders.find((f) => f.id === item.folder)?.name ?? '' }))
  ]
  const label = (m: Triggerable['midi']) => (m ? `${noteName(m.note)} ${m.note}` : '')
  const shown = all.filter(({ item, folder }) => !query || item.name.toLowerCase().includes(query) || folder.toLowerCase().includes(query) || label(item.midi).toLowerCase().includes(query))
  // By note: the keyboard from left to right, what has no note yet at the end.
  const rows = sort === 'list' ? shown : [...shown].sort((a, b) => (a.item.midi?.note ?? 999) - (b.item.midi?.note ?? 999) || (a.item.midi?.channel ?? 0) - (b.item.midi?.channel ?? 0))
  const level = (row: Row) => (row.chaser ? running?.find((r) => r.chaserId === row.item.id)?.level : active?.find((a) => a.lookId === row.item.id)?.level) ?? 0
  const sharing = (row: Row) => {
    const m = row.item.midi
    if (!m) return []
    return all.filter((o) => o.item.id !== row.item.id && o.item.midi?.note === m.note && (o.item.midi.channel === 0 || m.channel === 0 || o.item.midi.channel === m.channel)).map((o) => o.item.name)
  }
  const anyActive = (active?.length ?? 0) > 0 || (running?.length ?? 0) > 0
  const assigned = all.filter((r) => r.item.midi).length

  return (
    <div className="midi-dock">
      <div className="midi-tools">
        <div className="search">
          <Search size={14} />
          <input className="input" value={search} placeholder="Search name, folder or note" spellCheck={false} aria-label="Search scenes and chasers" onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="icon subtle shown" title="Clear search" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'note', label: 'By note' },
            { value: 'list', label: 'As listed' }
          ]}
        />
        <span className="muted midi-count">
          {assigned} of {all.length} have a note
        </span>
        <button className="button small ghost" disabled={!anyActive} title="Stop every scene and chaser (Esc)" onClick={() => window.heavy.send({ type: 'releaseAll' })}>
          Release all
        </button>
      </div>

      {all.length === 0 && <p className="empty">No scenes or chasers yet. Build some, then give them their notes here.</p>}
      {all.length > 0 && rows.length === 0 && <p className="empty">Nothing matches “{search.trim()}”.</p>}

      {rows.length > 0 && (
        <table className="midi-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Folder</th>
              <th>Note</th>
              <th>Channel</th>
              <th>Plays</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { item } = row
              const on = level(row) > 0
              const waiting = learning && learnId === item.id
              const others = sharing(row)
              return (
                <tr key={item.id} className={`${on ? 'on' : ''}${waiting ? ' waiting' : ''}`} style={{ '--look': item.color, '--level': Math.min(1, level(row)) } as React.CSSProperties}>
                  <td>
                    <button className="midi-play" title={on ? 'Stop' : 'Play'} onClick={() => window.heavy.send({ type: 'toggle', id: item.id })}>
                      {on ? <Square size={11} /> : <Play size={11} />}
                    </button>
                  </td>
                  <td>
                    <span className="midi-name">
                      <span className="look-chip" style={{ background: item.color }} />
                      <span className="row-name">{item.name}</span>
                      {row.chaser && <span className="badge">Chaser</span>}
                    </span>
                  </td>
                  <td className="muted">{row.folder}</td>
                  <td>
                    <span className="midi-note">
                    <span className={`note-badge small${item.midi ? '' : ' none'}`}>{item.midi ? noteName(item.midi.note) : '–'}</span>
                    <NumberInput value={item.midi?.note ?? NaN} min={0} max={127} placeholder="none" onChange={(note) => assign(item.id, { midi: { channel: item.midi?.channel ?? 0, note: Math.round(note) } })} />
                    {others.length > 0 && (
                      <span className="midi-shared" title={`Also plays ${others.join(', ')}`}>
                        <AlertTriangle size={13} />
                      </span>
                    )}
                    </span>
                  </td>
                  <td>{item.midi && <Select value={String(item.midi.channel)} onChange={(c) => assign(item.id, { midi: { ...item.midi!, channel: Number(c) } })} options={CHANNELS} />}</td>
                  <td>
                    <Select value={item.triggerMode} onChange={(triggerMode) => assign(item.id, { triggerMode })} options={MODES} />
                  </td>
                  <td className="midi-actions">
                    {waiting ? (
                      <button className="button small ghost" onClick={() => set({ learning: false, learnId: null })}>
                        <span className="lamp lit pulse" /> Play a note… Cancel
                      </button>
                    ) : (
                      <>
                        <button className="button small ghost" title="Take the next note that arrives" onClick={() => set({ learning: true, learnId: item.id })}>
                          Learn
                        </button>
                        <button className="icon subtle shown" title="Remove the note" disabled={!item.midi} onClick={() => assign(item.id, { midi: null })}>
                          <X size={13} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
