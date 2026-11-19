import { useEffect } from 'react'
import { customId, oneShotSeconds } from '@shared/custom'
import type { CustomEffect, Look } from '@shared/types'
import { useStore, type State } from '../store'

/** Pause between two runs of a one-shot in a preview, in seconds. */
export const REPLAY_PAUSE = 0.6

const tempo = (s: State): number => s.status?.clock?.bpm ?? s.show.settings.bpm

/** How long the one-shot parts of an effect take right now, or null if it has none. */
export const effectReplay = (s: State, effect: CustomEffect | undefined): number | null => (effect ? oneShotSeconds(effect, tempo(s)) : null)

/** The same for a look: the longest one-shot among the effects of its layers. */
export function lookReplay(s: State, look: Look | undefined): number | null {
  let longest: number | null = null
  for (const layer of look?.layers ?? []) {
    const effect = s.show.effects.find((e) => e.id === customId(layer.effect))
    const seconds = effect ? oneShotSeconds(effect, tempo(s)) : null
    if (seconds === null) continue
    const speed = typeof layer.params.speed === 'number' && layer.params.speed > 0 ? layer.params.speed : 1
    longest = Math.max(longest ?? 0, seconds / speed)
  }
  return longest
}

/**
 * Something that runs only once per MIDI note would be over right after it was selected. While it
 * is previewed on stage, start it again and again, with a short pause.
 */
export function useReplay(seconds: number | null): void {
  const preview = useStore((s) => s.preview)
  useEffect(() => {
    if (seconds === null || !preview) return
    const timer = setInterval(() => window.heavy.send({ type: 'restartPreview' }), (seconds + REPLAY_PAUSE) * 1000)
    return () => clearInterval(timer)
  }, [seconds, preview])
}
