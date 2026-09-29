/**
 * Visual crop-quality test: process key fixtures, save outputs + dims.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const fixtures = path.join(root, 'test-fixtures')
const outDir = path.join(root, 'test-output', 'crop-qa')
const PORT = 4173

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const files = [
    'id-fabric-07.jpg',
    'id-fabric-08.jpg',
    'page-desk-09.jpg',
    'invoice-01.jpg',
    'id-card-04.jpg',
    'receipt-03.jpg',
  ]

  const server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore', env: { ...process.env } },
  )

  try {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}`)
        if (r.ok) break
      } catch {
        await wait(200)
      }
    }

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    const downloads = []
    page.on('download', (d) => downloads.push(d))

    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Drop images here')

    const paths = files.map((f) => path.join(fixtures, f))
    await page.locator('input[type="file"]').first().setInputFiles(paths)
    await page.waitForFunction(() => document.body.innerText.includes('Batch complete'), {
      timeout: 180000,
    })
    await wait(1500)

    // Capture result blobs via page evaluation
    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article'))
      return cards.map((card) => {
        const img = card.querySelector('img')
        const name = card.querySelector('p')?.textContent?.trim()
        return {
          name,
          src: img?.src ?? '',
          text: card.innerText.replace(/\n/g, ' | '),
        }
      })
    })

    console.log('Results:')
    for (const r of results) console.log('-', r.name, '|', r.text)

    // Save result images
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (!r.src) continue
      const filename = `${r.name || 'result-' + i}`
      // blob URL in page — fetch as base64
      const dataUrl = await page.evaluate(async (src) => {
        const res = await fetch(src)
        const blob = await res.blob()
        return await new Promise((resolve) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result)
          fr.readAsDataURL(blob)
        })
      }, r.src)

      const b64 = String(dataUrl).split(',')[1]
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path.join(outDir, filename), Buffer.from(b64, 'base64'))
      console.log('saved', filename)
    }

    await page.screenshot({ path: path.join(outDir, 'ui.png'), fullPage: true })
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
