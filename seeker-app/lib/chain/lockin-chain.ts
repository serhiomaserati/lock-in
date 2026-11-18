// Transactions for Lock-In: the wallet signs deposits, device links and safe-mode refunds; the phone's
// device key signs (and pays for) check-ins and payouts, so those happen without a wallet prompt.
// Every call takes the program the goal lives on (the real one, or the devnet fast TEST program).

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { AppState } from 'react-native'
import { LockInConfig } from '@/constants/lockin'
import { getOrCreateDeviceKey } from './device-key'
import {
  ChainPledge,
  checkInIx,
  createPledgeIx,
  fetchPledge,
  pledgeAddress,
  refundIx,
  setDeviceKeyIx,
  settleIx,
} from './lockin-program'

/**
 * The wallet only signs (Mobile Wallet Adapter); Lock-In sends. Asking the wallet to send cost us
 * deposits that never landed: Phantom on devnet returned a signature for a transaction no cluster
 * ever saw, and the app could only wait for its blockhash to expire.
 *
 * The signer gets a builder rather than a finished transaction so it can put a fresh blockhash in
 * right before the wallet opens (see freshBlockhash): wallet screens eat most of a blockhash's ~60 s
 * life (Phantom asks to connect again before every transaction).
 */
export type SignWith = (
  build: (recentBlockhash: string) => VersionedTransaction,
) => Promise<{ signed: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }>

/** Check-ins per transaction (each is ~3 accounts + 9 bytes, well inside the size limit). */
const CHECK_INS_PER_TX = 8

/**
 * Commitment of the blockhash in wallet-signed transactions. Solflare (and Seed Vault, the same engine) checks it
 * at 'finalized': a 'confirmed' one, ~13 s newer, isn't known there yet and the wallet shows "Transaction expired"
 * right away (seen 2026-10-21, Solflare 2.30 on mainnet). A finalized blockhash still has ~118 of its 150 blocks.
 */
const WALLET_BLOCKHASH_COMMITMENT = 'finalized'

/** Blocks a blockhash should still have left when a wallet prompt opens (~40 s). */
const MIN_BLOCKS_LEFT = 100

/** Below this many blocks left (~6 s) a just-signed transaction is re-signed instead of sent. */
const MIN_BLOCKS_TO_SEND = 15

/** How often a sent transaction is re-broadcast until it confirms or its blockhash expires. */
const RESEND_EVERY_MS = 2_000

/** A recent blockhash with most of its life left: public RPC nodes behind a load balancer sometimes serve a stale one. */
export async function freshBlockhash(connection: Connection) {
  let latest = await connection.getLatestBlockhash(WALLET_BLOCKHASH_COMMITMENT)
  for (let attempt = 0; attempt < 3; attempt++) {
    const height = await connection.getBlockHeight('confirmed')
    if (latest.lastValidBlockHeight - height >= MIN_BLOCKS_LEFT) break
    latest = await connection.getLatestBlockhash(WALLET_BLOCKHASH_COMMITMENT)
  }
  return latest
}

/**
 * A recent blockhash, or null when it can't be had quickly. Used from inside a wallet session, where the
 * first request after the app went to the background may fail; a short retry covers a dropped connection.
 */
export async function latestBlockhashOrNull(connection: Connection) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await connection.getLatestBlockhash(WALLET_BLOCKHASH_COMMITMENT)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  return null
}

