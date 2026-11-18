import { Linking, Platform } from 'react-native'
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  RecordingMethod,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect'
import { StepSample, verifiedSteps } from './step-math'

// Step proof via Android Health Connect. Health Connect aggregates steps written by
// the phone / fitness apps (Google Fit, Samsung Health, Fitbit, ...). We only read.
//
// We read the raw records and count them ourselves (step-math.ts) so manual entries can be
// excluded without disturbing the de-duplication between phone and watch.

export type StepsAccess = 'unsupported' | 'needs-install' | 'needs-permission' | 'ready'

const HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata'
const STEPS_READ = { accessType: 'read', recordType: 'Steps' } as const

export async function getStepsAccess(): Promise<StepsAccess> {
  if (Platform.OS !== 'android') return 'unsupported'
  try {
    const status = await getSdkStatus()
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE) return 'unsupported'
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs-install'
    if (!(await initialize())) return 'unsupported'
    const granted = await getGrantedPermissions()
    const hasSteps = granted.some((p) => p.accessType === 'read' && p.recordType === 'Steps')
    return hasSteps ? 'ready' : 'needs-permission'
  } catch {
    return 'unsupported'
  }
}

/** Shows the Health Connect permission sheet. Resolves true if steps read access was granted. */
export async function requestStepsAccess(): Promise<boolean> {
  if (Platform.OS !== 'android') return false
  if (!(await initialize())) return false
  const granted = await requestPermission([STEPS_READ])
  return granted.some((p) => p.accessType === 'read' && p.recordType === 'Steps')
}

/** Opens Health Connect so the user can review or revoke Lock-In's access. */
export function openStepSettings(): void {
  if (Platform.OS === 'android') openHealthConnectSettings()
}

/** Health Connect is a separate app on Android 13 and below - send the user to install/update it. */
export function openHealthConnectInstall(): void {
  Linking.openURL(`market://details?id=${HEALTH_CONNECT_PACKAGE}`).catch(() =>
    Linking.openURL(`https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PACKAGE}`),
  )
}

export interface DayWindow {
  day: number // key: the day's start (pledge timezone)
  from: number // ms epoch, inclusive
  to: number // ms epoch
}

export interface DailySteps {
  /** day key → verified steps for that day */
  byDay: Map<number, number>
  /** Apps that contributed step data (empty = nothing on the phone is tracking steps). */
  sources: string[]
}

function between(from: number, to: number) {
  return { operator: 'between', startTime: new Date(from).toISOString(), endTime: new Date(to).toISOString() } as const
}

/** Verified steps for each window - see step-math.ts for the counting rules. */
export async function readDailySteps(windows: DayWindow[]): Promise<DailySteps> {
  const byDay = new Map<number, number>()
  if (windows.length === 0) return { byDay, sources: [] }

  const rangeFrom = Math.min(...windows.map((w) => w.from))
  const rangeTo = Math.max(...windows.map((w) => w.to))
  const samples: StepSample[] = []
  let pageToken: string | undefined
  do {
    const page = await readRecords('Steps', { timeRangeFilter: between(rangeFrom, rangeTo), pageToken })
    for (const r of page.records) {
      samples.push({
        start: new Date(r.startTime).getTime(),
        end: new Date(r.endTime).getTime(),
        count: r.count,
        origin: r.metadata?.dataOrigin ?? 'unknown',
        manual: r.metadata?.recordingMethod === RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
      })
    }
    pageToken = page.pageToken || undefined
  } while (pageToken)

  for (const w of windows) byDay.set(w.day, verifiedSteps(samples, w.from, w.to))
  const sources = [...new Set(samples.filter((x) => !x.manual).map((x) => x.origin))]
  return { byDay, sources }
}
