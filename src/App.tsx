import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScanItem } from './types'
import { MAX_BYTES } from './types'
import { downloadBlob, formatBytes, uid } from './lib/image'
import { processImage } from './lib/pipeline'
import { runBatch } from './lib/batch'
import { downloadZip, sanitizeFilename } from './lib/zip'
import { Header } from './components/Header'
import { DropZone } from './components/DropZone'
import { ResultCard } from './components/ResultCard'
import { BatchPanel } from './components/BatchPanel'

function App() {
  const [items, setItems] = useState<ScanItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [zipBusy, setZipBusy] = useState(false)
  const [autoDownloaded, setAutoDownloaded] = useState(false)
  const autoDownloadedRef = useRef(false)
  const processingRef = useRef(false)

  const urlRegistry = useRef(new Set<string>())

  const registerUrl = useCallback((url: string) => {
    urlRegistry.current.add(url)
  }, [])

  const revokeUrl = useCallback((url?: string) => {
    if (!url) return
    URL.revokeObjectURL(url)
    urlRegistry.current.delete(url)
  }, [])

  useEffect(() => {
    const registry = urlRegistry.current
    return () => {
      registry.forEach((u) => URL.revokeObjectURL(u))
      registry.clear()
    }
  }, [])

  const updateItem = useCallback((id: string, patch: Partial<ScanItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const itemsRef = useRef(items)
  itemsRef.current = items

  const doneItems = useCallback(
    () => itemsRef.current.filter((it) => it.status === 'done' && it.resultBlob instanceof Blob),
    [],
  )

  /** Single result → direct JPG. Multiple → one ZIP. */
  const downloadResults = useCallback(async () => {
    const ready = doneItems()
    if (ready.length === 0) return

    setZipBusy(true)
    try {
      if (ready.length === 1) {
        downloadBlob(ready[0].resultBlob as Blob, sanitizeFilename(ready[0].name, 0))
      } else {
        const entries = ready.map((it, i) => ({
          name: sanitizeFilename(it.name, i),
          blob: it.resultBlob as Blob,
        }))
        await downloadZip(entries, `brq-scans-${new Date().toISOString().slice(0, 10)}.zip`)
      }
    } finally {
      setZipBusy(false)
    }
  }, [doneItems])

  const triggerAutoDownload = useCallback(async () => {
    const ready = doneItems()
    if (ready.length === 0) return

    autoDownloadedRef.current = true
    setAutoDownloaded(true)
    await downloadResults()
  }, [doneItems, downloadResults])

  const queueRef = useRef<Array<{ id: string; file: File }>>([])

  const drainQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing(true)

    try {
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0, queueRef.current.length)
        const tasks = batch.map((item) => async () => {
          const t0 = performance.now()
          try {
            updateItem(item.id, {
              status: 'loading',
              progress: 4,
              stageLabel: 'Loading image',
              error: undefined,
            })

            const result = await processImage(item.file, (status, progress, stageLabel) => {
              updateItem(item.id, { status, progress, stageLabel })
            })

            const resultUrl = URL.createObjectURL(result.blob)
            registerUrl(resultUrl)

            updateItem(item.id, {
              status: 'done',
              progress: 100,
              stageLabel: result.autoCropped
                ? 'Scanned & enhanced'
                : result.keptOriginal
                  ? 'Original kept'
                  : 'Complete',
              resultUrl,
              resultBlob: result.blob,
              resultSize: result.blob.size,
              resultWidth: result.width,
              resultHeight: result.height,
              usedDownscale: result.usedDownscale,
              autoCropped: result.autoCropped,
              keptOriginal: result.keptOriginal,
              durationMs: Math.round(performance.now() - t0),
            })
          } catch (err) {
            updateItem(item.id, {
              status: 'error',
              progress: 100,
              stageLabel: 'Failed',
              error: err instanceof Error ? err.message : 'Processing failed',
              durationMs: Math.round(performance.now() - t0),
            })
          }
        })

        await runBatch(tasks)
      }
    } finally {
      processingRef.current = false
      if (queueRef.current.length > 0) {
        void drainQueue()
        return
      }
      setProcessing(false)
      setTimeout(() => {
        void triggerAutoDownload()
      }, 150)
    }
  }, [registerUrl, triggerAutoDownload, updateItem])

  const handleFiles = useCallback(
    (files: File[]) => {
      const newItems: ScanItem[] = files.map((file) => {
        const sourceUrl = URL.createObjectURL(file)
        registerUrl(sourceUrl)
        return {
          id: uid(),
          file,
          name: file.name,
          originalSize: file.size,
          status: 'queued' as const,
          progress: 0,
          stageLabel: 'Waiting',
          sourceUrl,
        }
      })

      for (const it of newItems) {
        queueRef.current.push({ id: it.id, file: it.file })
      }

      setItems((prev) => [...prev, ...newItems])
      void drainQueue()
    },
    [drainQueue, registerUrl],
  )

  const handleDownloadOne = useCallback((item: ScanItem) => {
    if (!item.resultBlob) return
    downloadBlob(item.resultBlob, sanitizeFilename(item.name, 0))
  }, [])

  const handleRetry = useCallback(
    (item: ScanItem) => {
      updateItem(item.id, {
        status: 'queued',
        progress: 0,
        stageLabel: 'Waiting',
        error: undefined,
      })
      queueRef.current.push({ id: item.id, file: item.file })
      void drainQueue()
    },
    [drainQueue, updateItem],
  )

  const handleRemove = useCallback(
    (item: ScanItem) => {
      revokeUrl(item.sourceUrl)
      revokeUrl(item.resultUrl)
      setItems((prev) => prev.filter((it) => it.id !== item.id))
    },
    [revokeUrl],
  )

  const handleClear = useCallback(() => {
    itemsRef.current.forEach((it) => {
      revokeUrl(it.sourceUrl)
      revokeUrl(it.resultUrl)
    })
    setItems([])
    setAutoDownloaded(false)
    autoDownloadedRef.current = false
  }, [revokeUrl])

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === 'done')
    const failed = items.filter((i) => i.status === 'error')
    const totalBytes = done.reduce((s, i) => s + (i.resultSize ?? 0), 0)
    return {
      total: items.length,
      done: done.length,
      failed: failed.length,
      totalBytes,
      avgBytes: done.length ? totalBytes / done.length : 0,
    }
  }, [items])

  const finished = stats.total > 0 && !processing && stats.done + stats.failed >= stats.total
  const singleMode = stats.done <= 1

  return (
    <div className="bg-ambient min-h-screen">
      <div className="pointer-events-none fixed inset-0 grid-mask opacity-50" />

      <Header done={stats.done} total={stats.total} processing={processing} />

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 sm:px-8">
        {items.length === 0 ? (
          <section className="animate-fade-up">
            <div className="mb-8 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[11px] font-medium text-ink-600 shadow-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-mint-500" />
                100% client-side · original image kept intact
              </div>
              <h1 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
                Smart image compression.
                <span className="block bg-gradient-to-r from-accent-600 via-accent-500 to-mint-600 bg-clip-text text-transparent">
                  Original kept. Under 400 KB.
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-7 text-ink-600">
                Drop photos in. The document is auto-detected, cropped, perspective-corrected, and
                enhanced with Magic Color — natural colors kept — then exported as JPG under 400 KB
                and downloaded for you.
              </p>
            </div>

            <DropZone onFiles={handleFiles} disabled={processing} />

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                {
                  title: 'Auto scan & crop',
                  desc: 'Finds the page, removes the background, and perspective-corrects automatically. Uncertain? The original is kept.',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      />
                      <rect x="8" y="8" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.7" />
                    </svg>
                  ),
                },
                {
                  title: 'Magic Color enhance',
                  desc: 'Professional scan look — sharper, brighter, cleaner — while keeping natural colors, stamps, and signatures.',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Under 400 KB, max quality',
                  desc: 'Natural aspect ratio kept. Binary-searches the highest JPEG quality that fits the 400 KB ceiling.',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5M5 17.5h14"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ),
                },
              ].map((f) => (
                <div key={f.title} className="card p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
                    {f.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-ink-900">{f.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-5 text-ink-600">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-5">
            <BatchPanel
              total={stats.total}
              done={stats.done}
              failed={stats.failed}
              processing={processing}
              finished={finished}
              totalBytes={stats.totalBytes}
              onDownloadAll={() => void downloadResults()}
              onClear={handleClear}
              onAddMore={() => {
                const input = document.querySelector<HTMLInputElement>('input[type="file"]')
                input?.click()
              }}
              zipBusy={zipBusy}
              autoDownloaded={autoDownloaded}
              singleMode={singleMode}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <DropZone compact onFiles={handleFiles} disabled={processing} />
              {stats.avgBytes > 0 && (
                <p className="text-[11px] text-ink-500">
                  Avg size{' '}
                  <span className="tnum font-medium text-ink-700">
                    {formatBytes(stats.avgBytes)}
                  </span>
                  {' · '}
                  max allowed <span className="tnum">{formatBytes(MAX_BYTES)}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  onDownload={handleDownloadOne}
                  onRetry={handleRetry}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-ink-200 pt-8 text-center">
          <p className="text-xs text-ink-500">
            Built for speed and privacy. Compression runs entirely in your browser — images never
            leave your device.
          </p>
          <p className="mt-2 text-[11px] text-ink-400">
            BRQ DocScan · {new Date().getFullYear()} · Output always JPG &lt; 400 KB
          </p>
        </footer>
      </main>
    </div>
  )
}

export default App
