// Devnet testing switch: new goals go to the fast TEST program, where a "day" lasts minutes.
// Goals keep the program they were created on, so switching never affects existing ones.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { PublicKey } from '@solana/web3.js'
import { canUseTestTiming, LockInConfig } from '@/constants/lockin'

const KEY = 'lockin.testTiming.v1'
let enabled = false
const listeners = new Set<() => void>()

export function isTestTiming(): boolean {
  return enabled && canUseTestTiming()
}

export async function loadTestTiming(): Promise<boolean> {
  enabled = (await AsyncStorage.getItem(KEY).catch(() => null)) === '1'
  listeners.forEach((l) => l())
  return isTestTiming()
}

export async function setTestTiming(on: boolean): Promise<void> {
  enabled = on && canUseTestTiming()
  await AsyncStorage.setItem(KEY, enabled ? '1' : '0')
  listeners.forEach((l) => l())
}

export function onTestTimingChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Program new goals are created on. */
export function newPledgeProgram(): PublicKey {
  return isTestTiming() ? LockInConfig.fastProgramId! : LockInConfig.programId
}

/** Every program this build may have goals on (for restoring them by wallet). */
export function knownPrograms(): PublicKey[] {
  return canUseTestTiming() ? [LockInConfig.programId, LockInConfig.fastProgramId!] : [LockInConfig.programId]
}
