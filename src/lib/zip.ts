import JSZip from 'jszip'
import { downloadBlob } from './image'

export interface ZipEntry {
  name: string
  blob: Blob
}

/** Build a ZIP of all processed JPGs and trigger a single download. */
export async function downloadZip(
  entries: ZipEntry[],
  zipName = `brq-scans-${Date.now()}.zip`,
): Promise<void> {
  const zip = new JSZip()
  const used = new Set<string>()

  for (const entry of entries) {
    let name = entry.name
    // Avoid collisions inside the archive
    if (used.has(name)) {
      const dot = name.lastIndexOf('.')
      const base = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let n = 2
      while (used.has(`${base}-${n}${ext}`)) n++
      name = `${base}-${n}${ext}`
    }
    used.add(name)
    zip.file(name, entry.blob)
  }

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      // Could be used for a zip-progress UI
      void meta
    },
  )
  downloadBlob(blob, zipName)
}

export function sanitizeFilename(name: string, index: number): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w一-鿿-鿿぀-ヿㄱ-힯\- ]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 48)
      .trim() || `scan-${index + 1}`
  return `${base}.jpg`
}
