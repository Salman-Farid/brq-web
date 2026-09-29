import { MAX_BYTES } from '../types'
import { canvasToBlob } from './image'

export interface CompressResult {
  blob: Blob
  quality: number
  width: number
  height: number
  usedDownscale: boolean
}

/**
 * Encode as JPEG strictly under 400 KB while KEEPING full resolution whenever possible.
 *
 * Order of preference:
 *  1. Full resolution at the highest quality that fits (down to q=0.2)
 *  2. Only if even q=0.2 exceeds 400 KB, proportionally downscale and retry
 */
export async function compressToJpegUnderLimit(
  canvas: HTMLCanvasElement,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  const aspect = canvas.height / Math.max(1, canvas.width)

  // 1) Fight for full resolution first — only shrink if q=0.55 still exceeds budget
  onProgress?.(10)
  const full = await searchQuality(canvas)
  if (full) {
    onProgress?.(100)
    return {
      blob: full.blob,
      quality: full.quality,
      width: canvas.width,
      height: canvas.height,
      usedDownscale: false,
    }
  }

  // 2) Mild proportional shrink only (keep as much resolution as possible)
  const scales = [0.95, 0.9, 0.85, 0.8, 0.72, 0.65, 0.55]
  for (let s = 0; s < scales.length; s++) {
    const scale = scales[s]
    const w = Math.max(64, Math.round(canvas.width * scale))
    const h = Math.max(64, Math.round(w * aspect))

    const working = document.createElement('canvas')
    working.width = w
    working.height = h
    const ctx = working.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    if (scale < 0.6) {
      const midW = Math.round(canvas.width * 0.72)
      const midH = Math.round(midW * aspect)
      const mid = document.createElement('canvas')
      mid.width = midW
      mid.height = midH
      const mctx = mid.getContext('2d')
      if (!mctx) throw new Error('Canvas 2D context unavailable')
      mctx.imageSmoothingEnabled = true
      mctx.imageSmoothingQuality = 'high'
      mctx.drawImage(canvas, 0, 0, midW, midH)
      ctx.drawImage(mid, 0, 0, w, h)
    } else {
      ctx.drawImage(canvas, 0, 0, w, h)
    }

    onProgress?.(20 + (s / scales.length) * 70)
    const attempt = await searchQuality(working)
    if (attempt) {
      onProgress?.(100)
      return {
        blob: attempt.blob,
        quality: attempt.quality,
        width: w,
        height: h,
        usedDownscale: true,
      }
    }
  }

  // Last resort
  const w = 400
  const h = Math.max(64, Math.round(w * aspect))
  const tiny = document.createElement('canvas')
  tiny.width = w
  tiny.height = h
  const tctx = tiny.getContext('2d')
  if (!tctx) throw new Error('Canvas 2D context unavailable')
  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(canvas, 0, 0, w, h)
  for (const q of [0.35, 0.28, 0.2]) {
    const blob = await canvasToBlob(tiny, 'image/jpeg', q)
    if (blob.size < MAX_BYTES) {
      onProgress?.(100)
      return { blob, quality: q, width: w, height: h, usedDownscale: true }
    }
  }
  throw new Error('Could not compress below 400 KB')
}

interface QualityAttempt {
  blob: Blob
  quality: number
}

/**
 * Highest JPEG quality strictly under MAX_BYTES, at this canvas size.
 * Quality floor is 0.55 so we never crush an image that still fits in budget.
 */
async function searchQuality(canvas: HTMLCanvasElement): Promise<QualityAttempt | null> {
  const MIN_Q = 0.35
  const MAX_Q = 0.97

  // If even minimum quality is too big at this resolution → need downscale
  const lowest = await canvasToBlob(canvas, 'image/jpeg', MIN_Q)
  if (lowest.size >= MAX_BYTES) return null

  // Highest quality already fits → take it (full res + max quality)
  const highest = await canvasToBlob(canvas, 'image/jpeg', MAX_Q)
  if (highest.size < MAX_BYTES) {
    return { blob: highest, quality: MAX_Q }
  }

  // Binary search the highest quality that fits under MAX_BYTES
  let lo = MIN_Q
  let hi = MAX_Q
  let best: QualityAttempt = { blob: lowest, quality: MIN_Q }

  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2
    const blob = await canvasToBlob(canvas, 'image/jpeg', mid)
    if (blob.size < MAX_BYTES) {
      best = { blob, quality: mid }
      lo = mid
    } else {
      hi = mid
    }
  }

  if (best.blob.size >= MAX_BYTES) {
    const q = Math.max(MIN_Q, best.quality - 0.08)
    const tighter = await canvasToBlob(canvas, 'image/jpeg', q)
    if (tighter.size < MAX_BYTES) return { blob: tighter, quality: q }
    return null
  }

  return best
}
