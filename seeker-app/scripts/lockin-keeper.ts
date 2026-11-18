// Lock-In keeper: settles every goal whose window has closed. Run from seeker-app:
//   npx tsx scripts/lockin-keeper.ts            one pass over the real and the fast TEST program (devnet)
//   npx tsx scripts/lockin-keeper.ts --dry-run  only list what would be settled
//   LOCKIN_NETWORK=mainnet npx tsx scripts/lockin-keeper.ts --dry-run   mainnet: the real program only;
//                                               settling there needs --yes instead of --dry-run
//
// `settle` is permissionless, but "anyone can" is not "someone will": this job is how forfeits (and returns
// nobody claimed) actually happen. It uses its own fee-paying key with no admin rights:
// program/keys/keeper-<devnet|mainnet>.json (created on first run; topped up from the admin key when low).
// It never decides an outcome; the program does. In safe mode it skips forfeits (the program would refuse).
// Env: LOCKIN_NETWORK, LOCKIN_RPC, LOCKIN_ADMIN (only used to top up the keeper's SOL): see scripts/network.ts.

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { existsSync, writeFileSync } from 'node:fs'
import { checkedDays, explainChainError, fetchAllPledges, fetchConfig, settleIx } from '../lib/chain/lockin-program'
import {
  ADMIN_KEY_PATH,
  explorerTx,
  FAST_PROGRAM,
  KEEPER_KEY_PATH,
  loadKeypair,
  MAINNET,
  REAL_PROGRAM,
  requireYesOnMainnet,
  RPC,
} from './network'

const PROGRAMS: { name: string; id: PublicKey }[] = [
  { name: 'real', id: REAL_PROGRAM },
  ...(MAINNET ? [] : [{ name: 'TEST (fast days)', id: FAST_PROGRAM }]),
]
const connection = new Connection(RPC, 'confirmed')
const dryRun = process.argv.includes('--dry-run')
const keeperPath = KEEPER_KEY_PATH
const MIN_KEEPER_LAMPORTS = 0.01 * LAMPORTS_PER_SOL
/** Top-up from the admin key when the keeper runs low: ~4,000 settlements on mainnet, plenty on devnet. */
const TOP_UP_LAMPORTS = (MAINNET ? 0.02 : 0.05) * LAMPORTS_PER_SOL

/** The keeper's own key: created once, kept with the other keys in program/keys (gitignored), never printed. */
function keeperKey(): Keypair {
  if (!existsSync(keeperPath)) {
    writeFileSync(keeperPath, JSON.stringify(Array.from(Keypair.generate().secretKey)))
    console.log('• Created a new keeper key')
  }
  return loadKeypair(keeperPath)
}

async function ensureFunded(keeper: Keypair) {
  const balance = await connection.getBalance(keeper.publicKey)
  if (balance >= MIN_KEEPER_LAMPORTS) return
  const admin = loadKeypair(ADMIN_KEY_PATH)
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: keeper.publicKey,
        lamports: TOP_UP_LAMPORTS,
      }),
    ),
    [admin],
  )
  console.log(`• Topped up the keeper with ${TOP_UP_LAMPORTS / LAMPORTS_PER_SOL} SOL from the admin key`)
}

async function main() {
  if (!dryRun) requireYesOnMainnet('keeper')
  const keeper = keeperKey()
  console.log(`keeper ${keeper.publicKey.toBase58()}${dryRun ? ' (dry run)' : ''}`)
  if (!dryRun) await ensureFunded(keeper)
  const now = Math.floor(Date.now() / 1000)
  let settled = 0
  for (const program of PROGRAMS) {
    const config = await fetchConfig(connection, program.id)
    if (!config) continue
    const due = (await fetchAllPledges(connection, program.id)).filter((p) => p.status === 'active' && now >= p.closeAt)
    console.log(
      `\n${program.name} program: ${due.length} active goal(s) past close_at${config.safeMode ? ', SAFE MODE ON' : ''}`,
    )
    for (const p of due) {
      const met = checkedDays(p).length >= p.days
      const label = `${p.address.toBase58()} ${met ? 'met → return to owner' : 'missed → forfeit'}`
      if (!met && config.safeMode) {
        console.log(`  skip ${label} (safe mode)`)
        continue
      }
      if (dryRun) {
        console.log(`  would settle ${label}`)
        continue
      }
      try {
        const sig = await sendAndConfirmTransaction(
          connection,
          new Transaction().add(settleIx(program.id, TOKEN_PROGRAM_ID, p)),
          [keeper],
        )
        settled++
        console.log(`  settled ${label}: ${explorerTx(sig)}`)
      } catch (e) {
        // e.g. close_at pushed back by a safe-mode period: the program says "too early", try again later.
        console.log(`  not yet ${label}: ${explainChainError(e).split('\n')[0]}`)
      }
    }
  }
  console.log(`\n${settled} settled`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
