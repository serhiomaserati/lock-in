import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

// On-chain config for Lock-In deposits. The network is fixed at build time:
// - devnet (default): a test SPL token ("tSKR") stands in for SKR, plus the fast TEST program;
// - mainnet: `EXPO_PUBLIC_LOCKIN_NETWORK=mainnet` → the real SKR mint (classic SPL Token, 6 decimals,
//   no freeze authority; checked on mainnet RPC 2026-10-17), no TEST program;
// - localnet (local testing only, see constants/app-config.ts): EXPO_PUBLIC_LOCKIN_CLUSTER=localnet and
//   EXPO_PUBLIC_LOCKIN_MINT=<local test mint>.
// Until `mint` is set, pledges are recorded only on the phone (demo mode) so the UI stays usable.
const LOCAL = process.env.EXPO_PUBLIC_LOCKIN_CLUSTER === 'localnet'
const LOCAL_MINT = process.env.EXPO_PUBLIC_LOCKIN_MINT
const MAINNET = !LOCAL && process.env.EXPO_PUBLIC_LOCKIN_NETWORK === 'mainnet'

const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3')
const TSKR_MINT = new PublicKey('hu6XqWdhxgv2GfLzz69LjsPNz3XV58Q7577Hg3f8iai')

export const LockInConfig = {
  cluster: (LOCAL ? 'localnet' : MAINNET ? 'mainnet' : 'devnet') as 'devnet' | 'localnet' | 'mainnet',
  /** The Lock-In program (program/ in the project root): the same address on devnet and mainnet. */
  programId: new PublicKey('6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv'),
  /**
   * Devnet only: a separate TEST build of the same program with minute-long days
   * (program/test-config/build-fast.sh), for clicking through time-based scenarios. Null on mainnet.
   */
  fastProgramId: (MAINNET ? null : new PublicKey('8ScDBWhxUadKGvggckCQ3Hb8tVbykmsyKWm4Z6Pzi2nc')) as PublicKey | null,
  /** SKR on mainnet, tSKR on devnet (scripts/devnet-config.json); null = demo mode, nothing on-chain. */
  mint: (LOCAL && LOCAL_MINT ? new PublicKey(LOCAL_MINT) : MAINNET ? SKR_MINT : TSKR_MINT) as PublicKey | null,
  tokenProgram: TOKEN_PROGRAM_ID,
  decimals: 6,
  /** Devnet and localnet use a test token: never present it as real SKR. */
  tokenSymbol: MAINNET ? 'SKR' : 'tSKR',
  /** The phone's check-in key is topped up to this (SOL for check-in fees, ~600 check-ins). */
  deviceTopUpLamports: 3_000_000,
  /** …whenever it drops below this. */
  deviceMinLamports: 1_500_000,
  /**
   * SOL a new goal needs at the least: ~0.0036 storage + the fee, and the wallet has to stay rent-exempt
   * (~0.0009). The phone key's top-up can add up to 0.003; the pre-wallet simulation catches that case.
   */
  minGoalLamports: 4_500_000,
}

export function isMainnet(): boolean {
  return LockInConfig.cluster === 'mainnet'
}

/** "Solana mainnet" / "Solana devnet" for the UI. */
export function networkName(): string {
  return LockInConfig.cluster === 'localnet' ? 'Localnet' : `Solana ${LockInConfig.cluster}`
}

/** Where a missed goal's deposit goes, as the UI names it. */
export function forfeitRecipientName(): string {
  return isMainnet() ? 'Lock-In treasury' : 'Test treasury (devnet)'
}

export function isLockEnabled(): boolean {
  return LockInConfig.mint !== null
}

/** Fast test days: test clusters only (fastProgramId is null on mainnet). */
export function canUseTestTiming(): boolean {
  return isLockEnabled() && LockInConfig.fastProgramId !== null
}

/** Test timing (fast program): one "day" lasts this long, and the challenge starts after this lead. */
export const TEST_DAY_MS = 3 * 60 * 1000
export const TEST_LEAD_MS = 90 * 1000

// Seeker Genesis Token (SGT) - a Token-2022 NFT every Seeker owner holds.
// A wallet holds an SGT only when all three extension checks pass on one of its
// Token-2022 mints. Holders get a Seeker badge (no money bonus).
export const SeekerGenesis = {
  mintAuthority: new PublicKey('GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4'),
  group: new PublicKey('GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te'),
}
