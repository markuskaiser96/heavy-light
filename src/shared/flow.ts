import type { Chaser, FlowLink, FlowNode } from './types'

/**
 * A chaser is a small flow chart: scenes and waits as nodes, arrows saying what comes next. When a
 * node is over, the nodes its arrows point to start, all of them or one drawn at random. Several
 * things can therefore run side by side, and an arrow back makes a loop.
 *
 * Everything is counted in beats, and what is left over when a node ends counts towards the next
 * one: a flow keeps its tempo no matter when frames happen.
 */

/** Id of the node every flow starts from. It takes no time; its arrows say what starts with the MIDI note. */
export const START = 'start'

/** Shortest node in beats. Keeps a loop of tiny nodes from spinning forever within one frame. */
export const MIN_BEATS = 0.01

/** Narrowest and widest a node is drawn. In between it is as wide as its name needs. */
export const NODE_W = 124
export const NODE_W_MAX = 460
export const NODE_H = 52
export const START_W = 96
/** Room between neighbours when nodes are laid out: side by side, and one below the other. */
export const NODE_GAP = 52
export const ROW_GAP = 24

/** What a node shows as its name. */
export type NameOf = (lookId: string) => string | undefined

/**
 * How wide a node is drawn so that its whole name fits. Estimated from the number of letters, so
 * that laying out a flow needs no screen to measure on.
 */
export function nodeWidth(node: Pick<FlowNode, 'kind' | 'lookId'>, nameOf?: NameOf): number {
  if (node.kind === 'start') return START_W
  const name = node.kind === 'wait' ? 'Wait' : ((node.lookId && nameOf?.(node.lookId)) ?? 'Dark')
  return Math.min(NODE_W_MAX, Math.max(NODE_W, Math.ceil(40 + name.length * 7.7)))
}

const newId = (): string => Math.random().toString(36).slice(2, 10)

export const startNode = (): FlowNode => ({ id: START, kind: 'start', lookId: '', beats: 0, x: 0, y: 0, next: 'all' })

export function newNode(kind: 'scene' | 'wait', lookId: string, beats: number, x: number, y: number): FlowNode {
  return { id: newId(), kind, lookId, beats, x, y, next: 'all' }
}

/** Length of a node in beats. */
export const nodeBeats = (node: FlowNode): number => (node.kind === 'start' ? 0 : Math.max(MIN_BEATS, node.beats))

// ---------- building ----------

type Graph = Pick<Chaser, 'nodes' | 'links'>

/** The nodes a node's arrows point to. */
export const nextOf = (graph: Graph, id: string): string[] => graph.links.filter((l) => l.from === id).map((l) => l.to)

/** Adds an arrow, unless it is already there. A node may point at itself (it repeats); nothing points at where a flow begins from itself. */
export function link(graph: Graph, from: string, to: string): Graph {
  if (graph.links.some((l) => l.from === from && l.to === to) || (from === START && to === START)) return graph
  return { nodes: graph.nodes, links: [...graph.links, { from, to }] }
}

export function removeNodes(graph: Graph, ids: string[]): Graph {
  const gone = new Set(ids.filter((id) => id !== START))
  if (gone.size === 0) return graph
  return { nodes: graph.nodes.filter((n) => !gone.has(n.id)), links: graph.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)) }
}

/**
 * Adds scenes one after the other, behind `after`. Returns the new graph and the ids of the new
 * nodes. They are placed in a row to the right of `after`, below what is already there.
 */
export function appendChain(graph: Graph, after: string, lookIds: string[], beats: number, nameOf?: NameOf): { graph: Graph; added: string[] } {
  const from = graph.nodes.find((n) => n.id === after) ?? graph.nodes.find((n) => n.id === START)!
  // Free row: the row of `from` if nothing sits to its right there, else below everything.
  const taken = graph.nodes.some((n) => n.id !== from.id && n.x > from.x && Math.abs(n.y - from.y) < NODE_H + 8)
  const y = taken ? Math.max(...graph.nodes.map((n) => n.y)) + NODE_H + ROW_GAP + 12 : from.y
  let x = from.x + nodeWidth(from, nameOf) + NODE_GAP
  const nodes = lookIds.map((lookId) => {
    const node = newNode('scene', lookId, beats, x, y)
    x += nodeWidth(node, nameOf) + NODE_GAP
    return node
  })
  const links: FlowLink[] = nodes.map((n, i) => ({ from: i === 0 ? from.id : nodes[i - 1].id, to: n.id }))
  return { graph: { nodes: [...graph.nodes, ...nodes], links: [...graph.links, ...links] }, added: nodes.map((n) => n.id) }
}

/**
 * Lays a flow out afresh: from the start to the right, every node one column behind the node that
 * first leads to it, nodes of a column below each other. Arrows back simply run back.
 */
