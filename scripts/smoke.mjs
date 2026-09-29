/**
 * Headless smoke test — auto scan pipeline:
 *  - document auto-cropped (or original kept when uncertain)
 *  - Magic Color (color preserved, not grayscale)
 *  - every JPG strictly under 400 KB
 *  - single → direct JPG (no ZIP); multi → ZIP
 *  - light theme
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const fixtures = path.join(root, 'test-fixtures')
const outDir = path.join(root, 'test-output')

const PORT = 4173
const URL_BASE = `http://127.0.0.1:${PORT}`

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForServer(url, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await wait(200)
  }
  throw new Error(`Server did not start at ${url}`)
}

function parseDims(text) {
  const m = text.match(/(\d+)\s*[×x]\s*(\d+)/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

function parseSize(text) {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(B|KB|MB)/g)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const num = parseFloat(last[1])
  const unit = last[2]
  const bytes = unit === 'B' ? num : unit === 'KB' ? num * 1024 : num * 1024 * 1024
  return { bytes, label: last[0] }
}

const FIXTURE_DIMS = {
  'big-page-05.jpg': { w: 3000, h: 2200 },
  'hard-wood-06.jpg': { w: 1400, h: 1000 },
  'id-card-04.jpg': { w: 1300, h: 900 },
  'invoice-01.jpg': { w: 1280, h: 960 },
  'invoice-02.jpg': { w: 1200, h: 900 },
  'receipt-03.jpg': { w: 1100, h: 1100 },
}

async function uploadAndWait(page, files) {
  await page.goto(URL_BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Drop images here', { timeout: 10000 })
  const input = page.locator('input[type="file"]').first()
  await input.setInputFiles(files)
  await page.waitForFunction(
    () => document.body.innerText.includes('Batch complete'),
    { timeout: 180000 },
  )
  await wait(700)
}

async function readCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('article'))
    return cards.map((card) => {
      const title = card.querySelector('p')?.textContent?.trim() ?? ''
      const badges = Array.from(card.querySelectorAll('span')).map(
        (s) => s.textContent?.trim() ?? '',
      )
      return { title, badges, text: card.innerText }
    })
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const files = (await readdir(fixtures)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  if (files.length === 0) throw new Error('No fixtures found')
  console.log('Fixtures:', files.join(', '))

  const server = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
  )
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})

  let exitCode = 0
  try {
    await waitForServer(URL_BASE)
    console.log('Preview server up')

    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    // ---------- SINGLE ----------
    console.log('\n=== Single image (auto scan) ===')
    const downloads = []
    page.on('download', (d) => downloads.push(d))
    const singlePath = path.join(fixtures, files[0])
    await uploadAndWait(page, [singlePath])
    await wait(1000)

    const singleCards = await readCards(page)
    for (const c of singleCards) {
      console.log('-', c.title, '|', c.badges.filter(Boolean).join(' / '))
      console.log('  ', c.text.replace(/\n/g, ' · '))
    }

    const sc = singleCards[0]
    const size = parseSize(sc.text)
    const dims = parseDims(sc.text)
    if (!size || size.bytes >= 400 * 1024) {
      console.error('FAIL: single not under 400 KB', size?.label)
      exitCode = 1
    } else {
      console.log(`OK: ${size.label} under 400 KB`)
    }

    const scanned = sc.badges.includes('Scanned') || sc.badges.includes('Original')
    if (!scanned) {
      console.error('FAIL: expected Scanned or Original badge')
      exitCode = 1
    } else {
      console.log('OK: badge =', sc.badges.find((b) => b === 'Scanned' || b === 'Original'))
    }

    // If auto-cropped, output should be tighter than the full source frame
    const src = FIXTURE_DIMS[files[0]]
    if (dims && src && sc.badges.includes('Scanned')) {
      const srcArea = src.w * src.h
      const outArea = dims.w * dims.h
      console.log(
        `  cropped: src ${src.w}×${src.h} → out ${dims.w}×${dims.h} (${((1 - outArea / srcArea) * 100).toFixed(0)}% smaller area)`,
      )
      if (outArea > srcArea * 1.05) {
        console.error('FAIL: output larger than source frame')
        exitCode = 1
      }
    } else if (dims && src && sc.badges.includes('Original')) {
      const drift =
        Math.abs(dims.w / dims.h - src.w / src.h) / (src.w / src.h)
      if (drift > 0.02) {
        console.error('FAIL: original-keep changed aspect')
        exitCode = 1
      } else {
        console.log('OK: original kept with source aspect')
      }
    }

    await wait(1200)
    const zips1 = downloads.filter((d) => d.suggestedFilename().endsWith('.zip'))
    const jpgs1 = downloads.filter((d) => /\.jpe?g$/i.test(d.suggestedFilename()))
    console.log(
      `Downloads: ${downloads.map((d) => d.suggestedFilename()).join(', ') || '(none)'}`,
    )
    if (zips1.length > 0) {
      console.error('FAIL: single produced ZIP')
      exitCode = 1
    } else if (jpgs1.length > 0) {
      console.log('OK: single auto-downloaded JPG (no ZIP)')
      await jpgs1[0].saveAs(path.join(outDir, 'single.jpg'))
    } else {
      console.error('FAIL: single did not auto-download')
      exitCode = 1
    }

    await page.screenshot({ path: path.join(outDir, 'scan-single.png'), fullPage: true })

    // ---------- MULTI ----------
    console.log('\n=== Multi image (auto scan) ===')
    downloads.length = 0
    const multiPaths = files.map((f) => path.join(fixtures, f))
    await uploadAndWait(page, multiPaths)
    await wait(1800)

    const multiCards = await readCards(page)
    let scannedCount = 0
    let originalCount = 0
    for (const m of multiCards) {
      const s = parseSize(m.text)
      const badge = m.badges.find((b) => b === 'Scanned' || b === 'Original') ?? '?'
      if (badge === 'Scanned') scannedCount++
      if (badge === 'Original') originalCount++
      const d = parseDims(m.text)
      console.log('-', m.title, badge, s?.label ?? '?', d ? `${d.w}×${d.h}` : '')
      if (!s || s.bytes >= 400 * 1024) {
        console.error(`FAIL: ${m.title} over 400 KB`)
        exitCode = 1
      }
    }
    console.log(`Scanned: ${scannedCount}, Original kept: ${originalCount}`)
    if (scannedCount < 3) {
      console.error('FAIL: expected most fixtures to be auto-scanned')
      exitCode = 1
    }

    const multiZips = downloads.filter((d) => d.suggestedFilename().endsWith('.zip'))
    if (multiZips.length === 0) {
      const btn = page.getByRole('button', { name: /Download all JPG/i })
      if (await btn.count()) {
        const dp = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
        await btn.first().click()
        const d = await dp
        if (d) {
          await d.saveAs(path.join(outDir, 'batch.zip'))
          console.log('OK: multi ZIP:', d.suggestedFilename())
        } else {
          console.error('FAIL: no ZIP for multi')
          exitCode = 1
        }
      }
    } else {
      await multiZips[0].saveAs(path.join(outDir, 'batch.zip'))
      console.log('OK: multi auto ZIP:', multiZips[0].suggestedFilename())
    }

    // Color check on a result: must not be grayscale
    const img = page.locator('article img').first()
    // Analyze the processed result via canvas from the src
    const colorInfo = await page.evaluate(async () => {
      const im = document.querySelector('article img')
      if (!im) return null
      const c = document.createElement('canvas')
      // Need CORS-free local blob URL — same origin
      await new Promise((res) => {
        if (im.complete) res()
        else im.onload = () => res()
      })
      const w = Math.min(200, im.naturalWidth)
      const h = Math.min(200, im.naturalHeight)
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(im, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      let chroma = 0
      let n = 0
      for (let i = 0; i < d.length; i += 16) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2])
        const mn = Math.min(d[i], d[i + 1], d[i + 2])
        chroma += mx - mn
        n++
      }
      return { avgChroma: chroma / Math.max(1, n), sample: n }
    })
    console.log('Color chroma sample:', colorInfo)
    if (colorInfo && colorInfo.avgChroma < 3) {
      console.error('FAIL: output looks grayscale (no chroma)')
      exitCode = 1
    } else {
      console.log('OK: natural colors preserved (not B&W)')
    }

    await page.screenshot({ path: path.join(outDir, 'scan-multi.png'), fullPage: true })

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const [r, g, b] = bg.match(/\d+/g).map(Number)
    if (r < 220 || g < 220 || b < 220) {
      console.error('FAIL: not light theme', bg)
      exitCode = 1
    } else {
      console.log('OK: light theme', bg)
    }

    if (consoleErrors.length) console.warn('Page errors:', consoleErrors.slice(0, 5))

    await browser.close()
    console.log(exitCode ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED')
  } finally {
    server.kill('SIGTERM')
    await wait(300)
    if (!server.killed) server.kill('SIGKILL')
  }
  process.exit(exitCode)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
