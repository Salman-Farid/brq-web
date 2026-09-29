import { MAX_BYTES, TARGET_BYTES } from '../types'

/** Load a File into an ImageBitmap (honors EXIF orientation via from-image). */
export async function loadImageSource(file: File): Promise<{
  bitmap: ImageBitmap
  width: number
  height: number
}> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
  }
}

/** Draw any canvas source into a new canvas at the given size. */
export function toCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to encode image'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export { MAX_BYTES, TARGET_BYTES }
