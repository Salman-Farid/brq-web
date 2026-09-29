import type { ScanItem } from '../types'
import { formatBytes } from '../lib/image'

const STATUS_META: Record<
  ScanItem['status'],
  { label: string; className: string; dot: string }
> = {
  queued: { label: 'Queued', className: 'bg-ink-100 text-ink-600', dot: 'bg-ink-400' },
  loading: { label: 'Loading', className: 'bg-accent-50 text-accent-700', dot: 'bg-accent-500' },
  detecting: {
    label: 'Detecting',
    className: 'bg-accent-50 text-accent-700',
    dot: 'bg-accent-500',
  },
  correcting: {
    label: 'Scanning',
    className: 'bg-accent-50 text-accent-700',
    dot: 'bg-accent-500',
  },
  enhancing: {
    label: 'Magic Color',
    className: 'bg-violet-50 text-violet-700',
    dot: 'bg-violet-500',
  },
  compressing: {
    label: 'Optimizing',
    className: 'bg-amber-50 text-amber-600',
    dot: 'bg-amber-500',
  },
  done: { label: 'Done', className: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  error: { label: 'Failed', className: 'bg-rose-50 text-rose-600', dot: 'bg-rose-500' },
}

interface Props {
  item: ScanItem
  onDownload: (item: ScanItem) => void
  onRetry: (item: ScanItem) => void
  onRemove: (item: ScanItem) => void
}

export function ResultCard({ item, onDownload, onRetry, onRemove }: Props) {
  const meta = STATUS_META[item.status]
  const busy = item.status !== 'done' && item.status !== 'error'

  return (
    <article className="card group relative overflow-hidden animate-fade-up">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-100">
        <img
          src={item.resultUrl ?? item.sourceUrl}
          alt={item.name}
          className={`h-full w-full object-cover transition-all duration-500 ${
            item.status === 'done' ? 'opacity-100' : 'opacity-80'
          }`}
          loading="lazy"
          draggable={false}
        />

        {busy && (
          <div className="absolute inset-0">
            <div className="shimmer absolute inset-0 animate-shimmer opacity-70" />
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-accent-500/15 to-transparent animate-pulse-soft" />
          </div>
        )}

        <div className="absolute left-2.5 top-2.5">
          <span className={`badge shadow-soft ${meta.className}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${busy ? 'animate-pulse-soft' : ''}`}
            />
            {meta.label}
          </span>
        </div>

        {item.status === 'done' && item.resultSize != null && (
          <div className="absolute right-2.5 top-2.5">
            <span className="badge border border-ink-200 bg-white/95 text-ink-700 shadow-soft tnum">
              {formatBytes(item.resultSize)}
            </span>
          </div>
        )}

        {item.status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/85 px-4 text-center">
            <div>
              <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-rose-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 8v5m0 3h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
                    stroke="#E11D48"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p className="text-xs leading-5 text-rose-700">{item.error ?? 'Processing failed'}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink-900" title={item.name}>
              {item.name}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {item.resultWidth && item.resultHeight
                ? `${item.resultWidth}×${item.resultHeight}`
                : 'Processing…'}
              {item.status === 'done' && item.resultSize != null && item.originalSize > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-emerald-600">
                    {Math.round((1 - item.resultSize / item.originalSize) * 100)}% smaller
                  </span>
                </>
              )}
            </p>
          </div>
          {item.status === 'done' && item.resultBlob && (
            <span
              className={`badge tnum ${
                item.autoCropped
                  ? 'border border-accent-200 bg-accent-50 text-accent-700'
                  : 'border border-ink-200 bg-ink-50 text-ink-600'
              }`}
            >
              {item.autoCropped ? 'Scanned' : item.keptOriginal ? 'Original' : 'JPG'}
            </span>
          )}
        </div>

        {busy && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="progress-fill h-full rounded-full"
              style={{ width: `${Math.max(6, item.progress)}%` }}
            />
          </div>
        )}

        {busy && item.stageLabel && (
          <p className="text-[11px] text-ink-500">{item.stageLabel}</p>
        )}

        <div className="flex items-center gap-1.5 pt-0.5">
          {item.status === 'done' && item.resultBlob && (
            <button
              type="button"
              className="btn-ghost flex-1 !py-2 !text-xs"
              onClick={() => onDownload(item)}
            >
              <DownloadIcon />
              Download
            </button>
          )}
          {item.status === 'error' && (
            <button
              type="button"
              className="btn-ghost flex-1 !py-2 !text-xs"
              onClick={() => onRetry(item)}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-2 text-ink-500 hover:text-rose-600"
            aria-label="Remove"
            title="Remove"
            onClick={() => onRemove(item)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </article>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
