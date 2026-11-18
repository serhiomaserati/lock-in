// Run: npx tsx tests/reminder-plan.test.ts
import { reminderPlan } from '@/lib/reminders/plan'
import type { Pledge } from '@/lib/pledge/pledge'

let checks = 0
const assert = {
  ok(cond: unknown, msg: string) {
    if (!cond) throw new Error(`FAILED: ${msg}`)
    checks++
  },
  equal(a: unknown, b: unknown, msg: string) {
    assert.ok(a === b, `${msg} (got ${String(a)}, want ${String(b)})`)
  },
  deepEqual(a: unknown, b: unknown, msg: string) {
    assert.ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`)
  },
}

const H = 3600_000,
  D = 24 * H
// Kyiv-like: day bounds at 21:00 UTC (midnight UTC+3). Challenge 3 days + spare, starts Oct 11.
const start = Date.UTC(2026, 9, 10, 21)
const bounds = [0, 1, 2, 3, 4].map((i) => start + i * D)
const base: Pledge = {
  id: 'p1',
  owner: 'W',
  goal: 'Read 20 pages',
  amountSkr: 10,
  durationDays: 3,
  createdAt: start - H,
  startsAt: start,
  deadline: bounds[3] - 1,
  bounds,
  checkIns: [],
  lockOnChain: false,
  proof: 'manual',
}
const on = { enabled: true, hour: 20 }
const now = start + 10 * H // day 0, 13:00 local

let r = reminderPlan([base], 'W', on, now)
assert.equal(r.length, 4, 'one per remaining day incl. spare')
assert.equal(r[0].at, bounds[1] - 4 * H, 'day 0 at 20:00 local = day end - 4h')
assert.ok(r[0].body.includes('check'), 'manual wording')

r = reminderPlan([{ ...base, checkIns: [start + 2 * H] }], 'W', on, now)
assert.equal(r.length, 3, 'done day 0 skipped')
assert.ok(!r.some((x) => x.id.endsWith(':0')), 'no day-0 reminder')

assert.equal(reminderPlan([base], 'W', { enabled: false, hour: 20 }, now).length, 0, 'disabled')
assert.ok(
  reminderPlan([base], 'W', on, bounds[1] - 4 * H - 10_000).some((x) => x.id.endsWith(':0')),
  'a reminder 10 s away stays planned (re-plans must not cancel it)',
)
assert.equal(reminderPlan([base], 'OTHER', on, now).length, 0, 'other wallet')
// Past today's reminder time the alarm may still be waiting in Android's delivery window: it stays planned
// (syncReminders won't schedule a new one that late) until the day ends.
assert.ok(
  reminderPlan([base], 'W', on, bounds[1] - 3 * H).some((x) => x.id.endsWith(':0')),
  "past today's reminder time: still planned until the day ends",
)
assert.ok(!reminderPlan([base], 'W', on, bounds[1] + 1).some((x) => x.id.endsWith(':0')), 'after the day ends: dropped')

// Steps goal on-chain: daily "open the app" + last call before close_at.
const closeAt = bounds[4] + D
const steps: Pledge = {
  ...base,
  id: 'p2',
  proof: 'steps',
  stepsPerDay: 8000,
  chain: { address: 'A', status: 'active', checked: [], closeAt, linked: true } as unknown as Pledge['chain'],
}
r = reminderPlan([steps], 'W', on, now)
assert.ok(
  r.some((x) => x.id === 'lockin:p2:last' && x.at === closeAt - 2 * H),
  'last call',
)
assert.ok(
  r.filter((x) => !x.id.endsWith(':last')).every((x) => x.body.includes('Open Lock-In')),
  'steps wording',
)
assert.ok(
  reminderPlan([steps], 'W', on, closeAt - H).some((x) => x.id === 'lockin:p2:last'),
  'last call stays planned after its time until the goal closes',
)
assert.ok(
  !reminderPlan([steps], 'W', on, closeAt + 1).some((x) => x.id === 'lockin:p2:last'),
  'last call dropped once closed',
)

// Too many missed days: no daily reminders (goal can't be completed any more).
r = reminderPlan([base], 'W', on, bounds[2] + H)
assert.equal(r.length, 0, 'unreachable after 2 missed days')

// Test goal: 3-minute days, reminder two minutes before each day ends.
const t0 = Date.now() + 60_000
const tb = [0, 1, 2].map((i) => t0 + i * 180_000)
const test: Pledge = {
  ...base,
  id: 'p3',
  durationDays: 1,
  testTiming: true,
  startsAt: t0,
  bounds: tb,
  deadline: tb[1] - 1,
}
r = reminderPlan([test], 'W', on, Date.now())
assert.deepEqual(
  r.map((x) => x.at),
  [tb[1] - 120_000, tb[2] - 120_000],
  'test goal timing',
)

console.log(`reminder plan: all ${checks} checks passed`)
