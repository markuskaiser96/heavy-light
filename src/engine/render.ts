import { customKey, resolveEffect } from '@shared/custom'
import { prepareParams, type EffectDef, type RenderArgs } from '@shared/effects'
import { imagePixels } from '@shared/images'
import { mapImage, mapLayer, type Patch } from '@shared/patch'
import type { Blend, Layer, Mapping, Show } from '@shared/types'

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
  /** Beats since the look started. */
  beat: number
}

/** Stands in for a look while a custom effect is tried out on its own in the Effects tab. */
export const EFFECT_PREVIEW = '#effect-preview'

/** Renders active looks into one RGB float frame (one triple per patched cell). */
export class LookRenderer {
  private layers = new Map<string, CompiledLayer[]>()
  /** Look ids in show order: later looks are drawn on top. */
  readonly order: string[]

  constructor(
    private show: Show,
    private patch: Patch
  ) {
    this.order = [...show.looks.map((l) => l.id), EFFECT_PREVIEW]
    for (const look of show.looks) {
      this.layers.set(
        look.id,
        look.layers.flatMap((layer) => this.compile(layer) ?? [])
      )
    }
  }

  private compile(layer: Layer): CompiledLayer | null {
    const { show, patch } = this
    const def = resolveEffect(show.effects, layer.effect)
    if (!def) return null
    const { cells, u } = mapLayer(show, patch, layer)
    if (cells.length === 0) return null
    const args: CompiledLayer['args'] = { out: new Float32Array(cells.length * 3), u, count: cells.length, t: 0, p: prepareParams(def, layer.params) }
    if (def.id === 'image') {
      const id = String(layer.params.image ?? '')
      const asset = show.images[id]
      if (asset) {
        args.image = { width: asset.width, height: asset.height, pixels: imagePixels(id, asset) }
        Object.assign(args, mapImage(show, patch, layer))
      }
    }
    return { def, cells, blend: layer.blend, opacity: Math.min(1, Math.max(0, layer.opacity)), args }
  }

  /** Puts one custom effect on every fixture, to be shown as EFFECT_PREVIEW. null clears it. */
  previewEffect(id: string | null, mapping: Mapping): void {
    const layer = id === null ? null : this.compile({ id: EFFECT_PREVIEW, effect: customKey(id), params: {}, targets: [], mapping, blend: 'normal', opacity: 1 })
    this.layers.set(EFFECT_PREVIEW, layer ? [layer] : [])
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
        layer.args.beat = a.beat
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
