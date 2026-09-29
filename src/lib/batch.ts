/**
 * Bounded-concurrency batch runner.
 * Keeps memory flat by processing N images at a time (default 2 on mobile,
 * 3 on desktop) while reporting per-item progress.
 */

export interface RunnerOptions {
  concurrency?: number
  onSettled?: (index: number) => void
}

export async function runBatch<T>(
  tasks: Array<() => Promise<T>>,
  options: RunnerOptions = {},
): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }>> {
  const concurrency = options.concurrency ?? defaultConcurrency()
  const results: Array<
    { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
  > = new Array(tasks.length)

  let next = 0
  let completed = 0

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++
      try {
        const value = await tasks[i]()
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      } finally {
        completed++
        options.onSettled?.(i)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function defaultConcurrency(): number {
  if (typeof navigator === 'undefined') return 2
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  if (mem <= 2 || cores <= 2) return 1
  if (mem <= 4 || cores <= 4) return 2
  return 3
}
