import { customKey, resolveEffect } from '@shared/custom'
import { makeDraw, seedOf } from '@shared/random'
import { defaultParams, prepareParams, type EffectDef, type RenderArgs } from '@shared/effects'
import { presetId } from '@shared/presets'
import { imagePixels } from '@shared/images'
import { mapImage, mapLayer, type Patch } from '@shared/patch'
import type { Blend, Layer, Mapping, Show } from '@shared/types'

interface CompiledLayer {
  def: EffectDef
  args: RenderArgs
  cells: Uint32Array
  blend: Blend
  opacity: number
  /** Which of the layer's fixtures each cell belongs to, and how many fixtures there are. */
  owner: Uint16Array
  /** Set if the layer plays on only some of its fixtures, drawn at random: which ones are on this frame. */
  pick: { count: number; beats: number; draw: (q: number) => number; on: Uint8Array } | null
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
    const { cells, u, owner, owners } = mapLayer(show, patch, layer)
    if (cells.length === 0) return null
    const args: CompiledLayer['args'] = { out: new Float32Array(cells.length * 3), u, owner, count: cells.length, t: 0, p: prepareParams(def, layer.params) }
    if (def.id === 'image') {
      const id = String(layer.params.image ?? '')
      const asset = show.images[id]
      if (asset) {
        args.image = { width: asset.width, height: asset.height, pixels: imagePixels(id, asset) }
        Object.assign(args, mapImage(show, patch, layer))
      }
    }
    const count = Math.round(layer.pick?.count ?? 0)
    // Fewer than all of them: otherwise there is nothing to draw lots for.
    const pick = layer.pick && count >= 1 && count < owners ? { count, beats: Math.max(1 / 64, layer.pick.beats), draw: makeDraw(owners, seedOf(layer.id)), on: new Uint8Array(owners) } : null
    return { def, cells, blend: layer.blend, opacity: Math.min(1, Math.max(0, layer.opacity)), args, owner, pick }
  }

  /** Puts one custom effect, or a preset (`preset:<id>`) with its default settings, on every fixture, to be shown as EFFECT_PREVIEW. null clears it. */
  previewEffect(id: string | null, mapping: Mapping): void {
    const effect = id === null ? '' : (presetId(id) ?? customKey(id))
    const layer = id === null ? null : this.compile({ id: EFFECT_PREVIEW, effect, params: defaultParams(effect), targets: [], mapping, blend: 'normal', opacity: 1 })
    this.layers.set(EFFECT_PREVIEW, layer ? [layer] : [])
  }

  /** `active` must be sorted in show order. With `onTop` the looks are drawn over what the frame already holds. */
  render(frame: Float32Array, active: ActiveLook[], onTop = false): void {
    if (!onTop) frame.fill(0)
    for (const a of active) {
      const layers = this.layers.get(a.lookId)
      if (!layers) continue
      for (const layer of layers) {
        const alpha = layer.opacity * a.level
        if (alpha <= 0) continue
        layer.args.t = a.t
        layer.args.beat = a.beat
        layer.def.render(layer.args)
        const pick = layer.pick
        if (pick) {
          // The same beat always draws the same fixtures, so every frame and every preview agree.
          const round = Math.floor(Math.max(0, a.beat) / pick.beats + 1e-6)
          pick.on.fill(0)
          for (let j = 0; j < pick.count; j++) pick.on[pick.draw(round * pick.count + j)] = 1
        }
        blend(frame, layer.args.out, layer.cells, layer.blend, alpha, pick ? layer.owner : null, pick ? pick.on : null)
      }
    }
  }
}

/** `on` (per fixture, looked up through `owner`) leaves out the cells of fixtures that are not playing: they keep what is below. */
function blend(frame: Float32Array, src: Float32Array, cells: Uint32Array, mode: Blend, alpha: number, owner: Uint16Array | null, on: Uint8Array | null): void {
  const n = cells.length
  switch (mode) {
    case 'add':
      for (let i = 0; i < n; i++) {
        if (on && !on[owner![i]]) continue
        const o = cells[i] * 3
        frame[o] += src[i * 3] * alpha
        frame[o + 1] += src[i * 3 + 1] * alpha
        frame[o + 2] += src[i * 3 + 2] * alpha
      }
      break
    case 'max':
      for (let i = 0; i < n; i++) {
        if (on && !on[owner![i]]) continue
        const o = cells[i] * 3
        frame[o] = Math.max(frame[o], src[i * 3] * alpha)
        frame[o + 1] = Math.max(frame[o + 1], src[i * 3 + 1] * alpha)
        frame[o + 2] = Math.max(frame[o + 2], src[i * 3 + 2] * alpha)
      }
      break
    case 'multiply':
      for (let i = 0; i < n; i++) {
        if (on && !on[owner![i]]) continue
        const o = cells[i] * 3
        frame[o] *= 1 - alpha + src[i * 3] * alpha
        frame[o + 1] *= 1 - alpha + src[i * 3 + 1] * alpha
        frame[o + 2] *= 1 - alpha + src[i * 3 + 2] * alpha
      }
      break
    default:
      for (let i = 0; i < n; i++) {
        if (on && !on[owner![i]]) continue
        const o = cells[i] * 3
        frame[o] += (src[i * 3] - frame[o]) * alpha
        frame[o + 1] += (src[i * 3 + 1] - frame[o + 1]) * alpha
        frame[o + 2] += (src[i * 3 + 2] - frame[o + 2]) * alpha
      }
  }
}
