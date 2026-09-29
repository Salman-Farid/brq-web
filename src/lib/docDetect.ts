import type { Point, Quad } from '../types'

/**
 * Aggressive document detector — ALWAYS crops when a document region exists.
 *
 * Pipeline: blur → paper mask (unlike background) → largest blob → fill holes →
 * convex hull → max-area quad → snap sides to strong edges.
 */

const DETECT_MAX_W = 900

export interface DetectResult {
  quad: Quad
  confidence: number
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v
}

function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114
  }
  return out
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const k = 1 / (r * 2 + 1)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + clamp(x, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc * k
      acc += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * k
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]
    }
  }
  return out
}

function sobel(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]
      mag[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }
  return mag
}

function otsu(values: Float32Array): number {
  const hist = new Float64Array(256)
  let maxV = 0
  for (let i = 0; i < values.length; i++) if (values[i] > maxV) maxV = values[i]
  if (maxV <= 1) return 128
  const scale = 255 / maxV
  for (let i = 0; i < values.length; i++) hist[clamp((values[i] * scale) | 0, 0, 255)]++
  const total = values.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      thr = t
    }
  }
  return thr / scale
}

/* ---------- geometry ---------- */

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function polygonArea(pts: Point[]): number {
  let area = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length <= 2) return pts
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function orderQuad(pts: Point[]): Quad {
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

function isConvexQuad(pts: Point[]): boolean {
  if (pts.length !== 4) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const c = cross(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4])
    if (Math.abs(c) < 1e-6) return false
    const s = c > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Max-area quad with vertices among hull points (O(n²)). */
function maxAreaQuad(hull: Point[]): Point[] | null {
  const n = hull.length
  if (n < 4) return null
  if (n === 4) return isConvexQuad(hull) ? hull : null
  const pts = n > 140 ? hull.filter((_, i) => i % Math.ceil(n / 140) === 0) : hull
  const m = pts.length
  if (m < 4) return null

  let bestArea = 0
  let best: Point[] | null = null

  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      let bestK = -1
      let bestL = -1
      let maxA = -1
      let maxB = -1
      for (let k = 0; k < m; k++) {
        if (k === i || k === j) continue
        const area = Math.abs(cross(pts[i], pts[j], pts[k]))
        const side = cross(pts[i], pts[j], pts[k])
        if (side > 0) {
          if (area > maxA) {
            maxA = area
            bestK = k
          }
        } else if (area > maxB) {
          maxB = area
          bestL = k
        }
      }
      if (bestK < 0 || bestL < 0) continue
      const q = orderQuad([pts[i], pts[bestK], pts[j], pts[bestL]])
      const qp = [q.tl, q.tr, q.br, q.bl]
      if (!isConvexQuad(qp)) continue
      const area = polygonArea(qp)
      if (area > bestArea) {
        bestArea = area
        best = qp
      }
    }
  }
  return best
}

function extremeFour(hull: Point[]): Point[] {
  let tl = hull[0],
    tr = hull[0],
    br = hull[0],
    bl = hull[0]
  let minS = Infinity,
    maxS = -Infinity,
    minD = Infinity,
    maxD = -Infinity
  for (const p of hull) {
    const s = p.x + p.y
    const d = p.x - p.y
    if (s < minS) {
      minS = s
      tl = p
    }
    if (s > maxS) {
      maxS = s
      br = p
    }
    if (d < minD) {
      minD = d
      bl = p
    }
    if (d > maxD) {
      maxD = d
      tr = p
    }
  }
  const q = orderQuad([tl, tr, br, bl])
  return [q.tl, q.tr, q.br, q.bl]
}

/* ---------- masks ---------- */

