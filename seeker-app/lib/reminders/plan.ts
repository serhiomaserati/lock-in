// Which reminders should be scheduled right now. Pure, so it can be tested without a phone.
//
// One reminder per challenge day that isn't done yet, at the chosen hour (wall clock in the goal's
// time zone), plus a last call for step goals before late data stops counting. A step day is only
// recorded when the app runs and syncs, so for those the reminder is "open the app", not "do it".

import {
  challengeDays,
  isDemoPledge,
  isStillReachable,
  Pledge,
  pledgeStatus,
  proofKind,
  verifyUntil,
} from '@/lib/pledge/pledge'

export interface ReminderSettings {
  enabled: boolean
  /** Hour of the day, 0-23, in the goal's time zone. */
  hour: number
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: true, hour: 20 }
export const REMINDER_HOURS = [18, 19, 20, 21, 22] as const

export const formatHour = (h: number) => `${String(h).padStart(2, '0')}:00`

export interface Reminder {
  /** Stable per goal and day, so a re-plan only touches what changed. */
  id: string
  at: number
  title: string
  body: string
}

const HOUR_MS = 60 * 60 * 1000
/** Test goals (minute-long days): remind this long before the day ends instead of at a clock hour. */
const TEST_LEAD_MS = 2 * 60 * 1000
const LAST_CALL_LEAD_MS = 2 * HOUR_MS
// A reminder stays planned after its time until the moment it is about (end of the day, close of the goal):
// Android delivers these alarms late (up to an hour), and a re-plan that dropped it would cancel it unshown.
/** Android caps scheduled alarms per app; a handful of goals never comes close to this. */
const MAX_REMINDERS = 60

export const REMINDER_ID_PREFIX = 'lockin:'

export function reminderPlan(
  pledges: Pledge[],
  owner: string | undefined,
  settings: ReminderSettings,
  now: number,
): Reminder[] {
  if (!settings.enabled || !owner) return []
  const out: Reminder[] = []
  for (const p of pledges) {
    if (p.owner !== owner || isDemoPledge(p)) continue
    const status = pledgeStatus(p, now)
    const steps = proofKind(p) === 'steps'

    if ((status === 'active' || status === 'upcoming') && isStillReachable(p, now)) {
      challengeDays(p, now).forEach((d, i) => {
        if (d.state === 'done') return
        // Counting back from the end of the day keeps the wall-clock hour right on DST days
        // (the clock changes at night, not between the reminder and midnight).
        const at = p.testTiming ? d.end - TEST_LEAD_MS : d.end - (24 - settings.hour) * HOUR_MS
        if (d.end <= now) return
        out.push({
          id: `${REMINDER_ID_PREFIX}${p.id}:${i}`,
          at,
          title: p.goal,
          body: steps
            ? "Open Lock-In so today's steps are recorded."
            : 'You haven’t checked in today. Check in before midnight.',
        })
      })
    }

    // Step days can still be recorded until the goal closes; after that they're lost.
    if (steps && (status === 'active' || status === 'verifying')) {
      const closes = verifyUntil(p)
      const at = closes - (p.testTiming ? TEST_LEAD_MS : LAST_CALL_LEAD_MS)
      if (closes > now) {
        out.push({
          id: `${REMINDER_ID_PREFIX}${p.id}:last`,
          at,
          title: p.goal,
          body: 'Last chance: open Lock-In so the days you walked are recorded.',
        })
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS)
}
