// End-to-end check of the app's Lock-In client (lib/chain/lockin-program.ts) against a deployed program.
// Run after `lockin-admin.ts setup` on the same cluster/program:
//   npx tsx scripts/lockin-e2e.ts                    real program: win, double payout, device key swap
//   LOCKIN_FAST=1 npx tsx scripts/lockin-e2e.ts      fast TEST program: + loss after close, safe mode (~6 min)
// Env LOCKIN_RPC as in lockin-admin.ts. Uses fresh throwaway wallets funded by the admin.

import { getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ChainPledge,
  checkedDays,
  checkInIx,
  closePledgeIx,
  configAddress,
  createPledgeIx,
  explainChainError,
  fetchPledge,
  fetchPledgesByOwner,
  pledgeAddress,
  refundIx,
  setDeviceKeyIx,
  settleIx,
  vaultAddress,
} from '../lib/chain/lockin-program'

const FAST = process.env.LOCKIN_FAST === '1'
const PROGRAM_ID = new PublicKey(
  FAST ? '8ScDBWhxUadKGvggckCQ3Hb8tVbykmsyKWm4Z6Pzi2nc' : '6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv',
)
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const here = dirname(fileURLToPath(import.meta.url))
const rpc = process.env.LOCKIN_RPC ?? 'https://api.devnet.solana.com'
const cluster = /localhost|127\.0\.0\.1/.test(rpc) ? 'localnet' : 'devnet'
const connection = new Connection(rpc, 'confirmed')
const state = JSON.parse(readFileSync(join(here, `${cluster}-config.json`), 'utf8'))
const mint = new PublicKey(state.mint)
const forfeitTo = new PublicKey(state.forfeitTo)
const admin = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(process.env.LOCKIN_ADMIN ?? join(here, '../../program/keys/deployer-devnet.json'), 'utf8')),
  ),
)

const DEPOSIT = 5_000_000n // 5 tSKR
// Real program: days of at least 22h. Fast TEST program: days of at least 60s, close_at = end + 180s.
const DAY = FAST ? 60 : 22 * 3600
const GRACE = FAST ? 180 : 24 * 3600