function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const i = y * w + x
      if (!mask[i] && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const i = y * w + x
      if (!mask[i] && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    const nb = [i - 1, i + 1, i - w, i + w]
    if (x === 0) nb[0] = -1
    if (x === w - 1) nb[1] = -1
    if (y === 0) nb[2] = -1
    if (y === h - 1) nb[3] = -1
    for (const j of nb) {
      if (j < 0 || j >= mask.length) continue
      if (!mask[j] && !outside[j]) {
        outside[j] = 1
        stack.push(j)
      }
    }
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0
  return out
}

function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const labels = new Int32Array(w * h).fill(-1)
  let bestLabel = -1
  let bestSize = 0
  let nextLabel = 0
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue
    const label = nextLabel++
    let size = 0
    stack.length = 0
    stack.push(start)
    labels[start] = label
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
        if (j < 0 || j >= mask.length) continue
        if (mask[j] && labels[j] < 0) {
          labels[j] = label
          stack.push(j)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      bestLabel = label
    }
  }
  const out = new Uint8Array(w * h)
  if (bestLabel < 0) return out
  for (let i = 0; i < out.length; i++) out[i] = labels[i] === bestLabel ? 1 : 0
  return out
}

function morphClose(mask: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  let cur = mask
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(cur)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (cur[i]) continue
        if (
          cur[i - 1] ||
          cur[i + 1] ||
          cur[i - w] ||
          cur[i + w] ||
          cur[i - w - 1] ||
          cur[i - w + 1] ||
          cur[i + w - 1] ||
          cur[i + w + 1]
        ) {
          next[i] = 1
        }
      }
    }
    cur = next
  }
  return cur
}

/**
 * Document = pixels that are NOT the photo background.
 * Background = dominant color of the image border ring.
 */
function docMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // Dominant border color
  const hist = new Map<number, number>()
  const step = Math.max(1, (Math.min(w, h) / 50) | 0)
  const push = (p: number) => {
    const q = ((data[p] >> 5) << 10) | ((data[p + 1] >> 5) << 5) | (data[p + 2] >> 5)
    hist.set(q, (hist.get(q) ?? 0) + 1)
  }
  for (let x = 0; x < w; x += step) {
    push((0 * w + x) * 4)
    push(((h - 1) * w + x) * 4)
  }
  for (let y = 0; y < h; y += step) {
    push((y * w + 0) * 4)
    push((y * w + w - 1) * 4)
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

  const mask = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const dr = r - bgR
    const dg = g - bgG
    const db = b - bgB
    const dist = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)

    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const sat = mx <= 0 ? 0 : (mx - mn) / mx

    // Paper / card / letterhead — anything clearly unlike the surrounding surface
    // Also accept bright neutrals (white paper on similar-toned surfaces)
    const isDoc = dist > 42 || (mx > 175 && sat < 0.4)
    mask[i] = isDoc ? 1 : 0
  }
  return mask
}

/** Bright-page mask as a second cue (white paper). */
function brightMask(gray: Float32Array, w: number, h: number): Uint8Array {
  const thr = otsu(gray)
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] >= thr ? 1 : 0
  return mask
}

function boundaryPoints(mask: Uint8Array, w: number, h: number): Point[] {
  const pts: Point[] = []
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 800)))
  for (let y = 1; y < h - 1; y += stride) {
    for (let x = 1; x < w - 1; x += stride) {
      const i = y * w + x
      if (!mask[i]) continue
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
        pts.push({ x, y })
      }
    }
  }
  // Axis extremes
  let minX: Point | null = null,
    maxX: Point | null = null,
    minY: Point | null = null,
    maxY: Point | null = null
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      const p = { x, y }
      if (!minX || x < minX.x) minX = p
      if (!maxX || x > maxX.x) maxX = p
      if (!minY || y < minY.y) minY = p
      if (!maxY || y > maxY.y) maxY = p
    }
  }
  for (const p of [minX, maxX, minY, maxY]) if (p) pts.push(p)
  return pts
}

