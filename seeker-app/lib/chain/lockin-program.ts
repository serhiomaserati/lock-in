// Client for the Lock-In Solana program (program/ in the project root).
// Hand-written Borsh encoding instead of the Anchor TS client: a handful of instructions,
// no extra native-unfriendly dependencies. Discriminators and layouts come from
// program/idl/lockin.json - keep them in sync when the program changes.

import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { fromUint8Array } from 'js-base64'
import { LockInConfig } from '../../constants/lockin'

const DISC = {
  createPledge: [86, 26, 21, 66, 130, 186, 102, 36],
  checkIn: [209, 253, 4, 217, 250, 241, 207, 50],
  setDeviceKey: [151, 171, 217, 174, 60, 25, 94, 228],
  settle: [175, 42, 185, 87, 144, 131, 102, 212],
  refundInSafeMode: [235, 237, 72, 224, 56, 116, 101, 114],
  closePledge: [84, 63, 119, 56, 166, 189, 166, 246],
  pledgeAccount: [161, 197, 121, 46, 99, 75, 169, 131],
  configAccount: [155, 12, 170, 224, 30, 250, 204, 130],
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---------------------------------------------------------------- addresses

export function configAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode('config')], programId)[0]
}

export function pledgeAddress(programId: PublicKey, owner: PublicKey, id: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode('pledge'), owner.toBytes(), u64le(id)], programId)[0]
}

export function vaultAddress(programId: PublicKey, pledge: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode('vault'), pledge.toBytes()], programId)[0]
}

// ---------------------------------------------------------------- borsh

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, v, true)
  return b
}

class Writer {
  private parts: Uint8Array[] = []
  bytes(b: ArrayLike<number>) {
    this.parts.push(Uint8Array.from(b))
    return this
  }
  u8(v: number) {
    return this.bytes([v])
  }
  u32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, true)
    return this.bytes(b)
  }
  u64(v: bigint) {
    return this.bytes(u64le(v))
  }
  i64(v: bigint) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigInt64(0, v, true)
    return this.bytes(b)
  }
  pubkey(k: PublicKey) {
    return this.bytes(k.toBytes())
  }
  string(s: string) {
    const b = enc.encode(s)
    return this.u32(b.length).bytes(b)
  }
  done(): Buffer {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.length
    }
    return Buffer.from(out)
  }
}

class Reader {
  private view: DataView
  private o = 0
  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }
  skip(n: number) {
    this.o += n
    return this
  }
  u8() {
    return this.view.getUint8(this.o++)
  }
  bool() {
    return this.u8() !== 0
  }
  u32() {
    const v = this.view.getUint32(this.o, true)
    this.o += 4
    return v
  }
  u64() {
    const v = this.view.getBigUint64(this.o, true)
    this.o += 8
    return v
  }
  i64() {
    const v = this.view.getBigInt64(this.o, true)
    this.o += 8
    return v
  }
  pubkey() {
    const k = new PublicKey(this.data.subarray(this.o, this.o + 32))
    this.o += 32
    return k
  }
  string() {
    const len = this.u32()
    const s = dec.decode(this.data.subarray(this.o, this.o + len))
    this.o += len
    return s
  }
}

function hasDisc(data: Uint8Array, disc: number[]): boolean {
  return data.length >= 8 && disc.every((b, i) => data[i] === b)
}

// ---------------------------------------------------------------- accounts

export type ChainStatus = 'active' | 'returned' | 'forfeited' | 'refunded'
const STATUSES: ChainStatus[] = ['active', 'returned', 'forfeited', 'refunded']

export interface ChainPledge {
  address: PublicKey
  owner: PublicKey
  id: bigint
  mint: PublicKey
  amount: bigint
  forfeitTo: PublicKey
  deviceKey: PublicKey
  proof: 'manual' | 'steps'
  stepsPerDay: number
  days: number
  checked: bigint
  createdAt: number // unix seconds
  closeAt: number // unix seconds, before safe-mode extensions
  status: ChainStatus
  settledAt: number
  bounds: number[] // unix seconds
  tzName: string
}

