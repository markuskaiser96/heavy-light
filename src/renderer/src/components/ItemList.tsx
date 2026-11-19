import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, Pencil, Search, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { newId } from '@shared/show'
import type { Folder, FolderList } from '@shared/types'
import { changedIds, useStore, type ItemKind } from '../store'
import { Section } from './ui'

interface Listed {
  id: string
  name: string
  folder?: string
}

/** The folder an entry is shown in ('' = none). A folder that no longer exists counts as none. */
export const folderIn = (folders: Folder[], item: Listed): string => (folders.some((f) => f.id === item.folder) ? item.folder! : '')

/**
 * A list of the show with a search field and folders: looks, effects, chasers, fixtures.
 * Folders only organise the list; sorting into them applies right away, by drag and drop.
 */
export function ItemList<T extends Listed>({
  kind,
  folderList,
  title,
  noun,
  items,
  selected,
  onSelect,
  matches,
  lead,
  meta,
  action,
  empty,
  alsoChanged
}: {
  kind: ItemKind
  folderList: FolderList
  title: string
  /** What one entry is called, e.g. "look". */
  noun: string
  items: T[]
  selected: string[]
  /** `visible` holds the ids in the order they are listed, for selecting a range. */
  onSelect: (id: string, e: React.MouseEvent, visible: string[]) => void
  /** Does the entry fit the search beyond its name? */
  matches?: (item: T, query: string) => boolean
  /** What stands before the name of a row, and after it. */
  lead: (item: T) => ReactNode
  meta: (item: T) => ReactNode
  /** Entries to mark as changed beyond those that are drafts themselves. */
  alsoChanged?: string[]
  /** The "New …" button. */
  action: ReactNode
  empty: string
}) {
  const folders = useStore((s) => s.show[folderList])
  const closed = useStore((s) => s.closedFolders)
  // Joined, so the list only draws again when the set of changed entries changes.
  const changed = useStore((s) => changedIds(s, kind).join()).split(',')
  const set = useStore((s) => s.set)
  const editNow = useStore((s) => s.editNow)
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  /** Folder a dragged entry hovers over ('' = the entries outside folders). */
  const [dropOn, setDropOn] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const query = search.trim().toLowerCase()
  const dragType = `application/x-heavylight-${kind}`

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

  const folderOf = (item: T) => folderIn(folders, item)
  const editFolders = (fn: (folders: Folder[]) => Folder[]) => editNow((s) => ({ ...s, [folderList]: fn(s[folderList]) }))
  const addFolder = () => {
    const folder = { id: newId(), name: `Folder ${folders.length + 1}` }
    editFolders((list) => [...list, folder])
    setRenaming(folder.id)
  }
  const file = (list: Listed[], ids: string[], folder: string): Listed[] =>
    list.map((i) => {
      if (!ids.includes(i.id) || (i.folder ?? '') === folder) return i
      const { folder: _, ...rest } = i
      return folder ? { ...rest, folder } : rest
    })
  const removeFolder = (id: string) =>
    editNow((s) => ({
      ...s,
      [folderList]: s[folderList].filter((f) => f.id !== id),
      [kind]: file(
        s[kind] as Listed[],
        (s[kind] as Listed[]).filter((i) => i.folder === id).map((i) => i.id),
        ''
      )
    }))
  const moveTo = (id: string, folder: string) => {
    // Dragging one of several selected entries takes all of them along.
    const ids = selected.includes(id) ? selected : [id]
    editNow((s) => ({ ...s, [kind]: file(s[kind] as Listed[], ids, folder) }))
  }

  /** Makes a block take dropped entries into `folder`. */
  const dropTarget = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(dragType)) return
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
      moveTo(e.dataTransfer.getData(dragType), folder)
    }
  })

  // While searching, a folder whose name fits shows all of its entries; otherwise only the entries that fit.
  const fits = (item: T) => item.name.toLowerCase().includes(query) || (matches?.(item, query) ?? false)
  const shown = (folder: Folder | null) => {
    const own = items.filter((i) => folderOf(i) === (folder?.id ?? ''))
    return !query || folder?.name.toLowerCase().includes(query) ? own : own.filter(fits)
  }
  const loose = shown(null)
  const filed = folders.map((folder) => ({ folder, list: shown(folder) })).filter((x) => !query || x.list.length > 0 || x.folder.name.toLowerCase().includes(query))
  const isOpen = (folder: Folder) => query !== '' || !closed.includes(folder.id)
  const visible = [...loose, ...filed.flatMap((x) => (isOpen(x.folder) ? x.list : []))].map((i) => i.id)
  const nothing = query !== '' && loose.length === 0 && filed.length === 0

  const rows = (list: T[]) => (
    <ul className="list">
      {list.map((item) => (
        <li key={item.id}>
          <button
            className={`row item-row${selected.includes(item.id) ? ' on' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(dragType, item.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDropOn(null)}
            onClick={(e) => onSelect(item.id, e, visible)}
          >
            {lead(item)}
            <span className="row-name">{item.name}</span>
            {(changed.includes(item.id) || alsoChanged?.includes(item.id)) && <span className="unsaved-dot" title="Has changes that are not saved into the show" />}
            <span className="row-meta">{meta(item)}</span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <Section
      title={title}
      action={
        <span className="actions">
          <button className="icon" title="New folder" onClick={addFolder}>
            <FolderPlus size={15} />
          </button>
          {action}
        </span>
      }
    >
      {items.length === 0 && folders.length === 0 && <p className="empty">{empty}</p>}
      {items.length > 0 && (
        <div className="search">
          <Search size={14} />
          <input
            ref={searchInput}
            className="input"
            value={search}
            placeholder={`Search ${title.toLowerCase()}`}
            spellCheck={false}
            aria-label={`Search ${title.toLowerCase()}`}
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
      {nothing && (
        <p className="empty">
          No {noun} or folder matches “{search.trim()}”.
        </p>
      )}

      <div className={`look-group${dropOn === '' ? ' drop' : ''}`} {...dropTarget('')}>
        {rows(loose)}
        {dropOn === '' && loose.length === 0 && <p className="drop-hint">Drop here to take it out of its folder</p>}
      </div>

      {filed.map(({ folder, list }) => {
        const open = isOpen(folder)
        const count = items.filter((i) => i.folder === folder.id).length
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
                {open ? <FolderOpen size={14} /> : <FolderIcon size={14} />}
              </button>
              {renaming === folder.id ? (
                <input
                  className="input inline"
                  autoFocus
                  defaultValue={folder.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name && name !== folder.name) editFolders((all) => all.map((f) => (f.id === folder.id ? { ...f, name } : f)))
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
              <button className="icon subtle" title={`Delete folder (its ${title.toLowerCase()} are kept)`} onClick={() => removeFolder(folder.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            {open && (list.length > 0 ? rows(list) : <p className="drop-hint">{count === 0 ? `Drag ${title.toLowerCase()} here` : `No ${noun} in here matches`}</p>)}
          </div>
        )
      })}
    </Section>
  )
}
