export function Header({
  done,
  total,
  processing,
}: {
  done: number
  total: number
  processing: boolean
}) {
  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 pb-6 pt-7 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-600 shadow-glow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M7 4h9l3 3v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                stroke="white"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M15 4v4h4" stroke="white" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M9 12h7M9 15.5h5" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-mint-500 ring-2 ring-white" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-[17px] font-semibold tracking-tight text-ink-900">BRQ DocScan</h1>
              <span className="badge border border-accent-200 bg-accent-50 text-accent-700">Pro</span>
            </div>
            <p className="text-xs text-ink-500">
              Original image kept · JPG under 400 KB
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          {total > 0 ? (
            <div className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-2 shadow-soft">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  processing
                    ? 'bg-amber-500 animate-pulse-soft'
                    : done === total && total > 0
                      ? 'bg-mint-500'
                      : 'bg-ink-400'
                }`}
              />
              <span className="tnum text-xs font-medium text-ink-700">
                {done}/{total} done
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-xs text-ink-600 shadow-soft">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Auto-download ready
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
