import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { customKey } from '@shared/custom'
import { EFFECTS } from '@shared/effects'
import { canCopyPreset } from '@shared/presets'
import { useStore } from '../store'
import { folderIn } from './ItemList'

interface Option {
  /** As a layer names the effect: `chase`, `custom:<id>`. */
  value: string
  name: string
  /** Shown after the name and searched as well: what a preset does, the folder of an own effect. */
  note: string
}

/**
 * Chooses the effect of a layer: a button that opens a menu with a search field, the user's own
 * effects first, then the presets, then the image effect. Arrow keys and Enter work from the search field.
 */
export function EffectPicker({ value, onChange }: { value: string; onChange: (effect: string) => void }) {
  const custom = useStore((s) => s.show.effects)
  const folders = useStore((s) => s.show.effectFolders)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => {
    const own: Option[] = custom.map((e) => ({ value: customKey(e.id), name: e.name, note: folders.find((f) => f.id === folderIn(folders, e))?.name ?? '' }))
    const builtIn: Option[] = EFFECTS.map((e) => ({ value: e.id, name: e.name, note: e.hint }))
    const query = search.trim().toLowerCase()
    // Two letters are in almost every description, so those only count from the third letter on.
    const fits = (o: Option) => !query || o.name.toLowerCase().includes(query) || (query.length > 2 && o.note.toLowerCase().includes(query))
    return [
      { title: 'Your effects', options: own.filter(fits) },
      { title: 'Presets', options: builtIn.filter((o) => canCopyPreset(o.value)).filter(fits) },
      // Not a preset: it shows a picture, which only a layer can choose.
      { title: 'Picture', options: builtIn.filter((o) => !canCopyPreset(o.value)).filter(fits) }
    ].filter((g) => g.options.length > 0)
  }, [custom, folders, search])
  const options = groups.flatMap((g) => g.options)
  const current = [...custom.map((e) => ({ value: customKey(e.id), name: e.name })), ...EFFECTS.map((e) => ({ value: e.id, name: e.name }))].find((o) => o.value === value)

  const show = () => {
    setSearch('')
    setOpen(true)
  }
  const choose = (effect: string) => {
    setOpen(false)
    if (effect !== value) onChange(effect)
  }

  // Opening and every new search start at the chosen effect, or at the first one that fits.
  useEffect(() => {
    if (open) setAt(Math.max(0, options.findIndex((o) => o.value === value)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search])
  useEffect(() => {
    if (open) list.current?.querySelector('.at')?.scrollIntoView({ block: 'nearest' })
  }, [open, at, search])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open])

  return (
    <div ref={box} className="effect-picker">
      <button className={`input effect-picker-button${current ? '' : ' missing'}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())}>
        <span className="row-name">{current?.name ?? 'Missing effect'}</span>
        <span className="row-meta">{!current ? '' : value.startsWith('custom:') ? 'Your effect' : 'Preset'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="effect-menu">
          <div className="search">
            <Search size={14} />
            <input
              className="input"
              autoFocus
              value={search}
              placeholder="Search effects"
              aria-label="Search effects"
              spellCheck={false}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (options.length) setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (options[at]) choose(options[at].value)
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setOpen(false)
                }
              }}
            />
          </div>
          <div ref={list} className="effect-options" role="listbox">
            {groups.length === 0 && <p className="empty">No effect matches “{search.trim()}”.</p>}
            {groups.map((g) => (
              <div key={g.title} role="group" aria-label={g.title}>
                <h4>{g.title}</h4>
                {g.options.map((o) => (
                  <button
                    key={o.value}
                    role="option"
                    aria-selected={o.value === value}
                    className={`row${options[at] === o ? ' at' : ''}`}
                    onPointerMove={() => setAt(options.indexOf(o))}
                    onClick={() => choose(o.value)}
                  >
                    <span className="effect-check">{o.value === value && <Check size={13} />}</span>
                    <span className="effect-option-name">{o.name}</span>
                    <span className="row-meta">{o.note}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
