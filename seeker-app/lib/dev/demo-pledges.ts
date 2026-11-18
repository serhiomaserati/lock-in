// Debug and screenshot builds only (lib/dev/samples.ts): ready-made pledges in every state, so each screen can be
// checked without waiting days. Amounts stay within the mainnet range (100 to 10,000 SKR) so screenshots match it.
import { DAY_MS, deviceTimeZone, formatSteps, localMidnights, type Pledge } from '../pledge/pledge'
import { STORE_SHOTS } from './samples'

const H = 60 * 60 * 1000
/** Store screenshot builds show only these: no reinstall, saving, pending or lost states. */
const STORE_SET = new Set(['done-today', 'manual', 'active', 'long', 'early', 'completed', 'returned'])

export function buildDemoPledges(owner: string, now: number, everyState = false): Pledge[] {
  const tzOffset = new Date(now).getTimezoneOffset()
  const tzName = deviceTimeZone()
  const today = localMidnights(now, 1)[0]
  /** DST-aware bounds for a window whose first day is `offsetDays` from today. */
  const boundsFrom = (offsetDays: number, durationDays: number) =>
    localMidnights(today + 12 * H + offsetDays * DAY_MS, durationDays + 2)

  const steps = (
    id: string,
    offsetDays: number,
    durationDays: number,
    doneDays: number[],
    stepsPerDay: number,
    extra: Partial<Pledge> = {},
  ): Pledge => {
    const bounds = boundsFrom(offsetDays, durationDays)
    const startsAt = bounds[0]
    const stepsByDay: Record<string, number> = {}
    for (const d of doneDays) stepsByDay[String(bounds[d])] = stepsPerDay + 800 + d * 137
    return {
      id: `demo-${id}`,
      owner,
      goal: `Walk ${formatSteps(stepsPerDay)} steps a day`,
      amountSkr: 100,
      durationDays,
      createdAt: startsAt - 6 * H,
      startsAt,
      deadline: bounds[bounds.length - 1] - 1,
      tzOffset,
      tzName,
      bounds,
      checkIns: doneDays.map((d) => bounds[d] + 18 * H),
      lockOnChain: false,
      proof: 'steps',
      stepsPerDay,
      stepsByDay,
      stepsSyncedAt: now - 4 * 60_000,
      ...extra,
    }
  }

  const manual = (id: string, offsetDays: number, durationDays: number, doneDays: number[], goal: string): Pledge => {
    const bounds = boundsFrom(offsetDays, durationDays)
    return {
      id: `demo-${id}`,
      owner,
      goal,
      amountSkr: 150,
      durationDays,
      createdAt: bounds[0] - 30 * H,
      startsAt: bounds[0],
      deadline: bounds[bounds.length - 1] - 1,
      tzOffset,
      tzName,
      bounds,
      checkIns: doneDays.map((d) => Math.min(bounds[d] + 9 * H, now - 60_000)),
      lockOnChain: false,
      proof: 'manual',
    }
  }

  const active = steps('active', -3, 7, [0, 1, 2], 10000)
  active.stepsByDay![String(today)] = 6210

  // 30-day challenge, day 12, one day missed - exercises the long (segmented) track.
  const longDone = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10]
  const long = steps('long', -11, 30, longDone, 8000, { amountSkr: 500 })
  long.stepsByDay![String(today)] = 3100

  // A fake on-chain record (never synced: see isDemoPledge) for states that only exist on Solana.
  const chain = (status: 'active' | 'returned' | 'forfeited' | 'refunded', p: Pledge, extra: object = {}) => ({
    address: '11111111111111111111111111111111',
    status,
    checked: p.checkIns.map((t) => p.bounds!.findIndex((b, i) => t >= b && t < p.bounds![i + 1])),
    deviceKey: '11111111111111111111111111111111',
    linked: true,
    closeAt: p.deadline + 1 + DAY_MS,
    ...extra,
  })

  // Today done and recorded on Solana.
  const doneToday = steps('done-today', -3, 7, [0, 1, 2, 3], 10000, { goal: 'Walk every day' })
  doneToday.stepsByDay![String(today)] = 10240
  doneToday.chain = chain('active', doneToday)
  // Today reached on the phone, not on Solana yet.
  const saving = manual('saving', -2, 5, [0, 1, 2], 'Meditate 10 minutes')
  saving.chain = chain('active', saving, { checked: [0, 1] })
  // A reinstall: this phone can't record days until it is linked.
  const link = manual('link', -1, 3, [0], 'Stretch every morning')
  link.chain = chain('active', link, { linked: false })
  const returned = steps('returned', -10, 7, [0, 1, 2, 3, 4, 5, 6], 10000, { goal: 'Morning walks' })
  returned.chain = chain('returned', returned, { settledAt: today - 20 * H })
  returned.claimedAt = today - 20 * H
  const pending = steps('pending-loss', -12, 5, [0, 1], 12000, { goal: 'Walk 12,000 steps', amountSkr: 200 })
  pending.chain = chain('active', pending)
  const forfeited = manual('forfeited', -14, 3, [0], 'No sugar')
  forfeited.chain = chain('forfeited', forfeited, { settledAt: today - 3 * DAY_MS })
  // Completed early: the days after the third hit aren't needed.
  const early = manual('early', -3, 3, [0, 1, 2], 'Read 20 pages')

  const all = [
    doneToday,
    saving,
    link,
    returned,
    pending,
    forfeited,
    early,
    long,
    steps('upcoming', 1, 7, [], 10000, {
      goal: 'Walk 8,000 steps a day',
      stepsPerDay: 8000,
      amountSkr: 100,
    }),
    active,
    steps('verifying', -8, 7, [0, 1, 2, 3, 5], 8000),
    steps('completed', -9, 7, [0, 1, 2, 3, 5, 6, 7], 10000),
    steps('failed', -10, 7, [0, 2, 3, 6], 15000, { amountSkr: 200 }),
    (() => {
      const bounds = boundsFrom(-1, 5)
      return {
        id: 'demo-manual',
        owner,
        goal: 'Read 20 pages every day',
        amountSkr: 100,
        durationDays: 5,
        createdAt: bounds[0] - 30 * H,
        startsAt: bounds[0],
        deadline: bounds[bounds.length - 1] - 1,
        tzOffset,
        tzName,
        bounds,
        checkIns: [bounds[0] + 21 * H],
        lockOnChain: false,
        proof: 'manual' as const,
      }
    })(),
  ]
  return STORE_SHOTS && !everyState ? all.filter((p) => STORE_SET.has(p.id.slice('demo-'.length))) : all
}
