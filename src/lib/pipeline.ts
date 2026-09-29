import type { ScanItem } from '../types'
import { MAX_BYTES } from '../types'
import { loadImageSource, toCanvas, clamp } from './image'
import { magicColorEnhance } from './perspective'
import { compressToJpegUnderLimit } from './compress'
import { sanitizeFilename } from './zip'
import {
  scanDocument,
  extractDocument,
  type ScannerResult,
  type CornerPoints,
} from 'scanic'

export type StageCallback = (
  status: ScanItem['status'],
  progress: number,
  stageLabel: string,
) => void

export interface ProcessResult {
  blob: Blob
  width: number
  height: number
  quality: number
  usedDownscale: boolean
  autoCropped: boolean
  keptOriginal: boolean
  durationMs: number
}

/**
 * Expand the detected quad outward so we keep ~1 cm of surrounding
 * background. That way text / stamps at the very edge are never cut.
 *
 * ~1cm on a typical 20cm-wide page ≈ 5% of the page → 2.5% per side.
 */
function expandCorners(corners: CornerPoints, padRatio = 0.028): CornerPoints {
  const xs = [corners.topLeft.x, corners.topRight.x, corners.bottomRight.x, corners.bottomLeft.x]
  const ys = [corners.topLeft.y, corners.topRight.y, corners.bottomRight.y, corners.bottomLeft.y]
  const cx = (xs[0] + xs[1] + xs[2] + xs[3]) / 4
  const cy = (ys[0] + ys[1] + ys[2] + ys[3]) / 4

  // Pad in px ≈ padRatio of the average side
  const side =
    (Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y) +
      Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y)) /
    2
  const pad = side * padRatio

  const expand = (p: { x: number; y: number }) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return {
      x: p.x + (dx / len) * pad,
      y: p.y + (dy / len) * pad,
    }
  }

  return {
    topLeft: expand(corners.topLeft),
    topRight: expand(corners.topRight),
    bottomRight: expand(corners.bottomRight),
    bottomLeft: expand(corners.bottomLeft),
  }
}

function clampQuad(corners: CornerPoints, w: number, h: number): CornerPoints {
  const cl = (p: { x: number; y: number }) => ({
    x: Math.min(w - 1, Math.max(0, p.x)),
    y: Math.min(h - 1, Math.max(0, p.y)),
  })
  return {
    topLeft: cl(corners.topLeft),
    topRight: cl(corners.topRight),
    bottomRight: cl(corners.bottomRight),
    bottomLeft: cl(corners.bottomLeft),
  }
}

/**
 * Scanic-powered CamScanner-style pipeline:
 * detect → expand ~1cm margin → perspective extract → Magic Color → JPG ≤ 400 KB
 * at the highest resolution that fits.
 */
