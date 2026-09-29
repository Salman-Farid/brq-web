export type ProcessStatus =
  | 'queued'
  | 'loading'
  | 'detecting'
  | 'correcting'
  | 'enhancing'
  | 'compressing'
  | 'done'
  | 'error'

export interface Point {
  x: number
  y: number
}

export interface Quad {
  tl: Point
  tr: Point
  br: Point
  bl: Point
}

export interface ScanItem {
  id: string
  file: File
  name: string
  originalSize: number
  status: ProcessStatus
  progress: number
  stageLabel: string
  /** Object URL of source preview */
  sourceUrl: string
  /** Object URL of processed JPG */
  resultUrl?: string
  resultBlob?: Blob
  resultSize?: number
  resultWidth?: number
  resultHeight?: number
  usedDownscale?: boolean
  /** true when document was auto-cropped & perspective-corrected */
  autoCropped?: boolean
  /** true when detection was uncertain and the original was kept */
  keptOriginal?: boolean
  error?: string
  durationMs?: number
}

export const MAX_BYTES = 400 * 1024 // 400 KB hard ceiling
export const TARGET_BYTES = 390 * 1024 // safety target strictly under 400 KB

/** Below this confidence the original image is kept (no risky crop). */
export const DETECT_CONFIDENCE = 0.28