export function decodePledge(address: PublicKey, data: Uint8Array): ChainPledge {
  if (!hasDisc(data, DISC.pledgeAccount)) throw new Error('Not a Lock-In pledge account')
  const r = new Reader(data).skip(8)
  const owner = r.pubkey()
  const id = r.u64()
  r.u8() // version
  const mint = r.pubkey()
  const amount = r.u64()
  const forfeitTo = r.pubkey()
  const deviceKey = r.pubkey()
  const proof = r.u8() === 1 ? 'steps' : 'manual'
  const stepsPerDay = r.u32()
  const days = r.u8()
  const checked = r.u64()
  const createdAt = Number(r.i64())
  const closeAt = Number(r.i64())
  const status = STATUSES[r.u8()] ?? 'active'
  const settledAt = Number(r.i64())
  r.u8() // bump
  r.u8() // vault bump
  const bounds = Array.from({ length: r.u32() }, () => Number(r.i64()))
  const tzName = r.string()
  return {
    address,
    owner,
    id,
    mint,
    amount,
    forfeitTo,
    deviceKey,
    proof,
    stepsPerDay,
    days,
    checked,
    createdAt,
    closeAt,
    status,
    settledAt,
    bounds,
    tzName,
  }
}

export interface ChainConfig {
  admin: PublicKey
  mint: PublicKey
  forfeitTo: PublicKey
  minAmount: bigint
  maxAmount: bigint
  pausedNew: boolean
  safeMode: boolean
}

export function decodeConfig(data: Uint8Array): ChainConfig {
  if (!hasDisc(data, DISC.configAccount)) throw new Error('Not a Lock-In config account')
  const r = new Reader(data).skip(8)
  const admin = r.pubkey()
  r.pubkey() // pending admin
  return {
    admin,
    mint: r.pubkey(),
    forfeitTo: r.pubkey(),
    minAmount: r.u64(),
    maxAmount: r.u64(),
    pausedNew: r.bool(),
    safeMode: r.bool(),
  }
}

/** Day indexes (0-based) whose check-in is recorded on-chain. */
export function checkedDays(p: Pick<ChainPledge, 'checked' | 'days'>): number[] {
  const out: number[] = []
  for (let i = 0; i <= p.days; i++) if ((p.checked >> BigInt(i)) & 1n) out.push(i)
  return out
}

export async function fetchConfig(connection: Connection, programId: PublicKey): Promise<ChainConfig | null> {
  const info = await connection.getAccountInfo(configAddress(programId))
  return info ? decodeConfig(Uint8Array.from(info.data)) : null
}

export async function fetchPledge(connection: Connection, address: PublicKey): Promise<ChainPledge | null> {
  const info = await connection.getAccountInfo(address)
  return info ? decodePledge(address, Uint8Array.from(info.data)) : null
}

/** Every pledge of the program (for the keeper that settles goals after their window closes). */
export async function fetchAllPledges(connection: Connection, programId: PublicKey): Promise<ChainPledge[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: fromUint8Array(Uint8Array.from(DISC.pledgeAccount)), encoding: 'base64' } },
    ],
  })
  return accounts.map(({ pubkey, account }) => decodePledge(pubkey, Uint8Array.from(account.data)))
}

/** Every pledge of `owner` still on-chain (settled ones stay until the owner closes them). */
export async function fetchPledgesByOwner(
  connection: Connection,
  programId: PublicKey,
  owner: PublicKey,
): Promise<ChainPledge[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: fromUint8Array(Uint8Array.from(DISC.pledgeAccount)), encoding: 'base64' } },
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ],
  })
  return accounts.map(({ pubkey, account }) => decodePledge(pubkey, Uint8Array.from(account.data)))
}

// ---------------------------------------------------------------- instructions

