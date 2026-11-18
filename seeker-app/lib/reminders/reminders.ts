// Local reminders (no server): settings, permission, and keeping Android's schedule in line with
// reminderPlan(). Only notifications whose id starts with REMINDER_ID_PREFIX are touched.

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { DEFAULT_REMINDER_SETTINGS, Reminder, REMINDER_ID_PREFIX, ReminderSettings } from './plan'

const SETTINGS_KEY = 'lockin.reminders.v1'
const CHANNEL_ID = 'reminders'

// Shown even while the app is open (the day is still not done, so the nudge still applies).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

// ---------------------------------------------------------------- settings

let current: ReminderSettings = DEFAULT_REMINDER_SETTINGS
const listeners = new Set<() => void>()

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY)
    if (raw) current = { ...DEFAULT_REMINDER_SETTINGS, ...(JSON.parse(raw) as Partial<ReminderSettings>) }
  } catch {
    // Unreadable settings: keep the defaults.
  }
  return current
}

export async function saveReminderSettings(next: ReminderSettings): Promise<void> {
  current = next
  listeners.forEach((l) => l())
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
}

export function onReminderSettingsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function reminderSettings(): ReminderSettings {
  return current
}

// ---------------------------------------------------------------- permission

export type ReminderPermission = 'granted' | 'denied' | 'undetermined'

/** 'undetermined' = not granted yet but we may still ask; 'denied' = only system settings can change it. */
export async function reminderPermission(): Promise<ReminderPermission> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return 'granted'
  return canAskAgain ? 'undetermined' : 'denied'
}

/**
 * Asks while the system still allows it (Android 13+ shows its prompt). Before the first ask Android
 * reports "denied" with canAskAgain, so canAskAgain - not the status - decides.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  const now = await Notifications.getPermissionsAsync()
  if (now.status === 'granted' || !now.canAskAgain) return now.status === 'granted' ? 'granted' : 'denied'
  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted' ? 'granted' : 'denied'
}

// ---------------------------------------------------------------- schedule

async function ensureChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Daily reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

/** Cancels every scheduled Lock-In reminder (used when the phone's Lock-In data is deleted). */
export async function cancelAllReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  for (const n of scheduled) {
    if (n.identifier.startsWith(REMINDER_ID_PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier)
  }
}

/** A new reminder this close to its time could fire before scheduling returns; skip it instead. */
const MIN_LEAD_MS = 30 * 1000

const fingerprint = (r: Pick<Reminder, 'at' | 'title' | 'body'>) => `${r.at}|${r.title}|${r.body}`

/** Makes the scheduled Lock-In reminders match `plan`, changing only what differs. */
export async function syncReminders(plan: Reminder[]): Promise<void> {
  if ((await reminderPermission()) !== 'granted') return
  await ensureChannel()
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) =>
    n.identifier.startsWith(REMINDER_ID_PREFIX),
  )
  const wanted = new Map(plan.map((r) => [r.id, r]))
  const have = new Map(
    scheduled.map((n) => [
      n.identifier,
      fingerprint({
        at: Number((n.content.data as { at?: number } | null)?.at ?? 0),
        title: n.content.title ?? '',
        body: n.content.body ?? '',
      }),
    ]),
  )

  for (const id of have.keys()) {
    const w = wanted.get(id)
    if (!w || fingerprint(w) !== have.get(id)) await Notifications.cancelScheduledNotificationAsync(id)
  }
  const now = Date.now()
  for (const r of plan) {
    if (have.get(r.id) === fingerprint(r)) continue
    if (r.at <= now + MIN_LEAD_MS) continue
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { at: r.at } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.at), channelId: CHANNEL_ID },
    })
  }
}
