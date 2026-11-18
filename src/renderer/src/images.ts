import { encodeImage, IMAGE_MAX_SIDE, imagePixels } from '@shared/images'
import type { ImageAsset } from '@shared/types'

/** Reads a picture file and shrinks it to what the show stores: at most IMAGE_MAX_SIDE pixels on its longer side. */
export async function loadImageFile(file: File): Promise<ImageAsset> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  // Transparent areas become black, i.e. no light.
  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const rgba = context.getImageData(0, 0, width, height).data
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4]
    rgb[i * 3 + 1] = rgba[i * 4 + 1]
    rgb[i * 3 + 2] = rgba[i * 4 + 2]
  }
  return encodeImage(file.name.replace(/\.[^.]+$/, ''), width, height, rgb)
}

const canvases = new WeakMap<ImageAsset, HTMLCanvasElement>()
const urls = new WeakMap<ImageAsset, string>()

/** The stored image drawn on a canvas, for thumbnails and for the frame on the 3D stage. */
export function imageCanvas(id: string, asset: ImageAsset): HTMLCanvasElement {
  let canvas = canvases.get(asset)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = asset.width
  canvas.height = asset.height
  const pixels = imagePixels(id, asset)
  const data = new ImageData(asset.width, asset.height)
  for (let i = 0; i < asset.width * asset.height; i++) {
    data.data[i * 4] = pixels[i * 3]
    data.data[i * 4 + 1] = pixels[i * 3 + 1]
    data.data[i * 4 + 2] = pixels[i * 3 + 2]
    data.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(data, 0, 0)
  canvases.set(asset, canvas)
  return canvas
}

export function imageUrl(id: string, asset: ImageAsset): string {
  let url = urls.get(asset)
  if (!url) {
    url = imageCanvas(id, asset).toDataURL()
    urls.set(asset, url)
  }
  return url
}
