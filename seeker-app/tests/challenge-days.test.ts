// Run: npx tsx tests/challenge-days.test.ts
import {
  challengeDays,
  isClaimable,
  missedDays,
  pledgeStatus,
  spareState,
  todayRecord,
  type Pledge,
} from '@/lib/pledge/pledge'

let checks = 0
const assert = {
  ok(cond: unknown, msg: string) {
    if (!cond) throw new Error(`FAILED: ${msg}`)
    checks++
  },
  deepEqual(a: unknown, b: unknown, msg: string) {
    assert.ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`)
  },
}

const H = 3600_000,
  D = 24 * H
const start = Date.UTC(2026, 9, 10, 21)
const goal = (durationDays: number, checkInDays: number[]): Pledge => {
  const bounds = Array.from({ length: durationDays + 2 }, (_, i) => start + i * D)
  return {
    id: 'p',
    owner: 'W',
    goal: 'Read',
    amountSkr: 10,
    durationDays,
    createdAt: start - H,
    startsAt: start,
    deadline: bounds[durationDays + 1] - 1,
    bounds,
    checkIns: checkInDays.map((i) => start + i * D + 10 * H),
    lockOnChain: false,
    proof: 'manual',
  }
}
const states = (p: Pledge, now: number) => challengeDays(p, now).map((d) => d.state)

// 1 day within 2, done on day 0: the spare day isn't "missed" afterwards, it's not needed.
let p = goal(1, [0])
assert.deepEqual(states(p, start + 2 * D + H), ['done', 'unneeded'], 'completed early: spare not needed')
assert.ok(missedDays(p, start + 2 * D + H) === 0, 'completed early: nothing missed')
assert.ok(pledgeStatus(p, start + 2 * D + H) === 'completed', 'completed early: status')
// Same goal on the spare day itself: today is not needed either.
assert.deepEqual(states(p, start + D + H), ['done', 'unneeded'], 'completed early: today not needed')

// 3 days within 4: day 0 missed, then 1-3 hit. The miss stays a fact (the spare covered it).
p = goal(3, [1, 2, 3])
assert.deepEqual(states(p, start + 4 * D + H), ['missed', 'done', 'done', 'done'], 'spare used')
assert.ok(missedDays(p, start + 4 * D + H) === 1, 'spare used: one missed')

// In progress: nothing changes for an unfinished goal.
p = goal(3, [0])
assert.deepEqual(states(p, start + 2 * D + H), ['done', 'missed', 'today', 'future'], 'in progress')

// Spare day.
assert.ok(spareState(challengeDays(goal(3, [0]), start + 1 * D + H)) === 'free', 'spare free while nothing missed')
assert.ok(spareState(challengeDays(goal(3, [0]), start + 2 * D + H)) === 'used', 'spare used after one miss')
assert.ok(spareState(challengeDays(goal(3, [0]), start + 3 * D + H)) === 'gone', 'no spare after two misses')
assert.ok(spareState(challengeDays(goal(1, [0]), start + 2 * D + H)) === 'not-needed', 'spare not needed')
assert.ok(spareState(challengeDays(goal(3, [1, 2, 3]), start + 4 * D + H)) === 'used', 'completed with the spare')

// Today's record: reached on the phone vs recorded on Solana.
p = goal(3, [0, 1])
const t = start + D + 12 * H // day 1
assert.ok(todayRecord(goal(3, [0]), t) === 'open', 'not checked in today: open')
assert.ok(todayRecord(p, t) === 'recorded', 'demo goal (no chain): reaching it is the record')
const chainOf = (checked: number[]) =>
  ({ address: 'A', status: 'active', checked, deviceKey: 'K', linked: true, closeAt: 0 }) as Pledge['chain']
assert.ok(todayRecord({ ...p, chain: chainOf([0]) }, t) === 'pending', 'on the phone, not yet on Solana: pending')
assert.ok(todayRecord({ ...p, chain: chainOf([0, 1]) }, t) === 'recorded', 'on Solana: recorded')

// Returnable only once the required days are on Solana (a 1-day goal checked in offline isn't yet).
const done1 = goal(1, [0])
const after = start + D + H
assert.ok(isClaimable(done1, after), 'demo goal: claimable when complete')
assert.ok(!isClaimable({ ...done1, chain: chainOf([]) }, after), 'on-chain goal, day not recorded yet: not claimable')
assert.ok(isClaimable({ ...done1, chain: chainOf([0]) }, after), 'on-chain goal, day recorded: claimable')
assert.ok(!isClaimable({ ...done1, claimedAt: after, chain: chainOf([0]) }, after), 'already returned: not claimable')

console.log(`challenge days: all ${checks} checks passed`)
