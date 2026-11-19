import { Hourglass, ListPlus, Maximize2, Play, Plus, Shuffle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { appendChain, link, newNode, nextOf, NODE_GAP, NODE_H, NODE_W, removeNodes, START } from '@shared/flow'
import type { Chaser, FlowLink, FlowNode } from '@shared/types'
import { editChaser, useStore } from '../store'
import { AddStepsDialog } from './AddStepsDialog'
import { beatLabel } from './ui'

const GRID = 12
const snap = (v: number): number => Math.round(v / GRID) * GRID

/** Where an arrow leaves a node and where it arrives. */
const outOf = (n: FlowNode): [number, number] => [n.x + (n.kind === 'start' ? START_W : NODE_W), n.y + NODE_H / 2]
const into = (n: FlowNode): [number, number] => [n.x, n.y + NODE_H / 2]
const START_W = 96

/** The line of an arrow. One that leads back (a loop) swings out below the nodes so it does not run through them. */
function arrowPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  if (x2 >= x1 + 24) {
    const d = Math.max(36, (x2 - x1) / 2)
    return `M${x1} ${y1} C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`
  }
  const drop = Math.max(y1, y2) + NODE_H / 2 + 34 + Math.min(60, (x1 - x2) / 12)
  return `M${x1} ${y1} C${x1 + 70} ${y1} ${x1 + 70} ${drop} ${x1 - 10} ${drop} L${x2 + 10} ${drop} C${x2 - 70} ${drop} ${x2 - 70} ${y2} ${x2} ${y2}`
}

/** The node new things are added behind: the selected one, else where the flow ends, else its start. */
function anchor(chaser: Chaser, selected: string[]): FlowNode {
  const chosen = selected.length === 1 ? chaser.nodes.find((n) => n.id === selected[0]) : undefined
  if (chosen) return chosen
  const ends = chaser.nodes.filter((n) => n.kind !== 'start' && nextOf(chaser, n.id).length === 0)
  return ends.sort((a, b) => b.x - a.x)[0] ?? chaser.nodes.find((n) => n.id === START)!
}

/** A free spot to the right of `after`: further down if something is already there. */
function spotAfter(chaser: Chaser, after: FlowNode): { x: number; y: number } {
  const x = after.x + NODE_GAP
  let y = after.y
  while (chaser.nodes.some((n) => Math.abs(n.x - x) < NODE_W && Math.abs(n.y - y) < NODE_H + 8)) y += NODE_H + 24
  return { x, y }
}

/**
 * The flow chart of a chaser: scenes and waits as boxes, arrows for what comes next. Drag boxes to
 * arrange them, drag from the dot on the right of a box onto another box to link them.
 */