export async function processImage(
  file: File,
  onStage?: StageCallback,
): Promise<ProcessResult> {
  const t0 = performance.now()

  onStage?.('loading', 5, 'Loading image')
  const source = await loadImageSource(file)

  const MAX_SIDE = 4000
  let drawW = source.width
  let drawH = source.height
  let drawCanvas: HTMLCanvasElement

  if (Math.max(source.width, source.height) > MAX_SIDE) {
    const s = MAX_SIDE / Math.max(source.width, source.height)
    drawW = Math.round(source.width * s)
    drawH = Math.round(source.height * s)
    drawCanvas = toCanvas(source.bitmap, drawW, drawH)
  } else {
    drawCanvas = toCanvas(source.bitmap, drawW, drawH)
  }

  onStage?.('detecting', 18, 'Detecting document')
  // ML corner detector is much stronger on cluttered backgrounds (fabric, desks).
  // Prefer it; fall back to classical WASM if the model fails to load.
  let tight = await tryScan(drawCanvas, 'ml', 'extract')
  if (!tight?.success || !tight.corners) {
    onStage?.('detecting', 28, 'Detecting edges')
    tight = await tryScan(drawCanvas, 'classical', 'extract')
  }

  let working: HTMLCanvasElement = drawCanvas
  let autoCropped = false

  if (tight?.success && tight.corners) {
    onStage?.('correcting', 48, 'Correcting perspective')
    const padded = clampQuad(expandCorners(tight.corners, 0.028), drawW, drawH)
    const expanded = await extractDocument(drawCanvas, padded, { output: 'canvas' })
    const cand =
      expanded.success && expanded.output instanceof HTMLCanvasElement
        ? expanded.output
        : tight.output instanceof HTMLCanvasElement
          ? tight.output
          : null
    // Only accept a clean page crop — never a warped non-document
    if (cand && isCleanDocumentCrop(cand)) {
      working = cand
      autoCropped = true
    }
  }

  // Fallback: white/neutral page or card on a colorful surface
  if (!autoCropped) {
    onStage?.('correcting', 50, 'Finding page')
    const whiteRegion = detectWhiteDocument(drawCanvas)
    if (whiteRegion) {
      const extracted = await extractDocument(
        drawCanvas,
        clampQuad(expandCorners(whiteRegion.quad, 0.028), drawW, drawH),
        { output: 'canvas' },
      )
      let cand =
        extracted.success && extracted.output instanceof HTMLCanvasElement
          ? extracted.output
          : null
      if (!cand || !isCleanDocumentCrop(cand)) {
        // Tight axis-aligned box around the white page/card (+ ~1cm margin)
        const box = whiteRegion.bbox
        const mx = Math.round(Math.min(drawW, drawH) * 0.02)
        const x0 = clamp(box.x - mx, 0, drawW)
        const y0 = clamp(box.y - mx, 0, drawH)
        const x1 = clamp(box.x + box.w + mx, 0, drawW)
        const y1 = clamp(box.y + box.h + mx, 0, drawH)
        if (x1 - x0 > 40 && y1 - y0 > 40) {
          const boxCanvas = document.createElement('canvas')
          boxCanvas.width = x1 - x0
          boxCanvas.height = y1 - y0
          const bctx = boxCanvas.getContext('2d')
          if (bctx) {
            bctx.drawImage(drawCanvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
            if (isCleanDocumentCrop(boxCanvas)) cand = boxCanvas
          }
        }
      }
      if (cand && isCleanDocumentCrop(cand)) {
        working = cand
        autoCropped = true
      }
    }
  }

  onStage?.('enhancing', 62, 'Magic Color')
  magicColorEnhance(working)

  onStage?.('compressing', 74, 'Optimizing JPG')
  const compressed = await compressToJpegUnderLimit(working, (p) => {
    onStage?.('compressing', 74 + p * 0.22, 'Optimizing JPG')
  })

  if (compressed.blob.size >= MAX_BYTES) {
    throw new Error('Could not compress below 400 KB')
  }

  source.bitmap.close?.()

  return {
    blob: compressed.blob,
    width: compressed.width,
    height: compressed.height,
    quality: compressed.quality,
    usedDownscale: compressed.usedDownscale,
    autoCropped,
    keptOriginal: !autoCropped,
    durationMs: Math.round(performance.now() - t0),
  }
}

async function tryScan(
  canvas: HTMLCanvasElement,
  detector: 'classical' | 'ml',
  mode: 'detect' | 'extract',
): Promise<ScannerResult | null> {
  try {
    return await scanDocument(canvas, {
      mode,
      output: 'canvas',
      detector,
      maxProcessingDimension: 1800,
      minDetectionConfidence: 0.18,
      minArea: 0.025,
      minDocumentCoverageRatio: 0.015,
      ml: { minScore: 0.22 },
    })
  } catch {
    return null
  }
}

/**
 * True only for a clean text/document page crop.
 * Rejects:
 *  - warped non-documents (fabric, clutter)
 *  - passport / person photos (center is a face, not paper)
 *  - general photos
 * Outer rim may be the intentional ~1cm background margin.
 */
function isCleanDocumentCrop(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  const w = canvas.width
  const h = canvas.height
  if (w < 80 || h < 80) return false

  const aspect = w / h
  if (aspect < 0.15 || aspect > 6) return false

  const x0 = Math.floor(w * 0.1)
  const y0 = Math.floor(h * 0.1)
  const iw = w - x0 * 2
  const ih = h - y0 * 2
  const sw = Math.min(150, Math.max(24, iw))
  const sh = Math.min(150, Math.max(24, ih))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })
  if (!sctx) return false
  sctx.drawImage(canvas, x0, y0, iw, ih, 0, 0, sw, sh)
  const data = sctx.getImageData(0, 0, sw, sh).data

  const cellPaper: number[] = new Array(9).fill(0)
  const cellN: number[] = new Array(9).fill(0)
  let paper = 0
  let colorful = 0
  let n = 0

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const sat = mx <= 0 ? 0 : (mx - mn) / mx
      // Paper / card / sleeve — match detectWhiteDocument thresholds
      // (cards under plastic are often ~180–210, not pure 250 white)
      const isPaper = (mx > 165 && sat < 0.2) || (mx > 200 && sat < 0.35)
      const isColorful = sat > 0.4 && mx > 70 && mx < 230
      if (isPaper) paper++
      if (isColorful) colorful++
      n++
      const cx = Math.min(2, Math.floor((x / sw) * 3))
      const cy = Math.min(2, Math.floor((y / sh) * 3))
      const ci = cy * 3 + cx
      cellN[ci]++
      if (isPaper) cellPaper[ci]++
    }
  }
  if (n === 0) return false

  // Text pages are paper-dominant with little saturated photo color
  if (paper / n < 0.45) return false
  if (colorful / n > 0.16) return false

  // Paper across nearly the whole page
  let paperCells = 0
  for (let i = 0; i < 9; i++) {
    if (cellN[i] > 0 && cellPaper[i] / cellN[i] >= 0.22) paperCells++
  }
  if (paperCells < 8) return false

  // Center must be paper too — passport photos have a face here
  if (cellN[4] > 0 && cellPaper[4] / cellN[4] < 0.18) return false

  return true
}

