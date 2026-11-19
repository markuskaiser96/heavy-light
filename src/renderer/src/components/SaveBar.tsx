import { Check } from 'lucide-react'
import { changedIds, useStore, type ItemKind } from '../store'

/**
 * Sits at the bottom of an editor. What is changed there is a draft: the preview shows it, but MIDI
 * and the file keep the saved state until "Save".
 */
export function SaveBar({ items, noun }: { items: { kind: ItemKind; ids: string[] }[]; noun: string }) {
  // A string, so the component only draws again when the set of changed entries changes.
  const key = useStore((s) => items.map(({ kind, ids }) => changedIds(s, kind).filter((id) => ids.includes(id)).join()).join('|'))
  const changed = items.map(({ kind }, i) => ({ kind, ids: key.split('|')[i].split(',').filter(Boolean) }))
  const count = changed.reduce((n, c) => n + c.ids.length, 0)
  const { saveItems, discardItems } = useStore.getState()
  const several = items.reduce((n, i) => n + i.ids.length, 0) > 1

  return (
    <div className={`save-bar${count ? ' changed' : ''}`}>
      <span className="save-state">{count === 0 ? 'No changes' : several ? `${count} not saved yet` : 'Not saved yet'}</span>
      <button className="button small ghost" disabled={!count} title="Go back to what is saved" onClick={() => changed.forEach((c) => discardItems(c.kind, c.ids))}>
        Discard
      </button>
      <button className="button small primary" disabled={!count} title="Put these changes into the show (Cmd/Ctrl+Enter)" onClick={() => changed.forEach((c) => saveItems(c.kind, c.ids))}>
        <Check size={14} /> Save {noun}
      </button>
    </div>
  )
}
