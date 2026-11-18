import { Check, X } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { ChallengeDay, spareState, WEEKDAY_SHORT } from '@/lib/pledge/pledge'
import { colors, fonts } from './theme'
import { T } from './ui'

/**
 * The goal's calendar, the Lock-In progress mark: one circle per real calendar day (N + 1).
 * The spare day is an allowance for one miss, not a special last day, so every day looks alike;
 * the header says whether the spare is still free.
 * Once the goal is completed, a missed day and the days after completion turn neutral grey.
 * Long challenges (> 8 days) use a compact grid of small dots.
 */
/** `numbered`: test goals (minute-long days) label days "Day 1", "Day 2"; their weekdays would all be the same. */
export function DayTrack({
  days,
  showHeader = true,
  numbered = false,
}: {
  days: ChallengeDay[]
  showHeader?: boolean
  numbered?: boolean
}) {
  const required = days.length - 1
  const done = days.filter((d) => d.state === 'done').length
  const complete = done >= required
  return (
    <View style={{ gap: 12 }}>
      {showHeader && (
        <View style={styles.header}>
          <T variant="bodyStrong" style={{ flexShrink: 1 }}>
            {Math.min(done, required)} of {required} {required === 1 ? 'day' : 'days'} complete
          </T>
          <T variant="small" style={{ color: spareColor(days) }}>
            {spareLabel(days)}
          </T>
        </View>
      )}
      {days.length > 8 ? (
        <DotGrid days={days} complete={complete} />
      ) : (
        <CircleRow days={days} complete={complete} numbered={numbered} />
      )}
    </View>
  )
}

const SPARE: Record<ReturnType<typeof spareState>, { label: string; color: string }> = {
  free: { label: '1 spare day left', color: colors.accent },
  used: { label: 'Spare day used', color: colors.textSecondary },
  gone: { label: 'No spare left', color: colors.danger },
  'not-needed': { label: 'Spare day not needed', color: colors.textSecondary },
}

/** "1 spare day left", "Spare day used", "Spare day not needed", "No spare left". */
export function spareLabel(days: ChallengeDay[]): string {
  return SPARE[spareState(days)].label
}

function spareColor(days: ChallengeDay[]): string {
  return SPARE[spareState(days)].color
}

const STATE_LABEL: Record<ChallengeDay['state'], string> = {
  done: 'done',
  today: 'today',
  missed: 'missed',
  future: 'coming up',
  unneeded: 'not needed',
}

function CircleRow({ days, complete, numbered }: { days: ChallengeDay[]; complete: boolean; numbered: boolean }) {
  const label = (d: ChallengeDay, i: number) =>
    d.state === 'unneeded'
      ? '-'
      : numbered
        ? days.length <= 4
          ? `Day ${i + 1}`
          : `D${i + 1}`
        : WEEKDAY_SHORT[d.weekday]
  return (
    <View style={styles.row}>
      {days.map((d, i) => (
        <View
          key={d.day}
          style={styles.cell}
          accessible
          accessibilityLabel={`Day ${i + 1}, ${WEEKDAY_SHORT[d.weekday]}: ${STATE_LABEL[d.state]}`}
        >
          <Circle day={d} n={i + 1} complete={complete} />
          {/* Eight labels share one row: let them grow with the system font only a little. */}
          <T
            variant="caption"
            maxFontSizeMultiplier={1.1}
            style={d.state === 'today' ? { color: colors.accent } : undefined}
          >
            {label(d, i)}
          </T>
        </View>
      ))}
    </View>
  )
}

const SIZE = 32

function Circle({ day, n, complete }: { day: ChallengeDay; n: number; complete: boolean }) {
  switch (day.state) {
    case 'done':
      return (
        <View style={[styles.circle, { backgroundColor: colors.accent }]}>
          <Check size={18} color={colors.onAccent} strokeWidth={3} />
        </View>
      )
    case 'today':
      return (
        <View style={[styles.circle, { borderWidth: 2, borderColor: colors.accent }]}>
          <T variant="smallStrong" maxFontSizeMultiplier={1.1} style={{ color: colors.accent, fontFamily: fonts.bold }}>
            {n}
          </T>
        </View>
      )
    case 'missed':
      return (
        <View style={[styles.circle, { backgroundColor: complete ? colors.neutralSoft : colors.dangerSoft }]}>
          <X size={16} color={complete ? colors.textTertiary : colors.danger} strokeWidth={2.5} />
        </View>
      )
    case 'unneeded':
      return <View style={[styles.circle, { backgroundColor: colors.neutralSoft }]} />
    default:
      return (
        <View style={[styles.circle, { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }]}>
          <T variant="smallStrong" maxFontSizeMultiplier={1.1} style={{ color: colors.textSecondary }}>
            {n}
          </T>
        </View>
      )
  }
}

function DotGrid({ days, complete }: { days: ChallengeDay[]; complete: boolean }) {
  const todayIndex = days.findIndex((d) => d.isToday)
  const done = days.filter((d) => d.state === 'done').length
  const missed = days.filter((d) => d.state === 'missed').length
  const color = (d: ChallengeDay) =>
    d.state === 'done'
      ? colors.accent
      : d.state === 'missed'
        ? complete
          ? colors.borderStrong
          : colors.danger
        : d.state === 'unneeded'
          ? colors.neutralSoft
          : colors.raised
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.grid} accessible accessibilityLabel={`${done} days done, ${missed} missed`}>
        {days.map((d) => (
          <View
            key={d.day}
            style={[
              styles.dot,
              { backgroundColor: color(d) },
              d.isToday && { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.bg },
              d.state === 'future' && { borderWidth: 1, borderColor: colors.border },
            ]}
          />
        ))}
      </View>
      <T variant="caption">
        {todayIndex >= 0 ? `Day ${todayIndex + 1} of ${days.length} · ` : ''}
        {done} done{missed > 0 ? ` · ${missed} missed` : ''}
      </T>
    </View>
  )
}

/** Decorative: the sign-in illustration, three days done and today in progress. */
export function SampleTrack() {
  return (
    <View style={styles.sample} accessible={false} importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <View key={i} style={{ marginTop: i * 7 }}>
          {i < 3 ? (
            <View style={[styles.circle, { backgroundColor: colors.accent }]}>
              <Check size={18} color={colors.onAccent} strokeWidth={3} />
            </View>
          ) : i === 3 ? (
            <View style={[styles.circle, { borderWidth: 2, borderColor: colors.accent }]}>
              <T variant="smallStrong" style={{ color: colors.accent }}>
                4
              </T>
            </View>
          ) : (
            <View
              style={[styles.circle, { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border }]}
            >
              <T variant="smallStrong" style={{ color: colors.textSecondary }}>
                {i + 1}
              </T>
            </View>
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center', gap: 6, minWidth: SIZE },
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  sample: { flexDirection: 'row', justifyContent: 'space-between' },
})