function tx(sig: string) {
  return cluster === 'devnet' ? `https://explorer.solana.com/tx/${sig}?cluster=devnet` : sig
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${msg}`)
  console.log(`  ✓ ${msg}`)
}
async function send(signers: Keypair[], ...ixs: TransactionInstruction[]) {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers)
}
/** Sends and expects the program to reject with `message`. */
async function rejects(message: string, what: string, signers: Keypair[], ...ixs: TransactionInstruction[]) {
  try {
    await send(signers, ...ixs)
  } catch (e) {
    const got = explainChainError(e)
    assert(got === message, `${what} → rejected: "${got}"`)
    return
  }
  throw new Error(`FAILED: ${what} went through`)
}
async function chainNow(): Promise<number> {
  return (await connection.getBlockTime(await connection.getSlot('confirmed')))!
}
async function waitUntil(t: number) {
  while ((await chainNow()) < t) await new Promise((r) => setTimeout(r, 2000))
}
async function balance(account: PublicKey) {
  return (await getAccount(connection, account)).amount
}
const adminIx = (disc: number[], on: boolean) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: configAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([...disc, on ? 1 : 0]),
  })
const setSafeMode = (on: boolean) => send([admin], adminIx([174, 243, 122, 183, 2, 140, 100, 142], on))

/** A throwaway wallet with SOL and tSKR, plus its phone key. */
async function newUser() {
  const owner = Keypair.generate()
  const device = Keypair.generate()
  await send(
    [admin],
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: owner.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: device.publicKey, lamports: 3_000_000 }),
  )
  const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner.publicKey)
  await mintTo(connection, admin, mint, ata.address, admin, 10n * DEPOSIT)
  return { owner, device, ata: ata.address }
}

/** A 1-day self check-in goal starting a few seconds from now. */
async function createGoal(u: Awaited<ReturnType<typeof newUser>>, id: bigint) {
  const start = (await chainNow()) + 8
  const bounds = [start, start + DAY, start + 2 * DAY]
  const sig = await send(
    [u.owner],
    createPledgeIx({
      programId: PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM,
      owner: u.owner.publicKey,
      mint,
      id,
      amount: DEPOSIT,
      days: 1,
      proof: 'manual',
      stepsPerDay: 0,
      bounds,
      tzName: 'Europe/Kyiv',
      deviceKey: u.device.publicKey,
    }),
  )
  const address = pledgeAddress(PROGRAM_ID, u.owner.publicKey, id)
  return { address, start, bounds, sig }
}
const load = async (a: PublicKey) => (await fetchPledge(connection, a)) as ChainPledge

async function winAndDeviceSwap() {
  console.log('\n[1] Win: create → device check-in → payout once; device key swap')
  const u = await newUser()
  const g = await createGoal(u, 1n)
  console.log(`  create: ${tx(g.sig)}`)
  let p = await load(g.address)
  assert(p.owner.equals(u.owner.publicKey) && p.amount === DEPOSIT && p.days === 1, 'pledge decoded')
  assert(JSON.stringify(p.bounds) === JSON.stringify(g.bounds) && p.closeAt === g.bounds[2] + GRACE, 'calendar decoded')
  assert((await balance(vaultAddress(PROGRAM_ID, g.address))) === DEPOSIT, 'deposit in the vault')
  await rejects(
    'That day has not started yet.',
    'early check-in',
    [u.device],
    checkInIx(PROGRAM_ID, u.device.publicKey, g.address, 0),
  )

  // New phone: the owner links a new key; the old one stops working at once.
  const newDevice = Keypair.generate()
  await send(
    [u.owner],
    SystemProgram.transfer({ fromPubkey: u.owner.publicKey, toPubkey: newDevice.publicKey, lamports: 3_000_000 }),
    setDeviceKeyIx(PROGRAM_ID, u.owner.publicKey, g.address, newDevice.publicKey),
  )
  await waitUntil(g.start)
  await rejects(
    'This phone is not linked to the goal.',
    'old device key check-in',
    [u.device],
    checkInIx(PROGRAM_ID, u.device.publicKey, g.address, 0),
  )
  const checkSig = await send([newDevice], checkInIx(PROGRAM_ID, newDevice.publicKey, g.address, 0))
  console.log(`  check-in (new device key): ${tx(checkSig)}`)
  p = await load(g.address)
  assert(JSON.stringify(checkedDays(p)) === '[0]', 'new device key checked in day 0')

  const settleSig = await send([newDevice], settleIx(PROGRAM_ID, TOKEN_PROGRAM, p))
  console.log(`  payout: ${tx(settleSig)}`)
  p = await load(g.address)
  assert(p.status === 'returned', 'deposit returned')
  assert((await balance(u.ata)) === 10n * DEPOSIT, 'owner has the full deposit back')
  assert((await connection.getAccountInfo(vaultAddress(PROGRAM_ID, g.address))) === null, 'vault closed')
  try {
    await send([newDevice], settleIx(PROGRAM_ID, TOKEN_PROGRAM, p))
    throw new Error('FAILED: second payout went through')
  } catch (e) {
    assert(!String(e).includes('second payout went through'), 'second payout rejected')
  }
  assert((await balance(u.ata)) === 10n * DEPOSIT, 'balance unchanged after the second attempt')
  const mine = await fetchPledgesByOwner(connection, PROGRAM_ID, u.owner.publicKey)
  assert(mine.length === 1 && mine[0].address.equals(g.address), 'found by owner (restore)')
  await send([u.owner], closePledgeIx(PROGRAM_ID, u.owner.publicKey, g.address))
  assert((await connection.getAccountInfo(g.address)) === null, 'closed by owner')
}

async function lossAndSafeMode() {
  console.log('\n[2] Loss after close_at; safe mode blocks forfeits, refunds work (fast TEST program)')
  const u = await newUser()
  const stranger = Keypair.generate()
  await send(
    [admin],
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: stranger.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    }),
  )
  const lose = await createGoal(u, 10n)
  const blocked = await createGoal(u, 11n)
  const refunded = await createGoal(u, 12n)
  const treasuryBefore = await balance(forfeitTo)

  await rejects(
    'Too early: the goal can still be completed.',
    'forfeit before close_at',
    [stranger],
    settleIx(PROGRAM_ID, TOKEN_PROGRAM, await load(lose.address)),
  )
  // Wait until all three windows are closed, so safe mode starts after every close_at (no extension).
  const lastClose = Math.max(lose.bounds[2], blocked.bounds[2], refunded.bounds[2]) + GRACE
  console.log(`  waiting for close_at (~${lastClose - (await chainNow())}s)…`)
  await waitUntil(lastClose + 1)
  await rejects(
    'Check-ins for this goal are closed.',
    'check-in after close_at',
    [u.device],
    checkInIx(PROGRAM_ID, u.device.publicKey, lose.address, 0),
  )
  const forfeitSig = await send([stranger], settleIx(PROGRAM_ID, TOKEN_PROGRAM, await load(lose.address)))
  console.log(`  forfeit (sent by a stranger): ${tx(forfeitSig)}`)
  assert((await load(lose.address)).status === 'forfeited', 'missed goal forfeited')
  assert((await balance(forfeitTo)) === treasuryBefore + DEPOSIT, 'deposit went to the recorded forfeit account')

  const onSig = await setSafeMode(true)
  console.log(`  safe mode on: ${tx(onSig)}`)
  try {
    await rejects(
      'Lock-In is in safe mode: new goals and forfeits are paused.',
      'forfeit in safe mode',
      [stranger],
      settleIx(PROGRAM_ID, TOKEN_PROGRAM, await load(blocked.address)),
    )
    const before = await balance(u.ata)
    const refundSig = await send(
      [u.owner],
      refundIx(PROGRAM_ID, TOKEN_PROGRAM, u.owner.publicKey, await load(refunded.address)),
    )
    console.log(`  refund in safe mode: ${tx(refundSig)}`)
    assert((await load(refunded.address)).status === 'refunded', 'refund in safe mode works')
    assert((await balance(u.ata)) === before + DEPOSIT, 'refund went to the owner')
  } finally {
    const offSig = await setSafeMode(false)
    console.log(`  safe mode off: ${tx(offSig)}`)
  }
  await rejects(
    'Only allowed in safe mode',
    'refund outside safe mode',
    [u.owner],
    refundIx(PROGRAM_ID, TOKEN_PROGRAM, u.owner.publicKey, await load(blocked.address)),
  )
  // Its window closed before safe mode began, so no extension: the rules apply again right away.
  await send([stranger], settleIx(PROGRAM_ID, TOKEN_PROGRAM, await load(blocked.address)))
  assert((await load(blocked.address)).status === 'forfeited', 'after safe mode, the blocked forfeit goes through')
}

async function main() {
  console.log(`cluster ${cluster}, program ${PROGRAM_ID.toBase58()}${FAST ? ' (fast TEST)' : ''}`)
  await winAndDeviceSwap()
  if (FAST) await lossAndSafeMode()
  console.log('\nE2E OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