export function makeOutputName(originalName: string, index: number): string {
  return sanitizeFilename(originalName, index)
}

/**
 * Locate a white / light-neutral document on a colorful background
 * (ID cards, receipts, pages on fabric or wood).
 * Returns perspective corners plus an axis-aligned bbox of the paper.
 */
function detectWhiteDocument(
  canvas: HTMLCanvasElement,
): { quad: CornerPoints; bbox: { x: number; y: number; w: number; h: number } } | null {
  const maxW = 700
  const scale = Math.min(1, maxW / canvas.width)
  const w = Math.max(32, Math.round(canvas.width * scale))
  const h = Math.max(32, Math.round(canvas.height * scale))
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const sctx = small.getContext('2d', { willReadFrequently: true })
  if (!sctx) return null
  sctx.drawImage(canvas, 0, 0, w, h)
  const data = sctx.getImageData(0, 0, w, h).data

  // Binary mask: true paper/card neutrals only
  const mask = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const sat = mx <= 0 ? 0 : (mx - mn) / mx
    const isPaper =
      (mx >= 175 && sat < 0.1) ||
      (mx >= 130 && mx <= 215 && sat < 0.08)
    mask[i] = isPaper ? 1 : 0
  }

  // Close small holes (text)
  let cur = mask
  for (let it = 0; it < 2; it++) {
    const next = new Uint8Array(cur)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (cur[i]) continue
        if (
          cur[i - 1] || cur[i + 1] || cur[i - w] || cur[i + w] ||
          cur[i - w - 1] || cur[i - w + 1] || cur[i + w - 1] || cur[i + w + 1]
        ) {
          next[i] = 1
        }
      }
    }
    cur = next
  }

  const labels = new Int32Array(w * h).fill(-1)
  let best = -1
  let bestSize = 0
  let next = 0
  const stack: number[] = []
  for (let s = 0; s < cur.length; s++) {
    if (!cur[s] || labels[s] >= 0) continue
    const id = next++
    let size = 0
    stack.length = 0
    stack.push(s)
    labels[s] = id
    while (stack.length) {
      const i = stack.pop()!
      size++
      const x = i % w
      const y = (i / w) | 0
      const nb = [i - 1, i + 1, i - w, i + w]
      if (x === 0) nb[0] = -1
      if (x === w - 1) nb[1] = -1
      if (y === 0) nb[2] = -1
      if (y === h - 1) nb[3] = -1
      for (const j of nb) {
        if (j < 0 || j >= cur.length) continue
        if (cur[j] && labels[j] < 0) {
          labels[j] = id
          stack.push(j)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = id
    }
  }
  // Small ID cards count — 1% of the frame
  if (best < 0 || bestSize < w * h * 0.01) return null

  let minX = w, maxX = 0, minY = h, maxY = 0
  let tl = { x: 0, y: 0 }, tr = { x: 0, y: 0 }, br = { x: 0, y: 0 }, bl = { x: 0, y: 0 }
  let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== best) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const s = x + y
      const d = x - y
      if (s < minS) { minS = s; tl = { x, y } }
      if (s > maxS) { maxS = s; br = { x, y } }
      if (d < minD) { minD = d; bl = { x, y } }
      if (d > maxD) { maxD = d; tr = { x, y } }
    }
  }

  const inv = 1 / scale
  return {
    quad: {
      topLeft: { x: tl.x * inv, y: tl.y * inv },
      topRight: { x: tr.x * inv, y: tr.y * inv },
      bottomRight: { x: br.x * inv, y: br.y * inv },
      bottomLeft: { x: bl.x * inv, y: bl.y * inv },
    },
    bbox: {
      x: minX * inv,
      y: minY * inv,
      w: (maxX - minX) * inv,
      h: (maxY - minY) * inv,
    },
  }
}
