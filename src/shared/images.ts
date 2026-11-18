import type { ImageAsset } from './types'

/**
 * Images used by the "Image" effect. They are stored inside the show as small raw RGB bitmaps,
 * so the engine needs no image decoder and a show stays a single file.
 */

/** Longest side of a stored image in pixels. Fixtures have far fewer pixels than this across. */
export const IMAGE_MAX_SIDE = 128

export function encodeImage(name: string, width: number, height: number, rgb: Uint8Array): ImageAsset {
  let binary = ''
  for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000))
  return { name, width, height, data: btoa(binary) }
}

const cache = new Map<string, { data: string; pixels: Uint8Array }>()

/** RGB bytes of an image, row by row from the top. Decoded once per image and kept. */
export function imagePixels(id: string, asset: ImageAsset): Uint8Array {
  const hit = cache.get(id)
  if (hit && hit.data === asset.data) return hit.pixels
  const binary = atob(asset.data)
  const pixels = new Uint8Array(asset.width * asset.height * 3)
  const n = Math.min(pixels.length, binary.length)
  for (let i = 0; i < n; i++) pixels[i] = binary.charCodeAt(i)
  cache.set(id, { data: asset.data, pixels })
  return pixels
}

export function isImageAsset(value: unknown): value is ImageAsset {
  const a = value as ImageAsset
  return typeof a === 'object' && a !== null && typeof a.data === 'string' && Number.isInteger(a.width) && Number.isInteger(a.height) && a.width > 0 && a.height > 0
}
