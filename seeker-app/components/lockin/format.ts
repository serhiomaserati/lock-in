import { LockInConfig } from '@/constants/lockin'
import { SAMPLE_CAPTIONS } from '@/lib/dev/samples'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Sun, Oct 12" (device timezone). */
export function formatDay(ts: number): string {
  const d = new Date(ts)
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Oct 12" */
export function formatShortDate(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Updated 4 min ago" for a step goal; demo goals say so instead of pretending to be read. */
export function stepsUpdatedLabel(p: { id: string; stepsSyncedAt?: number }, syncing: boolean, now: number): string {
  if (syncing) return 'Updating steps…'
  if (SAMPLE_CAPTIONS && p.id.startsWith('demo-')) return 'Sample data'
  return p.stepsSyncedAt ? `Updated ${timeAgo(p.stepsSyncedAt, now)}` : 'Not updated yet'
}

/** "just now", "4 min ago", "2 h ago" */
export function timeAgo(ts: number, now: number): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ago`
}

/** "5 h" / "45 min" until `ts`. */
export function timeLeft(ts: number, now: number): string {
  const min = Math.max(0, Math.ceil((ts - now) / 60_000))
  return min >= 60 ? `${Math.ceil(min / 60)} h` : `${min} min`
}

/** "UTC+03:00" for a Date#getTimezoneOffset() value (minutes, sign inverted). */
export function utcOffsetLabel(tzOffset: number = new Date().getTimezoneOffset()): string {
  const off = -tzOffset
  const sign = off >= 0 ? '+' : '−'
  const abs = Math.abs(off)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** "25 tSKR" (the token symbol of the network the app runs on). */
export function formatAmount(n: number): string {
  const [int, frac] = String(n).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${frac ? `${grouped}.${frac}` : grouped} ${LockInConfig.tokenSymbol}`
}

/** "1 day", "3 days". */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "21:04" (device timezone). */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "10h 24m", "45m" until `ts` (a countdown shown as a big number). */
export function formatCountdown(ts: number, now: number): string {
  const min = Math.max(0, Math.ceil((ts - now) / 60_000))
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`
}

/** "Oct 4 - Oct 11" (a goal's calendar window). */
export function formatRange(from: number, to: number): string {
  return `${formatShortDate(from)} - ${formatShortDate(to)}`
}

/** A deadline stored as "midnight minus 1 ms" shows as that midnight. */
export function ceilMinute(ts: number): number {
  return Math.ceil(ts / 60_000) * 60_000
}
