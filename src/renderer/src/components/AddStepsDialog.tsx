import { Check, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { Look } from '@shared/types'
import { useStore } from '../store'
import { folderIn } from './ItemList'
import { midiLabel } from './LookPanels'
import { BeatLength } from './ui'

/**
 * Picks many scenes at once to become nodes of a flow: search, tick, add. They are added in the
 * order of the list, each with the same length, not linked to anything yet.
 */
export function AddStepsDialog({ beats: startBeats, onAdd, onClose }: { beats: number; onAdd: (lookIds: string[], beats: number) => void; onClose: () => void }) {
  const looks = useStore((s) => s.show.looks)
  const folders = useStore((s) => s.show.lookFolders)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [last, setLast] = useState<string | null>(null)
  const [beats, setBeats] = useState(startBeats)
  const query = search.trim().toLowerCase()

  // As in the look list: a folder whose name fits shows all of its looks, otherwise only the looks that fit.
  const fits = (l: Look) => l.name.toLowerCase().includes(query) || midiLabel(l).toLowerCase().includes(query)
  const groups = [null, ...folders]
    .map((folder) => {
      const own = looks.filter((l) => folderIn(folders, l) === (folder?.id ?? ''))
      return { folder, list: !query || folder?.name.toLowerCase().includes(query) ? own : own.filter(fits) }
    })
    .filter((g) => g.list.length > 0)
  const shown = groups.flatMap((g) => g.list.map((l) => l.id))
  const allShown = shown.length > 0 && shown.every((id) => picked.includes(id))

  const tick = (ids: string[], on: boolean) => setPicked((now) => (on ? [...now, ...ids.filter((id) => !now.includes(id))] : now.filter((id) => !ids.includes(id))))
  const click = (id: string, e: React.MouseEvent) => {
    const on = !picked.includes(id)
    // Shift-click takes everything between the last click and this one along.
    const a = e.shiftKey && last ? shown.indexOf(last) : -1
    const b = shown.indexOf(id)
    tick(a < 0 ? [id] : shown.slice(Math.min(a, b), Math.max(a, b) + 1), on)
    setLast(id)
  }
  const add = () => {
    if (picked.length === 0) return
    // In the order of the look list, not the order of clicking: easier to predict.
    onAdd(
      looks.filter((l) => picked.includes(l.id)).map((l) => l.id),
      beats
    )
    onClose()
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog pick-dialog"
        role="dialog"
        aria-label="Add scenes to the flow"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLButtonElement))) add()
        }}
      >
        <header>
          <h2>Add scenes to the flow</h2>
          <button className="icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <div className="search">
          <Search size={14} />
          <input className="input" autoFocus value={search} placeholder="Search scenes or folders" spellCheck={false} aria-label="Search scenes" onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button className="icon subtle shown" title="Clear search" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        <div className="pick-bar">
          <button className="button small ghost" disabled={shown.length === 0} onClick={() => tick(shown, !allShown)}>
            {allShown ? 'Untick' : 'Tick'} {query ? `the ${shown.length} shown` : 'all'}
          </button>
          <span className="muted">
            {picked.length} of {looks.length} ticked. Shift-click ticks a range.
          </span>
        </div>

        <div className="pick-list">
          {looks.length === 0 && <p className="empty">There are no scenes yet. Build some in the Scenes tab first.</p>}
          {looks.length > 0 && shown.length === 0 && <p className="empty">No scene or folder matches “{search.trim()}”.</p>}
          {groups.map(({ folder, list }) => {
            const ids = list.map((l) => l.id)
            const all = ids.every((id) => picked.includes(id))
            return (
              <div key={folder?.id ?? ''}>
                {folder && (
                  <button className="pick-folder" title={all ? 'Untick this folder' : 'Tick this folder'} onClick={() => tick(ids, !all)}>
                    <span className={`tick${all ? ' on' : ''}`}>{all && <Check size={11} />}</span>
                    {folder.name}
                    <span className="row-meta">{list.length}</span>
                  </button>
                )}
                {list.map((l) => {
                  const on = picked.includes(l.id)
                  return (
                    <button key={l.id} className={`pick-row${on ? ' on' : ''}${folder ? ' filed' : ''}`} role="checkbox" aria-checked={on} onClick={(e) => click(l.id, e)}>
                      <span className={`tick${on ? ' on' : ''}`}>{on && <Check size={11} />}</span>
                      <span className="look-chip" style={{ background: l.color }} />
                      <span className="row-name">{l.name}</span>
                      <span className="row-meta">{midiLabel(l)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <footer>
          <span className="pick-length">
            <span className="field-label">Each one lasts</span>
            <BeatLength value={beats} min={1 / 8} onChange={setBeats} />
          </span>
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={picked.length === 0} onClick={add}>
            Add {picked.length === 1 ? '1 scene' : `${picked.length} scenes`}
          </button>
        </footer>
      </div>
    </div>
  )
}
