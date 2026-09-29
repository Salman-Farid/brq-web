import type { Point, Quad } from '../types'

/**
 * Perspective warp + CamScanner-style Magic Color enhancement.
 * Enhancement always keeps natural colors (never grayscale / B&W).
 */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function orderQuadPoints(pts: Point[]): Quad {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  )
  let start = 0
  let best = Infinity
  for (let i = 0; i < 4; i++) {
    const s = sorted[i].x + sorted[i].y
    if (s < best) {
      best = s
      start = i
    }
  }
  return {
    tl: sorted[start],
    tr: sorted[(start + 1) % 4],
    br: sorted[(start + 2) % 4],
    bl: sorted[(start + 3) % 4],
  }
}

/**
 * Output size from the quad's real side lengths — preserves the document's
 * exact natural aspect ratio with no padding and no forced dimensions.
 */
export function documentOutputSize(q: Quad): { width: number; height: number } {
  const top = Math.hypot(q.tr.x - q.tl.x, q.tr.y - q.tl.y)
  const bottom = Math.hypot(q.br.x - q.bl.x, q.br.y - q.bl.y)
  const left = Math.hypot(q.bl.x - q.tl.x, q.bl.y - q.tl.y)
  const right = Math.hypot(q.br.x - q.tr.x, q.br.y - q.tr.y)
  return {
    width: clamp(Math.round(Math.max(top, bottom)), 48, 8000),
    height: clamp(Math.round(Math.max(left, right)), 48, 8000),
  }
}

function computeHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }

  const n = 8
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (pivot !== col) {
      const tmp = M[col]
      M[col] = M[pivot]
      M[pivot] = tmp
    }
    const div = M[col][col] || 1e-12
    for (let c = col; c <= n; c++) M[col][c] /= div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (!factor) continue
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }
  const h = M.map((row) => row[n])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

function invertH(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const G = b * f - c * e
  const Hh = -(a * f - c * d)
  const I = a * e - b * d
  const det = a * A + b * B + c * C || 1e-12
  return [A / det, D / det, G / det, B / det, E / det, Hh / det, C / det, F / det, I / det]
}

export interface WarpResult {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/**
 * True when the warped scan's corners look like document content
 * (paper, letterhead bar, stamp) rather than a leaked background.
 * Accepts bright neutrals OR saturated letterhead colors — rejects
 * only very dark (shadow) or clearly out-of-place values.
 */
export function cornersLookLikePaper(
  canvas: HTMLCanvasElement,
  sourceData: Uint8ClampedArray,
  sourceW: number,
  sourceH: number,
): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false

  // Dominant source background
  const hist = new Map<number, number>()
  const step = Math.max(1, (Math.min(sourceW, sourceH) / 50) | 0)
  for (let x = 0; x < sourceW; x += step) {
    for (const y of [0, sourceH - 1]) {
      const p = (y * sourceW + x) * 4
      const q =
        ((sourceData[p] >> 5) << 10) |
        ((sourceData[p + 1] >> 5) << 5) |
        (sourceData[p + 2] >> 5)
      hist.set(q, (hist.get(q) ?? 0) + 1)
    }
  }
  let bestQ = 0
  let bestN = 0
  for (const [q, n] of hist) {
    if (n > bestN) {
      bestN = n
      bestQ = q
    }
  }
  const bgR = ((bestQ >> 10) & 0x1f) * 8
  const bgG = ((bestQ >> 5) & 0x1f) * 8
  const bgB = (bestQ & 0x1f) * 8

  const w = canvas.width
  const h = canvas.height
  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.015))
  const points: Array<[number, number]> = [
    [pad, pad],
    [w - 1 - pad, pad],
    [w - 1 - pad, h - 1 - pad],
    [pad, h - 1 - pad],
  ]

  for (const [x, y] of points) {
    const d = ctx.getImageData(x, y, 1, 1).data
    const r = d[0]
    const g = d[1]
    const b = d[2]
    const mx = Math.max(r, g, b)
    if (mx < 40) return false // dark shadow leak

    // If this corner is basically the source background → leak
    const dr = r - bgR
    const dg = g - bgG
    const db = b - bgB
    const dist = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)
    if (dist < 50) return false
  }
  return true
}

/**
 * Inverse projective map with bilinear sampling.
 * Output rectangle matches the document's natural proportions.
 */
export function warpToDocument(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  quad: Quad,
): WarpResult {
  const q = orderQuadPoints([quad.tl, quad.tr, quad.br, quad.bl])
  const { width: outW, height: outH } = documentOutputSize(q)

  const srcPts: Point[] = [q.tl, q.tr, q.br, q.bl]
  const dstPts: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]

  const H = computeHomography(srcPts, dstPts)
  const Hinv = invertH(H)

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outW
  outCanvas.height = outH
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) throw new Error('Canvas 2D context unavailable')
  const outImage = outCtx.createImageData(outW, outH)
  const outData = outImage.data

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = srcWidth
  srcCanvas.height = srcHeight
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  if (!srcCtx) throw new Error('Canvas 2D context unavailable')
  srcCtx.drawImage(source, 0, 0, srcWidth, srcHeight)
  const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight).data

  const maxX = srcWidth - 1
  const maxY = srcHeight - 1

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = Hinv[6] * x + Hinv[7] * y + Hinv[8]
      const sx = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w
      const sy = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w

      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(maxX, x0 + 1)
      const y1 = Math.min(maxY, y0 + 1)
      const fx = clamp(sx - x0, 0, 1)
      const fy = clamp(sy - y0, 0, 1)
      const ix0 = clamp(x0, 0, maxX)
      const iy0 = clamp(y0, 0, maxY)

      const i00 = (iy0 * srcWidth + ix0) * 4
      const i10 = (iy0 * srcWidth + x1) * 4
      const i01 = (y1 * srcWidth + ix0) * 4
      const i11 = (y1 * srcWidth + x1) * 4
      const o = (y * outW + x) * 4

      for (let c = 0; c < 4; c++) {
        const v00 = srcData[i00 + c]
        const v10 = srcData[i10 + c]
        const v01 = srcData[i01 + c]
        const v11 = srcData[i11 + c]
        const v0 = v00 + (v10 - v00) * fx
        const v1 = v01 + (v11 - v01) * fx
        outData[o + c] = v0 + (v1 - v0) * fy
      }
    }
  }

  outCtx.putImageData(outImage, 0, 0)
  return { canvas: outCanvas, width: outW, height: outH }
}

/* ------------------------------------------------------------------ */
/* Minimal touch-up — brightness only                                  */
/* ------------------------------------------------------------------ */

/**
 * Gentle scan clean-up — lift the dark cast, keep colors natural.
 * Shadows brighten more than highlights (clear, not “burned”).
 */
export function magicColorEnhance(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas
  const w = canvas.width
  const h = canvas.height
  if (w < 8 || h < 8) return canvas

  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  // Soft shadow lift (gamma) — clear the dark vibe without crushing colors
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    // pow < 1 brightens; blend keeps highlights safe
    const lifted = Math.pow(x, 0.72)
    lut[i] = clamp(Math.round((x * 0.25 + lifted * 0.75) * 255), 0, 255)
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]
    d[i + 1] = lut[d[i + 1]]
    d[i + 2] = lut[d[i + 2]]
  }

  ctx.putImageData(img, 0, 0)
  return canvas
}
