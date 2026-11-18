import { EFFECT_BY_ID, prepareParams, type EffectDef, type RenderArgs } from '@shared/effects'
import { imagePixels } from '@shared/images'
import { mapImage, mapLayer, type Patch } from '@shared/patch'
import type { Blend, Show } from '@shared/types'

interface CompiledLayer {
  def: EffectDef
  args: RenderArgs
  cells: Uint32Array
  blend: Blend
  opacity: number
}

export interface ActiveLook {
  lookId: string
  /** 0..1, fade level × intensity. */
  level: number
  /** Seconds since the look started. */
  t: number
}

/** Renders active looks into one RGB float frame (one triple per patched cell). */
export class LookRenderer {
  private layers = new Map<string, CompiledLayer[]>()
  /** Look ids in show order: later looks are drawn on top. */
  readonly order: string[]

  constructor(show: Show, patch: Patch) {
    this.order = show.looks.map((l) => l.id)
    for (const look of show.looks) {
      const compiled: CompiledLayer[] = []
      for (const layer of look.layers) {
        const def = EFFECT_BY_ID.get(layer.effect)
        if (!def) continue
        const { cells, u } = mapLayer(show, patch, layer)
        if (cells.length === 0) continue
        const args: CompiledLayer['args'] = { out: new Float32Array(cells.length * 3), u, count: cells.length, t: 0, p: prepareParams(def, layer.params) }
        if (def.id === 'image') {
          const id = String(layer.params.image ?? '')
          const asset = show.images[id]
          if (asset) {
            args.image = { width: asset.width, height: asset.height, pixels: imagePixels(id, asset) }
            Object.assign(args, mapImage(show, patch, layer))
          }
        }
        compiled.push({ def, cells, blend: layer.blend, opacity: Math.min(1, Math.max(0, layer.opacity)), args })
      }
      this.layers.set(look.id, compiled)
    }
  }

  /** `active` must be sorted in show order. */
  render(frame: Float32Array, active: ActiveLook[]): void {
    frame.fill(0)
    for (const a of active) {
      const layers = this.layers.get(a.lookId)
      if (!layers) continue
      for (const layer of layers) {
        const alpha = layer.opacity * a.level
        if (alpha <= 0) continue
        layer.args.t = a.t
        layer.def.render(layer.args)
        blend(frame, layer.args.out, layer.cells, layer.blend, alpha)
      }
    }
  }
}

function blend(frame: Float32Array, src: Float32Array, cells: Uint32Array, mode: Blend, alpha: number): void {
  const n = cells.length
  switch (mode) {
    case 'add':
      for (let i = 0; i < n; i++) {
        const o = cells[i] * 3
        frame[o] += src[i * 3] * alpha
        frame[o + 1] += src[i * 3 + 1] * alpha
        frame[o + 2] += src[i * 3 + 2] * alpha
      }
      break
    case 'max':
      for (let i = 0; i < n; i++) {
        const o = cells[i] * 3
        frame[o] = Math.max(frame[o], src[i * 3] * alpha)
        frame[o + 1] = Math.max(frame[o + 1], src[i * 3 + 1] * alpha)
        frame[o + 2] = Math.max(frame[o + 2], src[i * 3 + 2] * alpha)
      }
      break
    case 'multiply':
      for (let i = 0; i < n; i++) {
        const o = cells[i] * 3
        frame[o] *= 1 - alpha + src[i * 3] * alpha
        frame[o + 1] *= 1 - alpha + src[i * 3 + 1] * alpha
        frame[o + 2] *= 1 - alpha + src[i * 3 + 2] * alpha
      }
      break
    default:
      for (let i = 0; i < n; i++) {
        const o = cells[i] * 3
        frame[o] += (src[i * 3] - frame[o]) * alpha
        frame[o + 1] += (src[i * 3 + 1] - frame[o + 1]) * alpha
        frame[o + 2] += (src[i * 3 + 2] - frame[o + 2]) * alpha
      }
  }
}
