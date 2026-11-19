import type { Show } from './types'

/**
 * Edits wait as drafts until the user saves them: the editors work on one copy of the show, while
 * MIDI and the file keep the saved one. This holds for the entries of the lists below; everything
 * else (settings, folders, groups, pictures) is the same in both copies at all times.
 */
export type ItemKind = 'fixtures' | 'props' | 'looks' | 'effects' | 'chasers'
export const ITEM_KINDS: ItemKind[] = ['fixtures', 'props', 'looks', 'effects', 'chasers']

export interface Drafts {
  /** The show as the editors have it. */
  show: Show
  /** The show as it is saved. The same object as `show` while nothing is unsaved. */
  saved: Show
}

interface Item {
  id: string
}

const isKind = (key: string): boolean => (ITEM_KINDS as string[]).includes(key)
const list = (show: Show, kind: ItemKind): Item[] => show[kind]

/**
 * Tidies up after an edit: a draft that is back to what is saved becomes the saved entry again, and
 * a show without drafts is the saved show itself. So "has unsaved changes" is a plain `!==`.
 */
export function reconcile({ show, saved }: Drafts): Drafts {
  if (show === saved) return { show, saved }
  let next = show
  let equal = true
  for (const kind of ITEM_KINDS) {
    const drafts = list(show, kind)
    const kept = list(saved, kind)
    if (drafts === kept) continue
    const byId = new Map(kept.map((i) => [i.id, i]))
    const tidy = drafts.map((d) => {
      const k = byId.get(d.id)
      return k && k !== d && JSON.stringify(k) === JSON.stringify(d) ? k : d
    })
    if (tidy.length === kept.length && tidy.every((d, i) => d === kept[i])) next = { ...next, [kind]: kept }
    else {
      equal = false
      if (tidy.some((d, i) => d !== drafts[i])) next = { ...next, [kind]: tidy }
    }
  }
  return { show: equal ? saved : next, saved }
}

/** An edit from an editor: changes to draftable entries stay drafts, anything else it changes applies right away. */
export function editDraft(now: Drafts, fn: (show: Show) => Show): Drafts {
  const next = fn(now.show)
  if (next === now.show) return now
  const saved: Record<string, unknown> = { ...now.saved }
  let changed = false
  for (const [key, value] of Object.entries(next)) {
    if (isKind(key) || value === (now.show as unknown as Record<string, unknown>)[key]) continue
    saved[key] = value
    changed = true
  }
  return reconcile({ show: next, saved: changed ? (saved as unknown as Show) : now.saved })
}

/**
 * A change to the show itself, drafts or not: adding, deleting, duplicating, sorting. `fn` runs on
 * the saved show and on the drafts, so it must find what it changes by id.
 */
export function editBoth(now: Drafts, fn: (show: Show) => Show): Drafts {
  const saved = fn(now.saved)
  if (now.show === now.saved) return { show: saved, saved }
  const show: Record<string, unknown> = { ...fn(now.show) }
  for (const [key, value] of Object.entries(saved)) if (!isKind(key)) show[key] = value
  return reconcile({ show: show as unknown as Show, saved })
}

/** Puts the drafts with these ids into the show. */
export function saveItems(now: Drafts, kind: ItemKind, ids: string[]): Drafts {
  const drafts = new Map(list(now.show, kind).map((i) => [i.id, i]))
  return reconcile({ show: now.show, saved: { ...now.saved, [kind]: list(now.saved, kind).map((i) => (ids.includes(i.id) ? (drafts.get(i.id) ?? i) : i)) } })
}

/** Drops the drafts with these ids and goes back to what is saved. */
export function discardItems(now: Drafts, kind: ItemKind, ids: string[]): Drafts {
  const saved = new Map(list(now.saved, kind).map((i) => [i.id, i]))
  return reconcile({ show: { ...now.show, [kind]: list(now.show, kind).map((i) => (ids.includes(i.id) ? (saved.get(i.id) ?? i) : i)) }, saved: now.saved })
}

const NONE: string[] = []

/** Ids of the entries of one list that have unsaved changes. */
export function changedIds(now: Drafts, kind: ItemKind): string[] {
  if (now.show[kind] === now.saved[kind]) return NONE
  const saved = new Map(list(now.saved, kind).map((i) => [i.id, i]))
  return list(now.show, kind)
    .filter((i) => saved.get(i.id) !== i)
    .map((i) => i.id)
}

/** Everything with unsaved changes, list by list. */
export const unsaved = (now: Drafts): { kind: ItemKind; id: string }[] => (now.show === now.saved ? [] : ITEM_KINDS.flatMap((kind) => changedIds(now, kind).map((id) => ({ kind, id }))))