function quadFromMask(mask: Uint8Array, w: number, h: number): Quad | null {
  // Largest blob first so noise doesn't merge with the page
  const blob = largestComponent(mask, w, h)
  let count = 0
  for (let i = 0; i < blob.length; i++) if (blob[i]) count++
  // Must be a real region: at least 5% of the frame, at most 97%
  if (count < w * h * 0.05 || count > w * h * 0.97) return null

  const filled = fillHoles(blob, w, h)
  const closed = morphClose(filled, w, h, 1)
  const solid = largestComponent(closed, w, h)

  const pts = boundaryPoints(solid, w, h)
  if (pts.length < 4) return null

  const hull = convexHull(pts)
  if (hull.length < 4) return null

  let quadPts = maxAreaQuad(hull)
  if (!quadPts && hull.length === 4) quadPts = hull
  if (!quadPts) quadPts = extremeFour(hull)

  const q = orderQuad(quadPts)
  const qp = [q.tl, q.tr, q.br, q.bl]
  if (!isConvexQuad(qp)) return null

  const area = polygonArea(qp)
  if (area < w * h * 0.04) return null

  return q
}

/* ---------- edge snap ---------- */

function refineQuadToEdges(q: Quad, mag: Float32Array, w: number, h: number): Quad {
  type Line = { a: number; b: number; c: number }
  const toLine = (p1: Point, p2: Point): Line => {
    const a = p2.y - p1.y
    const b = p1.x - p2.x
    const c = p2.x * p1.y - p1.x * p2.y
    return { a, b, c }
  }
  const norm = (l: Line): Line => {
    const s = Math.hypot(l.a, l.b) || 1
    return { a: l.a / s, b: l.b / s, c: l.c / s }
  }

  const sides: Array<[Point, Point]> = [
    [q.tl, q.tr],
    [q.tr, q.br],
    [q.br, q.bl],
    [q.bl, q.tl],
  ]

  const refined: Line[] = []
  for (const [p1, p2] of sides) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux

    const band = Math.max(3, Math.round(Math.min(w, h) * 0.025))
    let bestOffset = 0
    let bestScore = -1
    for (let off = -band; off <= band; off++) {
      let score = 0
      const steps = Math.min(40, Math.max(8, (len / 4) | 0))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const x = p1.x + ux * len * t + nx * off
        const y = p1.y + uy * len * t + ny * off
        const xi = Math.round(x)
        const yi = Math.round(y)
        if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) continue
        let m = 0
        for (let dy2 = -1; dy2 <= 1; dy2++) {
          for (let dx2 = -1; dx2 <= 1; dx2++) {
            const v = mag[(yi + dy2) * w + (xi + dx2)]
            if (v > m) m = v
          }
        }
        score += m
      }
      score /= steps + 1
      if (score > bestScore) {
        bestScore = score
        bestOffset = off
      }
    }
    const midX = (p1.x + p2.x) / 2 + nx * bestOffset
    const midY = (p1.y + p2.y) / 2 + ny * bestOffset
    refined.push(
      norm(
        toLine(
          { x: midX - ux * len, y: midY - uy * len },
          { x: midX + ux * len, y: midY + uy * len },
        ),
      ),
    )
  }

  const intersect = (l1: Line, l2: Line): Point | null => {
    const det = l1.a * l2.b - l2.a * l1.b
    if (Math.abs(det) < 1e-9) return null
    return {
      x: (l1.b * l2.c - l2.b * l1.c) / det,
      y: (l2.a * l1.c - l1.a * l2.c) / det,
    }
  }

  const tl = intersect(refined[3], refined[0])
  const tr = intersect(refined[0], refined[1])
  const br = intersect(refined[1], refined[2])
  const bl = intersect(refined[2], refined[3])
  if (!tl || !tr || !br || !bl) return q

  const cl = (p: Point): Point => ({
    x: clamp(Math.round(p.x), 0, w - 1),
    y: clamp(Math.round(p.y), 0, h - 1),
  })
  return orderQuad([cl(tl), cl(tr), cl(br), cl(bl)])
}

