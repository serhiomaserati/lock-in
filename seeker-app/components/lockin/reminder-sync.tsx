import { useEffect, useState } from 'react'
import { usePledges } from '@/lib/pledge/pledge-provider'
import { reminderPlan } from '@/lib/reminders/plan'
import {
  loadReminderSettings,
  onReminderSettingsChange,
  reminderSettings,
  syncReminders,
} from '@/lib/reminders/reminders'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'

/** Keeps the scheduled reminders in line with the goals. Renders nothing. */
export function ReminderSync() {
  const { pledges, loading, clockTick } = usePledges()
  const owner = useWalletPublicKey()?.toBase58()
  const [settings, setSettings] = useState(reminderSettings)

  useEffect(() => {
    loadReminderSettings().then(setSettings)
    return onReminderSettingsChange(() => setSettings(reminderSettings()))
  }, [])

  // Debounced: goal syncs arrive in bursts, and rescheduling means a round of native calls.
  useEffect(() => {
    if (loading) return
    const timer = setTimeout(() => {
      // Real time, not the dev clock: Android fires these at real moments.
      const plan = reminderPlan(pledges, owner, settings, Date.now())
      syncReminders(plan).catch((e) => console.warn('Lock-In: reminders not updated', e))
    }, 1_000)
    return () => clearTimeout(timer)
  }, [pledges, loading, owner, settings, clockTick])

  return null
}
