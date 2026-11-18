// Sample goals (lib/dev/demo-pledges.ts) and the developer panel: debug builds, plus release builds made only for
// screenshots with EXPO_PUBLIC_LOCKIN_SAMPLES: '1' (sample goals captioned "Sample data") or 'store' (store listing
// shots, see STORE_SHOTS). A store build never sets it; the local build script names such an APK "-samples" or
// "-storeshots" and warns.
const SAMPLES = process.env.EXPO_PUBLIC_LOCKIN_SAMPLES
export const SAMPLES_ENABLED = __DEV__ || SAMPLES === '1' || SAMPLES === 'store'
/** Store screenshot builds: a curated set of sample goals without captions, and a sample wallet on the New goal screen. */
export const STORE_SHOTS = SAMPLES === 'store'
/** Sample goals say "Sample data" on screen, except in store screenshot builds. */
export const SAMPLE_CAPTIONS = !STORE_SHOTS
/** Store screenshot builds: the New goal screen shows this balance and the mainnet range instead of reading them. */
export const SAMPLE_WALLET = { skr: 1250, limits: { min: 100, max: 10_000, pausedNew: false } }
