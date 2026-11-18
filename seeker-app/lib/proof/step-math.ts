// Pure step math - no React Native imports, so it can be unit-tested with plain Node.
//
// Verified steps for a time range:
// - manually entered records never count;
// - each automatic record is spread evenly over its own time span (clipped to the range);
// - per hour, only the highest single app counts. Phone + watch recording the same walk
//   therefore don't double up, while phone in the morning + watch in the evening still add.
//
// Hour buckets are deliberately coarse: apps write steps at very different granularity
// (per minute vs. hourly chunks), and finer buckets would let a coarse source "smear" a walk
// into hours a fine source shows as empty - over-counting. The trade-off is a possible
// under-count when someone switches devices within the same hour.

export const BUCKET_MS = 60 * 60_000

export interface StepSample {
  start: number // ms epoch
  end: number // ms epoch
  count: number
  origin: string // app that wrote the record
  manual: boolean // recorded as manual entry
}

export function verifiedSteps(samples: StepSample[], from: number, to: number): number {
  // bucket index → origin → steps
  const buckets = new Map<number, Map<string, number>>()
  const add = (bucket: number, origin: string, steps: number) => {
    const byOrigin = buckets.get(bucket) ?? new Map<string, number>()
    byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + steps)
    buckets.set(bucket, byOrigin)
  }

  for (const s of samples) {
    if (s.manual || s.count <= 0) continue
    if (s.end <= s.start) {
      if (s.start >= from && s.start <= to) add(Math.floor((s.start - from) / BUCKET_MS), s.origin, s.count)
      continue
    }
    const rate = s.count / (s.end - s.start) // steps per ms
    const lo = Math.max(s.start, from)
    const hi = Math.min(s.end, to)
    for (let t = lo; t < hi; ) {
      const bucket = Math.floor((t - from) / BUCKET_MS)
      const bucketEnd = Math.min(from + (bucket + 1) * BUCKET_MS, hi)
      add(bucket, s.origin, (bucketEnd - t) * rate)
      t = bucketEnd
    }
  }

  let total = 0
  for (const byOrigin of buckets.values()) total += Math.max(...byOrigin.values())
  return Math.round(total)
}
