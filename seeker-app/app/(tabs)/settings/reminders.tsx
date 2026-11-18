import { useFocusEffect } from 'expo-router'
import { BellOff, Smartphone } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { Screen } from '@/components/lockin/screen'
import { colors, radius, space } from '@/components/lockin/theme'
import { Button, Card, DemoNote, Divider, Notice, Segmented, T, Toggle } from '@/components/lockin/ui'
import { formatHour, REMINDER_HOURS } from '@/lib/reminders/plan'
import {
  loadReminderSettings,
  reminderPermission,
  ReminderPermission,
  requestReminderPermission,
  saveReminderSettings,
} from '@/lib/reminders/reminders'

export default function RemindersScreen() {
  const [enabled, setEnabled] = useState(true)
  const [hour, setHour] = useState(20)
  const [permission, setPermission] = useState<ReminderPermission | null>(null)

  useEffect(() => {
    loadReminderSettings().then((s) => {
      setEnabled(s.enabled)
      setHour(s.hour)
    })
  }, [])

  // Re-read on focus: the user may have come back from the system settings.
  useFocusEffect(
    useCallback(() => {
      reminderPermission().then(setPermission)
    }, []),
  )

  async function update(next: { enabled: boolean; hour: number }) {
    setEnabled(next.enabled)
    setHour(next.hour)
    await saveReminderSettings(next)
    if (next.enabled) setPermission(await requestReminderPermission())
  }

  return (
    <Screen title="Daily reminder" back>
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading">Remind me</T>
            <T variant="small">Only when today is unfinished.</T>
          </View>
          <Toggle value={enabled} onChange={(v) => update({ enabled: v, hour })} label="Daily reminder" />
        </View>
        {enabled && (
          <>
            <Divider />
            <T variant="small">Reminder time</T>
            <View style={styles.time} accessible accessibilityLabel={`Reminder at ${formatHour(hour)}`}>
              <T variant="number">{formatHour(hour)}</T>
            </View>
            <Segmented
              label="Reminder time"
              options={REMINDER_HOURS}
              value={hour as (typeof REMINDER_HOURS)[number]}
              onChange={(h) => update({ enabled, hour: h })}
              format={formatHour}
            />
            <T variant="caption">Uses each goal&apos;s time zone.</T>
          </>
        )}
      </Card>

      {enabled && permission === 'undetermined' && (
        <Button label="Allow notifications" onPress={async () => setPermission(await requestReminderPermission())} />
      )}
      {enabled && permission === 'denied' && (
        <Notice
          tone="warning"
          icon={BellOff}
          title="Notifications are off for Lock-In"
          action={<Button kind="secondary" label="Open phone settings" onPress={() => Linking.openSettings()} />}
        >
          Allow them in your phone&apos;s settings to get reminders.
        </Notice>
      )}

      <Card style={styles.row}>
        <Smartphone size={26} color={colors.textSecondary} strokeWidth={1.75} />
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="bodyStrong">For step goals, open Lock-In to record your steps.</T>
          <T variant="small">One final reminder arrives 2 hours before late step checking ends.</T>
        </View>
      </Card>
      <DemoNote />
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  time: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.xl,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
  },
})
