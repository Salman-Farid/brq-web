import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  disabled?: boolean
  compact?: boolean
}

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/*'

export function DropZone({ onFiles, disabled, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const handleFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return
      const files = Array.from(list).filter(
        (f) =>
          f.type.startsWith('image/') ||
          /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name),
      )
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (disabled) return
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (disabled) return
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent) => {
      if (disabled) return
      e.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (disabled) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      handleFiles(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [disabled, handleFiles])

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon />
          Add more images
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Select or drop images"
      className={`group relative overflow-hidden rounded-3xl border bg-white transition-all duration-300 ${
        dragging
          ? 'dropzone-active border-accent-500/60'
          : 'border-ink-200 shadow-card hover:border-accent-300'
      }`}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 grid-mask opacity-80" />
      <div className="relative flex flex-col items-center px-6 py-12 text-center sm:py-16">
        <div
          className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-300 ${
            dragging
              ? 'scale-105 border-accent-400 bg-accent-50'
              : 'border-ink-200 bg-ink-50 group-hover:border-accent-300 group-hover:bg-accent-50'
          }`}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
              stroke="url(#g1)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
              stroke="url(#g1)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="g1" x1="4" y1="4" x2="20" y2="20">
                <stop stopColor="#4F46E5" />
                <stop offset="1" stopColor="#10B981" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">
          Drop images here
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-ink-600">
          Or click to select multiple photos. Each image is kept exactly as-is (aspect ratio
          intact) and exported as JPG under 400 KB — all in your browser.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            className="btn-primary"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              inputRef.current?.click()
            }}
          >
            <PlusIcon />
            Choose images
          </button>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-medium uppercase tracking-wider text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <Dot /> Original kept
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot /> Aspect ratio intact
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot /> JPG &lt; 400 KB
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Dot /> Auto download
          </span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-ink-400" />
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
