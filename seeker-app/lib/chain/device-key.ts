// The phone's own key for automatic check-ins. It signs check-ins (and pays their fees)
// so a day gets recorded on-chain without a wallet prompt. On-chain it can only mark days
// and spend its own few lamports of SOL - it can never move a deposit.
//
// The secret lives in expo-secure-store (Android Keystore-encrypted, removed on uninstall).
// It is never logged or sent anywhere; only the public key goes on-chain.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Keypair } from '@solana/web3.js'
import * as SecureStore from 'expo-secure-store'
import { fromUint8Array, toUint8Array } from 'js-base64'

const storageKey = (owner: string) => `lockin.deviceKey.v1.${owner}`
const cache = new Map<string, Keypair>()

/** Builds before secure storage kept the key in AsyncStorage: move it over once, then erase the old copy. */
async function migrateFromAsyncStorage(owner: string): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(storageKey(owner))
  if (!legacy) return null
  await SecureStore.setItemAsync(storageKey(owner), legacy)
  await AsyncStorage.removeItem(storageKey(owner))
  return legacy
}

export async function loadDeviceKey(owner: string): Promise<Keypair | null> {
  const hit = cache.get(owner)
  if (hit) return hit
  const raw = (await SecureStore.getItemAsync(storageKey(owner))) ?? (await migrateFromAsyncStorage(owner))
  if (!raw) return null
  const kp = Keypair.fromSecretKey(toUint8Array(raw))
  cache.set(owner, kp)
  return kp
}

/** Drops this phone's key for `owner`, as an uninstall would ("Delete Lock-In data on this phone"). */
export async function forgetDeviceKey(owner: string): Promise<void> {
  cache.delete(owner)
  await SecureStore.deleteItemAsync(storageKey(owner))
  await AsyncStorage.removeItem(storageKey(owner))
}

/** Dev builds only (DevPanel "Simulate reinstall"). */
export async function devForgetDeviceKey(owner: string): Promise<void> {
  if (!__DEV__) return
  await forgetDeviceKey(owner)
}

/** One key per wallet on this phone, shared by all of that wallet's goals. */
export async function getOrCreateDeviceKey(owner: string): Promise<Keypair> {
  const existing = await loadDeviceKey(owner)
  if (existing) return existing
  const kp = Keypair.generate()
  await SecureStore.setItemAsync(storageKey(owner), fromUint8Array(kp.secretKey))
  cache.set(owner, kp)
  return kp
}
