/**
 * Randomness that is a pure function of its inputs: the same beat gives the same result, so the
 * preview, the 3D view and the output always agree, and nothing has to be remembered between frames.
 */

/** A number from 0 up to (not including) 1 for a pair of whole numbers. */
export function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** A seed from a text, e.g. an id, so different layers and effects draw differently. */
export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h | 0
}

/**
 * Draws from `n` things like from a shuffled deck: `draw(q)` is the q-th card. Every thing comes
 * up once per round of n draws, and never twice in a row.
 */
export function makeDraw(n: number, seed: number): (q: number) => number {
  let cachedRound = -1
  let cached: number[] = []
  const shuffle = (round: number): number[] => {
    const order = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(hash01(round * 131 + i, seed) * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return order
  }
  return (q) => {
    if (n <= 1) return 0
    q = Math.max(0, Math.floor(q))
    // Two things can only alternate.
    if (n === 2) return (q + (seed & 1)) % 2
    const round = Math.floor(q / n)
    if (round !== cachedRound) {
      cached = shuffle(round)
      // A round must not start with what the round before ended on. The middle card is never the last one.
      if (round > 0 && cached[0] === shuffle(round - 1)[n - 1]) {
        const mid = n >> 1
        ;[cached[0], cached[mid]] = [cached[mid], cached[0]]
      }
      cachedRound = round
    }
    return cached[q % n]
  }
}