export interface CreatePledgeParams {
  programId: PublicKey
  tokenProgram: PublicKey
  owner: PublicKey
  mint: PublicKey
  id: bigint
  amount: bigint
  days: number
  proof: 'manual' | 'steps'
  stepsPerDay: number
  bounds: number[] // unix seconds, days + 2 values
  tzName: string
  deviceKey: PublicKey
}

export function createPledgeIx(p: CreatePledgeParams): TransactionInstruction {
  const pledge = pledgeAddress(p.programId, p.owner, p.id)
  const w = new Writer()
    .bytes(DISC.createPledge)
    .u64(p.id)
    .u64(p.amount)
    .u8(p.days)
    .u8(p.proof === 'steps' ? 1 : 0)
    .u32(p.proof === 'steps' ? p.stepsPerDay : 0)
    .u32(p.bounds.length)
  p.bounds.forEach((b) => w.i64(BigInt(b)))
  w.string(p.tzName).pubkey(p.deviceKey)
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      { pubkey: p.owner, isSigner: true, isWritable: true },
      { pubkey: configAddress(p.programId), isSigner: false, isWritable: false },
      { pubkey: pledge, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: vaultAddress(p.programId, pledge), isSigner: false, isWritable: true },
      {
        pubkey: getAssociatedTokenAddressSync(p.mint, p.owner, false, p.tokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: p.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: w.done(),
  })
}

export function checkInIx(programId: PublicKey, signer: PublicKey, pledge: PublicKey, day: number) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: pledge, isSigner: false, isWritable: true },
    ],
    data: new Writer().bytes(DISC.checkIn).u8(day).done(),
  })
}

export function setDeviceKeyIx(programId: PublicKey, owner: PublicKey, pledge: PublicKey, deviceKey: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: pledge, isSigner: false, isWritable: true },
    ],
    data: new Writer().bytes(DISC.setDeviceKey).pubkey(deviceKey).done(),
  })
}

/** Pays the pledge out by its rules (anyone can send it). Both payout accounts are passed. */
export function settleIx(programId: PublicKey, tokenProgram: PublicKey, p: ChainPledge) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: p.address, isSigner: false, isWritable: true },
      { pubkey: p.owner, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: vaultAddress(programId, p.address), isSigner: false, isWritable: true },
      {
        pubkey: getAssociatedTokenAddressSync(p.mint, p.owner, false, tokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: p.forfeitTo, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: new Writer().bytes(DISC.settle).done(),
  })
}

/** Safe mode only: the owner takes the deposit back from an unsettled pledge. */
export function refundIx(programId: PublicKey, tokenProgram: PublicKey, authority: PublicKey, p: ChainPledge) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: configAddress(programId), isSigner: false, isWritable: false },
      { pubkey: p.address, isSigner: false, isWritable: true },
      { pubkey: p.owner, isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: vaultAddress(programId, p.address), isSigner: false, isWritable: true },
      {
        pubkey: getAssociatedTokenAddressSync(p.mint, p.owner, false, tokenProgram),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: new Writer().bytes(DISC.refundInSafeMode).done(),
  })
}

export function closePledgeIx(programId: PublicKey, owner: PublicKey, pledge: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: pledge, isSigner: false, isWritable: true },
    ],
    data: new Writer().bytes(DISC.closePledge).done(),
  })
}

// ---------------------------------------------------------------- errors

/** Messages for the program's error codes (6000 + index in program/src/error.rs). */
const PROGRAM_ERRORS = [
  'Only the admin can do this',
  'Only the pending admin can accept',
  'New goals are paused for now. Please try again later.',
  'Lock-In is in safe mode: new goals and forfeits are paused.',
  'Only allowed in safe mode',
  'Too many safe-mode periods recorded',
  'The deposit amount is outside the allowed range.',
  'Invalid amount limits',
  'Goal length must be 1 to 60 days.',
  'The goal calendar is invalid. Please try again.',
  'The goal must start within the next 48 hours. Check the phone clock and try again.',
  'A day of this goal has an invalid length. Please try again.',
  'Timezone name too long',
  'Step goals need a daily target.',
  'Invalid device key',
  'This goal is already settled.',
  'This goal is still active.',
  'This phone is not linked to the goal.',
  'That day is outside the goal.',
  'That day has not started yet.',
  'Check-ins for this goal are closed.',
  'Too early: the goal can still be completed.',
  'Missing the account the payout goes to.',
  'Not allowed to refund this goal.',
  'Arithmetic overflow',
]