export function FlowGraph() {
  const chaser = useStore((s) => s.show.chasers.find((c) => c.id === s.chaserId))
  const looks = useStore((s) => s.show.looks)
  const selected = useStore((s) => s.flowNodes)
  const preview = useStore((s) => s.preview)
  const playing = useStore((s) => (s.preview ? s.status?.previewNodes : s.status?.chasers.find((r) => r.chaserId === s.chaserId)?.nodes)?.join() ?? '').split(',')
  const set = useStore((s) => s.set)
  const [view, setView] = useState({ x: 60, y: 0, k: 1 })
  const [pickedLink, setPickedLink] = useState<FlowLink | null>(null)
  /** While an arrow is being drawn: from which node, and where the pointer is. */
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null)
  const [picking, setPicking] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'nodes'; x: number; y: number; moved: boolean; start: Map<string, { x: number; y: number }> } | null>(null)
  const chaserId = chaser?.id

  const select = (ids: string[]) => {
    set({ flowNodes: ids })
    setPickedLink(null)
  }

  /** Brings the whole flow into view. */
  const fit = () => {
    const el = box.current
    if (!el || !chaser) return
    const xs = chaser.nodes.flatMap((n) => [n.x, n.x + NODE_W])
    const ys = chaser.nodes.flatMap((n) => [n.y, n.y + NODE_H])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    const k = Math.min(1, (el.clientWidth - 120) / Math.max(1, w), (el.clientHeight - 150) / Math.max(1, h))
    const scale = Math.max(0.3, k)
    setView({ k: scale, x: (el.clientWidth - w * scale) / 2 - Math.min(...xs) * scale, y: (el.clientHeight - h * scale) / 2 - Math.min(...ys) * scale + 14 })
  }
  // A different chaser: show all of it.
  useLayoutEffect(() => {
    fit()
    select([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaserId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const c = s.show.chasers.find((x) => x.id === s.chaserId)
      if (typing || !c || s.view !== 'chasers') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (pickedLink) {
          editChaser(c.id, { links: c.links.filter((l) => !(l.from === pickedLink.from && l.to === pickedLink.to)) })
          setPickedLink(null)
        } else if (s.flowNodes.length) {
          editChaser(c.id, removeNodes(c, s.flowNodes))
          s.set({ flowNodes: [] })
        }
      } else if (e.key === 'Escape') {
        s.set({ flowNodes: [] })
        setPickedLink(null)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.set({ flowNodes: c.nodes.filter((n) => n.kind !== 'start').map((n) => n.id) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickedLink])

  if (!chaser) {
    return (
      <div className="flow-dock">
        <p className="hint">Select a flow on the left, or create a new one.</p>
      </div>
    )
  }

  const byId = new Map(chaser.nodes.map((n) => [n.id, n]))
  /** Pointer position in the coordinates of the chart. */
  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect()
    return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]
  }
  const nodeAt = (e: { clientX: number; clientY: number }): string | null => (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]') as HTMLElement | null)?.dataset.node ?? null

  const add = (kind: 'scene' | 'wait') => {
    const after = anchor(chaser, selected)
    const { x, y } = spotAfter(chaser, after)
    // Offer the scene after the one before: building a run through the scenes takes one click per node.
    const last = looks.findIndex((l) => l.id === after.lookId)
    const node = newNode(kind, kind === 'scene' ? (looks[(last + 1) % Math.max(1, looks.length)]?.id ?? '') : '', after.kind === 'start' ? 1 : after.beats, x, y)
    editChaser(chaser.id, link({ nodes: [...chaser.nodes, node], links: chaser.links }, after.id, node.id))
    select([node.id])
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const port = target.closest('[data-port]') as HTMLElement | null
    const nodeEl = target.closest('[data-node]') as HTMLElement | null
    e.currentTarget.setPointerCapture(e.pointerId)
    if (port) {
      const [x, y] = toWorld(e)
      setDrawing({ from: port.dataset.port!, x, y, over: null })
      return
    }
    if (nodeEl) {
      const id = nodeEl.dataset.node!
      const now = e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : selected.includes(id) ? selected : [id]
      select(now)
      drag.current = { kind: 'nodes', x: e.clientX, y: e.clientY, moved: false, start: new Map(chaser.nodes.filter((n) => now.includes(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])) }
      return
    }
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false, start: new Map([['view', { x: view.x, y: view.y }]]) }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing) {
      const [x, y] = toWorld(e)
      setDrawing({ ...drawing, x, y, over: nodeAt(e) })
      return
    }
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    if (d.kind === 'pan') {
      const from = d.start.get('view')!
      setView((v) => ({ ...v, x: from.x + dx, y: from.y + dy }))
    } else {
      editChaser(
        chaser.id,
        {
          nodes: chaser.nodes.map((n) => {
            const from = d.start.get(n.id)
            return from ? { ...n, x: snap(from.x + dx / view.k), y: snap(from.y + dy / view.k) } : n
          })
        },
        `flow-move-${chaser.id}`
      )
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (drawing) {
      const to = nodeAt(e)
      if (to) editChaser(chaser.id, link(chaser, drawing.from, to))
      setDrawing(null)
      return
    }
    const d = drag.current
    drag.current = null
    // A click on the empty chart lets go of the selection.
    if (d?.kind === 'pan' && !d.moved) select([])
  }
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Pinch, or wheel with a modifier: zoom about the pointer.
      const r = box.current!.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      setView((v) => {
        const k = Math.min(1.6, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.01)))
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
      })
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
  }

  const empty = chaser.nodes.length === 1

  return (
    <div className="flow-dock">
      <div className="flow-tools">
        <button className="button small ghost" title="Add a scene behind the selected node, or at the end" onClick={() => add('scene')}>
          <Plus size={14} /> Scene
        </button>
        <button className="button small ghost" title="Add a wait: time passes, nothing is shown" onClick={() => add('wait')}>
          <Hourglass size={13} /> Wait
        </button>
        <button className="button small ghost" title="Search the scenes and add many of them in a row" disabled={looks.length === 0} onClick={() => setPicking(true)}>
          <ListPlus size={14} /> Scenes…
        </button>
        <button className="icon" title="Show the whole flow" onClick={fit}>
          <Maximize2 size={14} />
        </button>
        <span className="flow-help">
          {empty
            ? 'Add scenes. They play one after the other, in tempo, from the moment the note arrives.'
            : 'Drag from the dot of a node onto another node to say what comes next. Several arrows start several nodes at once; an arrow back makes a loop.'}
        </span>
      </div>

      <div ref={box} className={`flow${drawing ? ' drawing' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
        <div className="flow-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="flow-links" aria-hidden>
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1 L9 5 L0 9 Z" />
              </marker>
              <marker id="flow-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1 L9 5 L0 9 Z" />
              </marker>
            </defs>
            {chaser.links.map((l) => {
              const a = byId.get(l.from)
              const b = byId.get(l.to)
              if (!a || !b) return null
              const d = arrowPath(outOf(a), into(b))
              const on = pickedLink?.from === l.from && pickedLink.to === l.to
              return (
                <g key={`${l.from}>${l.to}`} className={`flow-link${on ? ' on' : ''}`}>
                  <path className="line" d={d} markerEnd={`url(#flow-arrow${on ? '-on' : ''})`} />
                  {/* A wide invisible line to click on. */}
                  <path
                    className="hit"
                    d={d}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setPickedLink(l)
                      set({ flowNodes: [] })
                    }}
                  />
                </g>
              )
            })}
            {drawing && byId.get(drawing.from) && <path className="flow-draft" d={arrowPath(outOf(byId.get(drawing.from)!), drawing.over && byId.get(drawing.over) ? into(byId.get(drawing.over)!) : [drawing.x, drawing.y])} markerEnd="url(#flow-arrow-on)" />}
          </svg>

          {chaser.nodes.map((n) => {
            const look = looks.find((l) => l.id === n.lookId)
            const outs = nextOf(chaser, n.id).length
            const classes = `flow-node ${n.kind}${selected.includes(n.id) ? ' on' : ''}${playing.includes(n.id) ? ' playing' : ''}${drawing?.over === n.id ? ' target' : ''}`
            return (
              <div key={n.id} data-node={n.id} className={classes} style={{ left: n.x, top: n.y, width: n.kind === 'start' ? START_W : NODE_W, height: NODE_H, '--look': look?.color ?? 'var(--raised-2)' } as React.CSSProperties}>
                {n.kind === 'start' ? (
                  <>
                    <Play size={13} />
                    <span className="flow-name">On note</span>
                  </>
                ) : (
                  <>
                    <span className="flow-chip" />
                    <span className="flow-text">
                      <span className="flow-name">{n.kind === 'wait' ? 'Wait' : (look?.name ?? 'Dark')}</span>
                      <span className="flow-meta">{beatLabel(n.beats)}</span>
                    </span>
                  </>
                )}
                {n.next === 'one' && outs > 1 && (
                  <span className="flow-random" title="Starts one of the nodes it points to, drawn at random">
                    <Shuffle size={11} />
                  </span>
                )}
                <span className="flow-port" data-port={n.id} title="Drag onto the node that comes next" />
              </div>
            )
          })}
        </div>
        {!preview && <span className="flow-note">Preview is off: switch on the eye in the panel on the right to watch it run.</span>}
      </div>

      {picking && (
        <AddStepsDialog
          beats={anchor(chaser, selected).kind === 'start' ? 1 : anchor(chaser, selected).beats}
          onClose={() => setPicking(false)}
          onAdd={(ids, beats) => {
            const { graph, added } = appendChain(chaser, anchor(chaser, selected).id, ids, beats)
            editChaser(chaser.id, graph)
            select(added)
          }}
        />
      )}
    </div>
  )
}
