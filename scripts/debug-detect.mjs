/**
 * Debug detection scores for a fixture.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PORT = 4173

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const file = process.argv[2] || 'id-fabric-07.jpg'
  const server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore' },
  )
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}`)
        if (r.ok) break
      } catch {
        await wait(200)
      }
    }
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' })

    const buf = await readFile(path.join(root, 'test-fixtures', file))
    const b64 = buf.toString('base64')

    const result = await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const file = new File([arr], name, { type: 'image/jpeg' })
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 900 / bitmap.width)
      canvas.width = Math.max(32, Math.round(bitmap.width * scale))
      canvas.height = Math.max(32, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const mod = await import('/src/lib/docDetect.ts')
      const det = mod.detectDocument(imageData)
      return {
        detectW: canvas.width,
        detectH: canvas.height,
        det: det
          ? {
              confidence: det.confidence,
              quad: det.quad,
            }
          : null,
      }
    }, { b64, name: file })

    console.log(JSON.stringify(result, null, 2))
    await browser.close()
  } finally {
    server.kill('SIGTERM')
    await wait(200)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