/** A readable message for a failed Lock-In transaction (wallet, RPC or program error). */
/**
 * Wallet (Mobile Wallet Adapter) failures. Without this they read like network trouble: the native
 * module reports a wallet that never answered as "Timed out waiting for response".
 */
function explainWalletError(e: unknown, raw: string): string | null {
  const code = String((e as { code?: unknown } | null)?.code ?? '')
  const text = `${code} ${raw}`
  if (code === 'ERROR_WALLET_NOT_FOUND') return 'No Solana wallet app was found on this phone.'
  if (code === '-3' || code === 'ERROR_ASSOCIATION_CANCELLED') return 'Cancelled in your wallet.'
  // MWA ERROR_AUTHORIZATION_FAILED: the wallet declined (or the user cancelled) the connection.
  if (code === '-1' || /authorization request failed/i.test(text))
    return 'The wallet didn’t approve the connection. Try again and approve it in your wallet.'
  if (/timed out waiting for (response|local association)/i.test(text))
    return "Your wallet didn't respond in time. Please try again."
  if (/ConnectionFailedException|websocket server|ERROR_SESSION_CLOSED/i.test(text))
    return "Couldn't reach your wallet app. Open it once, then try again."
  return null
}

export function explainChainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const wallet = explainWalletError(e, raw)
  if (wallet) return wallet
  const hex = /custom program error: (0x[0-9a-f]+)/i.exec(raw)
  const dec = /"Custom":\s*(\d+)/.exec(raw)
  const code = hex ? parseInt(hex[1], 16) : dec ? Number(dec[1]) : null
  if (code !== null && code >= 6000 && code - 6000 < PROGRAM_ERRORS.length) return PROGRAM_ERRORS[code - 6000]
  // Anchor AccountNotInitialized. On the wallet's own token account: it never held SKR (or was closed).
  if (code === 3012 && /caused by account: owner_token/.test(raw))
    return `This wallet has no ${LockInConfig.tokenSymbol} yet. Add ${LockInConfig.tokenSymbol} to it first.`
  // On the deposit account: it's gone, i.e. the goal was already paid out.
  if (code === 3012) return 'This goal is already settled.'
  // The fee payer has no SOL at all (AccountNotFound), too little for the fee, or too little to stay rent-exempt.
  if (/AccountNotFound|InsufficientFundsFor(Fee|Rent)/.test(raw))
    return 'Not enough SOL in your wallet for the network fees.'
  // SPL Token's InsufficientFunds (0x1) on the deposit transfer; the System program's 0x1 is SOL ("insufficient lamports").
  if (code === 1 && /TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1\b/.test(raw))
    return `Not enough ${LockInConfig.tokenSymbol} in your wallet.`
  if (/insufficient lamports/i.test(raw)) return 'Not enough SOL in your wallet for the network fees.'
  if (code === 1 || /insufficient (funds|lamports)/i.test(raw))
    return `Not enough SOL or ${LockInConfig.tokenSymbol} in your wallet.`
  if (/declined|rejected|cancel/i.test(raw)) return 'Cancelled in your wallet.'
  if (/blockhash not found|block height exceeded|has expired/i.test(raw))
    return 'The transaction expired while waiting for your wallet. Please try again.'
  if (/network request failed|failed to fetch|unable to resolve host/i.test(raw))
    return "Can't reach Solana. Check your connection and try again."
  if (/blockhash|timed? ?out/i.test(raw)) return 'The network is slow right now. Please try again.'
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
}
