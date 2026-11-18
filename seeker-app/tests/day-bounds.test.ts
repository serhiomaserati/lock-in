// Run: npx tsx tests/day-bounds.test.ts
// Day windows of a new goal must start at local midnight in the phone's time zone, including across a DST switch.
// The time zone is set per process, so each zone runs in its own child process.
import { pledgeWindow } from '@/lib/pledge/pledge'

// Node's types aren't part of this project's tsconfig, and this is the only Node API the test needs.
const { execFileSync } = require('node:child_process') as {
  execFileSync(
    file: string,
    args: string[],
    opts: { env: Record<string, string | undefined>; encoding: 'utf8' },
  ): string
}

let checks = 0
const assert = {
  ok(cond: unknown, msg: string) {
    if (!cond) throw new Error(`FAILED: ${msg}`)
    checks++
  },
  equal(a: unknown, b: unknown, msg: string) {
    assert.ok(a === b, `${msg} (got ${String(a)}, want ${String(b)})`)
  },
}

const H = 3600_000
const ALIASES: Record<string, string> = { 'Europe/Kyiv': 'Europe/Kiev' }
const localTime = (ms: number, timeZone: string) => new Date(ms).toLocaleString('sv-SE', { timeZone, hour12: false })

function checkZone(timeZone: string, now: number, durationDays: number, wantFirstDay: string) {
  const w = pledgeWindow(now, durationDays)
  // ICU may report the older alias (Europe/Kiev for Europe/Kyiv); both name the same zone.
  assert.ok([timeZone, ALIASES[timeZone]].includes(w.tzName ?? ''), `${timeZone}: stored zone name (got ${w.tzName})`)
  assert.equal(w.bounds.length, durationDays + 2, `${timeZone}: N + 1 days plus the end`)
  w.bounds.forEach((b, i) =>
    assert.ok(
      localTime(b, timeZone).endsWith(' 00:00:00'),
      `${timeZone}: bound ${i} is local midnight (${localTime(b, timeZone)})`,
    ),
  )
  assert.equal(localTime(w.bounds[0], timeZone).slice(0, 10), wantFirstDay, `${timeZone}: first day`)
  const lengths = w.bounds.slice(1).map((b, i) => (b - w.bounds[i]) / H)
  return lengths
}

const zone = process.env.TZ
if (!zone) {
  // Parent: run this file once per zone.
  for (const tz of ['Europe/Kyiv', 'UTC', 'America/New_York']) {
    const out = execFileSync(process.execPath, [...process.execArgv, process.argv[1]], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    })
    process.stdout.write(out)
  }
} else if (zone === 'Europe/Kyiv') {
  // Created Oct 22, 15:00 Kyiv; 3 days + spare = Oct 23-26. Clocks go back on Oct 25 (04:00 EEST → 03:00 EET).
  const lengths = checkZone(zone, Date.UTC(2026, 9, 22, 12), 3, '2026-10-23')
  assert.equal(JSON.stringify(lengths), JSON.stringify([24, 24, 25, 24]), 'Kyiv: the DST day is 25 hours')
  // Midnight Kyiv in October summer time = 21:00 UTC the day before.
  assert.equal(
    new Date(pledgeWindow(Date.UTC(2026, 9, 10, 12), 3).bounds[0]).toISOString(),
    '2026-10-10T21:00:00.000Z',
    'Kyiv: Oct 11 starts 21:00 UTC',
  )
  // Created 23:55 local: the next midnight is too close, so the goal starts a day later.
  const late = pledgeWindow(Date.UTC(2026, 9, 22, 20, 55), 3)
  assert.equal(
    localTime(late.bounds[0], zone).slice(0, 10),
    '2026-10-24',
    'Kyiv: created 23:55 → starts the day after tomorrow',
  )
  console.log(`day bounds ${zone}: ${checks} checks passed`)
} else if (zone === 'UTC') {
  const lengths = checkZone(zone, Date.UTC(2026, 9, 22, 12), 3, '2026-10-23')
  assert.equal(JSON.stringify(lengths), JSON.stringify([24, 24, 24, 24]), 'UTC: all days 24 h')
  console.log(`day bounds ${zone}: ${checks} checks passed`)
} else {
  // US clocks go back on Nov 1, 2026.
  const lengths = checkZone(zone, Date.UTC(2026, 9, 30, 16), 3, '2026-10-31')
  assert.equal(JSON.stringify(lengths), JSON.stringify([24, 25, 24, 24]), 'New York: the DST day is 25 hours')
  console.log(`day bounds ${zone}: ${checks} checks passed`)
}