function scoreQuad(q: Quad, w: number, h: number): number {
  const pts = [q.tl, q.tr, q.br, q.bl]
  const area = polygonArea(pts)
  const frame = w * h
  if (area < frame * 0.05) return 0

  const top = dist(q.tl, q.tr)
  const bottom = dist(q.bl, q.br)
  const left = dist(q.tl, q.bl)
  const right = dist(q.tr, q.br)
  const sideBalance =
    (Math.min(top, bottom) / Math.max(1, Math.max(top, bottom)) +
      Math.min(left, right) / Math.max(1, Math.max(left, right))) /
    2

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const rectFill = area / Math.max(1, (maxX - minX) * (maxY - minY))

  const width = Math.max(top, bottom)
  const height = Math.max(left, right)
  const aspect = width / Math.max(1, height)
  const aspectScore = aspect > 0.15 && aspect < 6 ? 1 : 0.4

  return rectFill * 0.35 + sideBalance * 0.35 + aspectScore * 0.3
}

/**
 * Detect the document quad. Returns null ONLY if no plausible region exists.
 * Any decent crop is preferred over leaving the photo uncut.
 */
export function detectDocument(imageData: ImageData): DetectResult | null {
  const w = imageData.width
  const h = imageData.height
  const gray = toGray(imageData.data, w, h)
  const blurred = boxBlur(gray, w, h, 2)
  const mag = sobel(blurred, w, h)

  let bestQuad: Quad | null = null
  let bestScore = 0

  const tryMask = (mask: Uint8Array, boost: number) => {
    const q = quadFromMask(mask, w, h)
    if (!q) return
    const rawScore = scoreQuad(q, w, h) * boost
    const refined = refineQuadToEdges(q, mag, w, h)
    const refinedScore = scoreQuad(refined, w, h) * boost
    // Prefer edge-snapped corners when they don't collapse the quad
    const useRefined = refinedScore >= rawScore * 0.85
    const candidate = useRefined ? refined : q
    const finalScore = useRefined ? refinedScore : rawScore
    if (finalScore > bestScore) {
      bestScore = finalScore
      bestQuad = candidate
    }
  }

  // Cue 1: unlike-background (best for docs on fabric/wood/desk)
  tryMask(docMask(imageData.data, w, h), 1)
  // Cue 2: bright paper
  tryMask(brightMask(blurred, w, h), 0.95)
  // Cue 3: inverted bright (dark document on light bg)
  {
    const inv = new Uint8Array(w * h)
    const bm = brightMask(blurred, w, h)
    for (let i = 0; i < inv.length; i++) inv[i] = bm[i] ? 0 : 1
    tryMask(inv, 0.75)
  }

  if (!bestQuad || bestScore < 0.15) return null

  return { quad: bestQuad, confidence: bestScore }
}

export function prepareDetectImageData(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): { imageData: ImageData; scale: number } {
  const scale = Math.min(1, DETECT_MAX_W / srcW)
  const w = Math.max(32, Math.round(srcW * scale))
  const h = Math.max(32, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(source, 0, 0, w, h)
  return { imageData: ctx.getImageData(0, 0, w, h), scale }
}

export function scaleQuad(q: Quad, scale: number): Quad {
  return {
    tl: { x: q.tl.x / scale, y: q.tl.y / scale },
    tr: { x: q.tr.x / scale, y: q.tr.y / scale },
    br: { x: q.br.x / scale, y: q.br.y / scale },
    bl: { x: q.bl.x / scale, y: q.bl.y / scale },
  }
}

/** Tiny inset so we don't clip a 1px background fringe. */
export function insetQuad(q: Quad, width: number, height: number): Quad {
  const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4
  const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4
  const pull = 0.998
  const pt = (p: Point): Point => ({
    x: clamp(cx + (p.x - cx) * pull, 0, width),
    y: clamp(cy + (p.y - cy) * pull, 0, height),
  })
  return {
    tl: pt(q.tl),
    tr: pt(q.tr),
    br: pt(q.br),
    bl: pt(q.bl),
  }
}