export function tidy(graph: Graph, nameOf?: NameOf): Graph {
  const depth = new Map<string, number>([[START, 0]])
  const queue = [START]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const to of nextOf(graph, id)) {
      if (depth.has(to)) continue
      depth.set(to, depth.get(id)! + 1)
      queue.push(to)
    }
  }
  // What nothing leads to goes into a row of its own below, in the order it was in.
  const columns: FlowNode[][] = []
  const loose: FlowNode[] = []
  for (const n of [...graph.nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const d = depth.get(n.id)
    if (d === undefined) loose.push(n)
    else (columns[d] ??= []).push(n)
  }
  const placed = new Map<string, { x: number; y: number }>()
  const tallest = Math.max(1, ...columns.map((c) => c?.length ?? 0))
  let x = 0
  for (const column of columns) {
    if (!column) continue
    column.forEach((n, i) => placed.set(n.id, { x, y: Math.round((i - (column.length - 1) / 2) * (NODE_H + ROW_GAP)) }))
    x += Math.max(...column.map((n) => nodeWidth(n, nameOf))) + NODE_GAP
  }
  let lx = 0
  const ly = Math.round(((tallest - 1) / 2 + 1.5) * (NODE_H + ROW_GAP))
  for (const n of loose) {
    placed.set(n.id, { x: lx, y: ly })
    lx += nodeWidth(n, nameOf) + NODE_GAP
  }
  return { nodes: graph.nodes.map((n) => ({ ...n, ...placed.get(n.id)! })), links: graph.links }
}

/** The steps of a chaser as it was before flows: a list played in some order, looping or not. */
export interface OldSteps {
  steps?: { lookId: string; beats: number }[]
  order?: 'forward' | 'backward' | 'pingpong' | 'random'
  loop?: boolean
}

/** Turns a list of steps into the flow that plays the same. */
export function flowFromSteps({ steps = [], order = 'forward', loop = true }: OldSteps, nameOf?: NameOf): Graph {
  const start = startNode()
  const row = (list: { lookId: string; beats: number }[]) => list.map((s) => newNode('scene', s.lookId, s.beats, 0, 0))
  if (steps.length === 0) return { nodes: [start], links: [] }

  if (order === 'random') {
    // Start draws one of the scenes; each one leads back to start, which draws again.
    const nodes = row(steps)
    const links = nodes.flatMap((n) => [{ from: START, to: n.id }, ...(loop ? [{ from: n.id, to: START }] : [])])
    return tidy({ nodes: [{ ...start, next: 'one' }, ...nodes], links }, nameOf)
  }

  const list = order === 'backward' ? [...steps].reverse() : order === 'pingpong' && steps.length > 2 ? [...steps, ...steps.slice(1, -1).reverse()] : steps
  const nodes = row(list)
  const links: FlowLink[] = nodes.map((n, i) => ({ from: i === 0 ? START : nodes[i - 1].id, to: n.id }))
  // Back and forth without a loop still comes back to where it began.
  if (order === 'pingpong' && !loop && steps.length > 1) {
    const back = newNode('scene', steps[0].lookId, steps[0].beats, 0, 0)
    return tidy({ nodes: [start, ...nodes, back], links: [...links, { from: nodes.at(-1)!.id, to: back.id }] }, nameOf)
  }
  if (loop) links.push({ from: nodes.at(-1)!.id, to: nodes[0].id })
  return tidy({ nodes: [start, ...nodes], links }, nameOf)
}

/** Fills in what a file lacks, and makes sure there is exactly one start. */
export function normalizeFlow(raw: Partial<Graph> & OldSteps, nameOf?: NameOf): Graph {
  if (!Array.isArray(raw.nodes)) return flowFromSteps(raw, nameOf)
  const nodes: FlowNode[] = raw.nodes
    .filter((n) => typeof n?.id === 'string' && n.id !== START)
    .map((n) => ({
      id: n.id,
      kind: n.kind === 'wait' ? 'wait' : 'scene',
      lookId: typeof n.lookId === 'string' ? n.lookId : '',
      beats: typeof n.beats === 'number' && n.beats > 0 ? n.beats : 1,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      next: n.next === 'one' ? 'one' : 'all'
    }))
  const first = raw.nodes.find((n) => n?.id === START)
  const start: FlowNode = { ...startNode(), x: Number(first?.x) || 0, y: Number(first?.y) || 0, next: first?.next === 'one' ? 'one' : 'all' }
  const ids = new Set([START, ...nodes.map((n) => n.id)])
  const links = (raw.links ?? []).filter((l) => ids.has(l?.from) && ids.has(l?.to)).reduce<FlowLink[]>((all, l) => (all.some((o) => o.from === l.from && o.to === l.to) ? all : [...all, { from: l.from, to: l.to }]), [])
  return { nodes: [start, ...nodes], links }
}

// ---------- playing ----------

/** One place a running flow is at. A flow that branched has several. */
export interface Token {
  node: string
  /** Beats played of this node. */
  beat: number
  /** The node this one was started by, so a random draw does not go straight back. */
  from: string | null
  /** When the node started, in the clock of the caller (milliseconds). Sets the effect time of its scene. */
  startedAt: number
  /** Fades in over the crossfade share of its length. False for what starts with the note. */
  fadeIn: boolean
}

