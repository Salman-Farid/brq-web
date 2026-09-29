import { formatBytes } from '../lib/image'

interface Props {
  total: number
  done: number
  failed: number
  processing: boolean
  finished: boolean
  totalBytes: number
  onDownloadAll: () => void
  onClear: () => void
  onAddMore: () => void
  zipBusy: boolean
  autoDownloaded: boolean
  singleMode: boolean
}

export function BatchPanel({
  total,
  done,
  failed,
  processing,
  finished,
  totalBytes,
  onDownloadAll,
  onClear,
  onAddMore,
  zipBusy,
  autoDownloaded,
  singleMode,
}: Props) {
  const pct = total === 0 ? 0 : Math.round(((done + failed) / total) * 100)

  return (
    <section className="card overflow-hidden animate-fade-up">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-ink-900">
              {processing
                ? 'Processing batch'
                : finished
                  ? failed > 0
                    ? 'Batch complete with issues'
                    : 'Batch complete'
                  : 'Ready to process'}
            </h2>
            {finished && (
              <span
                className={`badge ${
                  failed > 0
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {done} ready
                {failed > 0 ? ` · ${failed} failed` : ''}
              </span>
            )}
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div className="progress-fill h-full rounded-full" style={{ width: `${pct}%` }} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500">
            <span className="tnum">
              {done + failed}/{total} images
            </span>
            {totalBytes > 0 && <span className="tnum">Output {formatBytes(totalBytes)}</span>}
            {autoDownloaded && finished && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20 6 9 17l-5-5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {singleMode ? 'JPG auto-downloaded' : 'ZIP auto-downloaded'}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={onDownloadAll}
            disabled={done === 0 || zipBusy || processing}
          >
            {zipBusy ? (
              <>
                <Spinner />
                Preparing…
              </>
            ) : singleMode ? (
              <>
                <DownloadIcon />
                Download JPG
              </>
            ) : (
              <>
                <DownloadIcon />
                Download all JPG
              </>
            )}
          </button>
          <button type="button" className="btn-ghost" onClick={onAddMore} disabled={processing}>
            Add more
          </button>
          <button type="button" className="btn-ghost" onClick={onClear} disabled={processing}>
            Clear
          </button>
        </div>
      </div>
    </section>
  )
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin-slow"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
