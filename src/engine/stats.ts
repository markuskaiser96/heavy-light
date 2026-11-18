import type { TimingStats } from '@shared/types'

/** Ring buffer of recent timing samples (milliseconds). */
export class Samples {
  private data: Float32Array
  private next = 0
  private filled = 0

  constructor(
    size: number,
    private bucketMs: number,
    private bucketCount: number
  ) {
    this.data = new Float32Array(size)
  }

  add(ms: number): void {
    this.data[this.next] = ms
    this.next = (this.next + 1) % this.data.length
    if (this.filled < this.data.length) this.filled++
  }

  summary(): TimingStats {
    const buckets = new Array<number>(this.bucketCount).fill(0)
    if (this.filled === 0) return { count: 0, p50: 0, p99: 0, max: 0, buckets, bucketMs: this.bucketMs }
    const sorted = Array.from(this.data.subarray(0, this.filled)).sort((a, b) => a - b)
    for (const v of sorted) buckets[Math.min(this.bucketCount - 1, Math.floor(v / this.bucketMs))]++
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: this.filled, p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1], buckets, bucketMs: this.bucketMs }
  }
}