/** A scene whose node is over and that is fading out under what came next. */
export interface Tail {
  lookId: string
  /** Beats since its node ended, and how many the fade takes. */
  since: number
  fade: number
  startedAt: number
  /** Length of its node, so its effects carry on counting beats where they were. */
  length: number
}

export interface FlowState {
  tokens: Token[]
  tails: Tail[]
}

/** Never more places than this at once: arrows that double up in a loop would otherwise multiply without end. */
const MAX_TOKENS = 48

interface Index {
  nodes: Map<string, FlowNode>
  next: Map<string, string[]>
}

const indexes = new WeakMap<object, Index>()

function indexOf(graph: Graph): Index {
  let index = indexes.get(graph.nodes)
  if (!index || !indexes.has(graph.links)) {
    const next = new Map<string, string[]>()
    for (const l of graph.links) next.set(l.from, [...(next.get(l.from) ?? []), l.to])
    index = { nodes: new Map(graph.nodes.map((n) => [n.id, n])), next }
    indexes.set(graph.nodes, index)
    indexes.set(graph.links, index)
  }
  return index
}

/** A flow at the moment its note arrives. Call `advanceFlow` with 0 beats to start its first nodes. */
export const startFlow = (now: number): FlowState => ({ tokens: [{ node: START, beat: 0, from: null, startedAt: now, fadeIn: false }], tails: [] })

export const flowOver = (state: FlowState): boolean => state.tokens.length === 0 && state.tails.length === 0

/**
 * Moves a flow on by `beats`. `beatLength` (milliseconds) is only used to say when the nodes that
 * start in this call began. `random` returns 0 up to (not including) 1.
 */
export function advanceFlow(chaser: Graph & { crossfade: number }, state: FlowState, beats: number, now: number, beatLength: number, random: () => number = Math.random): void {
  const { nodes, next } = indexOf(chaser)
  const share = Math.min(1, Math.max(0, chaser.crossfade))

  for (const tail of state.tails) tail.since += beats
  const waiting = state.tokens
  for (const t of waiting) t.beat += beats
  const kept: Token[] = []
  let guard = 0

  while (waiting.length > 0) {
    const t = waiting.pop()!
    const node = nodes.get(t.node)
    // The node was deleted while it played.
    if (!node) continue
    const length = nodeBeats(node)
    if (t.beat < length - 1e-6) {
      kept.push(t)
      continue
    }
    if (++guard > 4000) {
      // Far behind, e.g. the computer was asleep: carry on from here.
      kept.push({ ...t, beat: 0, startedAt: now })
      continue
    }
    const over = Math.max(0, t.beat - length)
    let targets = next.get(node.id) ?? []
    if (node.next === 'one' && targets.length > 1) {
      // Any of them but the one we just came from.
      const others = targets.filter((id) => id !== t.from)
      const pool = others.length > 0 ? others : targets
      targets = [pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]]
    }
    if (node.kind === 'scene' && share > 0) {
      // It fades out for as long as what follows fades in; with nothing following, for its own share.
      const following = targets.map((id) => nodes.get(id)).filter((n): n is FlowNode => !!n && n.kind !== 'start')
      const fade = share * (following.length > 0 ? Math.max(...following.map(nodeBeats)) : length)
      if (over < fade) state.tails.push({ lookId: node.lookId, since: over, fade, startedAt: t.startedAt, length })
    }
    for (const id of targets) waiting.push({ node: id, beat: over, from: node.id, startedAt: now - over * beatLength, fadeIn: node.kind !== 'start' || t.from !== null })
  }

  // Arrows that meet again at the same moment are one place, not two.
  const tokens: Token[] = []
  for (const t of kept) if (!tokens.some((o) => o.node === t.node && Math.abs(o.beat - t.beat) < 1e-4)) tokens.push(t)
  state.tokens = tokens.slice(0, MAX_TOKENS)
  state.tails = state.tails.filter((tail) => tail.since < tail.fade)
}

/** How strongly the scene of a place is shown: 0..1 while it fades in. */
export function tokenLevel(chaser: Graph & { crossfade: number }, t: Token): number {
  const node = indexOf(chaser).nodes.get(t.node)
  if (!node || node.kind !== 'scene') return 0
  const span = Math.min(1, Math.max(0, chaser.crossfade)) * nodeBeats(node)
  return t.fadeIn && span > 0 ? Math.min(1, t.beat / span) : 1
}

export const nodeOf = (chaser: Graph, id: string): FlowNode | undefined => indexOf(chaser).nodes.get(id)

/** Beats until the next node of the flow ends: when something changes next. Infinity if nothing is playing. */
export function nextChange(chaser: Graph, state: FlowState): number {
  let soonest = Infinity
  for (const t of state.tokens) {
    const node = indexOf(chaser).nodes.get(t.node)
    if (node) soonest = Math.min(soonest, nodeBeats(node) - t.beat)
  }
  return soonest
}
