import { PANEL_DEFAULTS, useStore, type PanelName } from '../store'

/** Drag handle on the inner edge of a side panel. Double-click restores the default width. */
export function Resizer({ panel }: { panel: PanelName }) {
  const setPanel = useStore((s) => s.setPanel)
  const grows = panel === 'left' ? 1 : -1

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    const from = useStore.getState().panels[panel]
    const x = e.clientX
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('dragging')
    const move = (m: PointerEvent) => setPanel(panel, from + (m.clientX - x) * grows)
    const stop = () => {
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  return (
    <div
      className={`resizer ${panel === 'left' ? 'left' : 'right'}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize. Double-click to reset."
      onPointerDown={start}
      onDoubleClick={() => setPanel(panel, PANEL_DEFAULTS[panel])}
    />
  )
}