async function confirm(connection: Connection, signature: string, blockhash: string, lastValidBlockHeight: number) {
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`)
}

/**
 * The wallet hands back the signed transaction while it is still in front, and a request made by the
 * backgrounded app can fail outright ("Network request failed"). Wait until we're back, at most a few seconds.
 */
async function whenInForeground(maxWaitMs = 5_000) {
  if (AppState.currentState === 'active') return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, maxWaitMs)
    const sub = AppState.addEventListener('change', (state) => state === 'active' && done())
    function done() {
      clearTimeout(timer)
      sub.remove()
      resolve()
    }
  })
}

/** First send, with a preflight check so program errors surface; network failures are retried. */
async function sendFirst(connection: Connection, raw: Uint8Array): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connection.sendRawTransaction(raw, { maxRetries: 0, preflightCommitment: 'confirmed' })
    } catch (e) {
      const network = e instanceof TypeError && /network request failed/i.test(e.message)
      if (!network || attempt >= 3) throw e
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
}

/** Sends a signed transaction and keeps re-sending it until it confirms or its blockhash expires. */
async function sendAndConfirm(
  connection: Connection,
  tx: VersionedTransaction,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<string> {
  const raw = tx.serialize()
  await whenInForeground()
  const signature = await sendFirst(connection, raw)
  let settled = false
  void (async () => {
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, RESEND_EVERY_MS))
      if (!settled) await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {})
    }
  })()
  try {
    await confirm(connection, signature, blockhash, lastValidBlockHeight)
  } finally {
    settled = true
  }
  return signature
}

/** Any valid blockhash: the simulation swaps in a current one (replaceRecentBlockhash). */
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58()

/**
 * Runs the transaction against the current chain state before any wallet sees it, so the wallet is never
 * asked to sign one that can only fail (not enough SOL or SKR, a goal settled meanwhile, paused deposits).
 * Signatures aren't checked: nothing is signed yet. The error carries the logs, so explainChainError can
 * name the cause.
 */
async function simulateFirst(connection: Connection, tx: VersionedTransaction) {
  const { value } = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  })
  if (value.err) {
    const logs = (value.logs ?? []).join('\n')
    throw new Error(`Simulation failed: ${JSON.stringify(value.err)}${logs ? `\n${logs}` : ''}`)
  }
}

export async function sendAsOwner(
  connection: Connection,
  sign: SignWith,
  owner: PublicKey,
  instructions: TransactionInstruction[],
): Promise<string> {
  const build = (recentBlockhash: string) =>
    new VersionedTransaction(
      new TransactionMessage({ payerKey: owner, recentBlockhash, instructions }).compileToV0Message(),
    )
  await simulateFirst(connection, build(PLACEHOLDER_BLOCKHASH))
  // A slow pass through the wallet (Phantom: chooser, connect, confirm) can outlive the blockhash, and
  // no request can be made while the wallet is in front. If it's (nearly) expired by the time we're
  // back, ask the wallet once more rather than send a transaction that can only fail.
  for (let attempt = 1; ; attempt++) {
    const { signed, blockhash, lastValidBlockHeight } = await sign(build)
    await whenInForeground()
    const blocksLeft = lastValidBlockHeight - (await connection.getBlockHeight('confirmed'))
    if (blocksLeft < MIN_BLOCKS_TO_SEND && attempt < 2) continue
    return sendAndConfirm(connection, signed, blockhash, lastValidBlockHeight)
  }
}

export async function sendAsDevice(
  connection: Connection,
  device: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({ payerKey: device.publicKey, recentBlockhash: blockhash, instructions })
  const tx = new VersionedTransaction(message.compileToV0Message())
  tx.sign([device])
  return sendAndConfirm(connection, tx, blockhash, lastValidBlockHeight)
}

/** Owner → device key SOL, only when the key runs low (it pays check-in fees). */
async function topUpIx(connection: Connection, owner: PublicKey, device: PublicKey) {
  const balance = await connection.getBalance(device, 'confirmed')
  if (balance >= LockInConfig.deviceMinLamports) return []
  return [
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: device,
      lamports: LockInConfig.deviceTopUpLamports - balance,
    }),
  ]
}

export interface OpenPledgeInput {
  programId: PublicKey
  owner: PublicKey
  amountSkr: number
  days: number
  proof: 'manual' | 'steps'
  stepsPerDay: number
  boundsMs: number[]
  tzName?: string
}

/** Locks the deposit in a new on-chain pledge (one wallet approval). */
export async function openPledge(connection: Connection, sign: SignWith, input: OpenPledgeInput) {
  const { mint, tokenProgram, decimals } = LockInConfig
  if (!mint) throw new Error('On-chain deposits are not configured')
  const device = await getOrCreateDeviceKey(input.owner.toBase58())
  const id = BigInt(Date.now())
  const instructions = [
    ...(await topUpIx(connection, input.owner, device.publicKey)),
    createPledgeIx({
      programId: input.programId,
      tokenProgram,
      owner: input.owner,
      mint,
      id,
      amount: BigInt(Math.round(input.amountSkr * 10 ** decimals)),
      days: input.days,
      proof: input.proof,
      stepsPerDay: input.stepsPerDay,
      bounds: input.boundsMs.map((ms) => Math.floor(ms / 1000)),
      tzName: input.tzName ?? '',
      deviceKey: device.publicKey,
    }),
  ]
  const signature = await sendAsOwner(connection, sign, input.owner, instructions)
  const address = pledgeAddress(input.programId, input.owner, id)
  const pledge = await fetchPledge(connection, address)
  if (!pledge) throw new Error('Deposit sent, but the goal was not found on-chain yet. Pull to refresh.')
  return { signature, pledge }
}

/** Records day indexes on-chain with the device key. */
export async function sendCheckIns(
  connection: Connection,
  device: Keypair,
  programId: PublicKey,
  pledge: PublicKey,
  days: number[],
) {
  for (let i = 0; i < days.length; i += CHECK_INS_PER_TX) {
    const batch = days.slice(i, i + CHECK_INS_PER_TX)
    await sendAsDevice(
      connection,
      device,
      batch.map((d) => checkInIx(programId, device.publicKey, pledge, d)),
    )
  }
}

/** Makes this phone's key the one the pledge accepts check-ins from (one wallet approval). */
export async function linkDevice(
  connection: Connection,
  sign: SignWith,
  programId: PublicKey,
  owner: PublicKey,
  pledge: PublicKey,
) {
  const device = await getOrCreateDeviceKey(owner.toBase58())
  return sendAsOwner(connection, sign, owner, [
    ...(await topUpIx(connection, owner, device.publicKey)),
    setDeviceKeyIx(programId, owner, pledge, device.publicKey),
  ])
}

/** Pays the pledge out by its rules. The device key pays the fee if it can; otherwise the wallet does. */
export async function settlePledge(
  connection: Connection,
  sign: SignWith,
  device: Keypair | null,
  programId: PublicKey,
  pledge: ChainPledge,
) {
  const ix = settleIx(programId, LockInConfig.tokenProgram, pledge)
  if (device && (await connection.getBalance(device.publicKey, 'confirmed')) >= 100_000) {
    return sendAsDevice(connection, device, [ix])
  }
  return sendAsOwner(connection, sign, pledge.owner, [ix])
}

/** Safe mode: the owner takes the deposit back (one wallet approval; the device key can't do this). */
export async function refundPledge(connection: Connection, sign: SignWith, programId: PublicKey, pledge: ChainPledge) {
  return sendAsOwner(connection, sign, pledge.owner, [
    refundIx(programId, LockInConfig.tokenProgram, pledge.owner, pledge),
  ])
}
