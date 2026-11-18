// App clock. In development builds it can be shifted forward so multi-day states
// (verifying, failed, completed) can be checked without waiting. In release builds
// the offset can never change, so `now()` is always the real time.

declare const __DEV__: boolean | undefined
const isDev = typeof __DEV__ !== 'undefined' && !!__DEV__

let offsetMs = 0
const listeners = new Set<() => void>()

export function now(): number {
  return Date.now() + offsetMs
}

export function clockOffset(): number {
  return offsetMs
}

export function shiftClock(ms: number): void {
  if (!isDev) return
  offsetMs += ms
  listeners.forEach((l) => l())
}

export function resetClock(): void {
  if (!isDev) return
  offsetMs = 0
  listeners.forEach((l) => l())
}

export function onClockChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
