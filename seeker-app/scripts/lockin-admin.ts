// Lock-In admin tool. Run from seeker-app:  npx tsx scripts/lockin-admin.ts <command>
//
//   setup                         devnet: test token (tSKR) + forfeit account + program config (once per cluster)
//                                 mainnet: SKR forfeit account of LOCKIN_TREASURY + program config with the limits below
//   status                        print the program config
//   limits <min> <max>            change the deposit range for new goals (whole tokens), e.g. limits 100 10000
//   fund <wallet> [tSKR] [SOL]    devnet only: mint test tokens to a wallet (and send it some SOL from the admin)
//   safe-mode on|off              emergency switch: no forfeits, owners can take deposits back
//   pause on|off                  stop / allow new goals
//   settle <pledge>               pay a pledge out by its rules (anyone may; this is how a missed goal is forfeited)
//   pledge <pledge>               print a pledge's on-chain state
//   pledges <owner>               list a wallet's pledges
//
// Env: LOCKIN_NETWORK=mainnet  mainnet instead of devnet (see scripts/network.ts); every sending command needs --yes
//      LOCKIN_RPC     endpoint override
//      LOCKIN_ADMIN   keypair JSON, default ../program/keys/deployer-<devnet|mainnet>.json = the upgrade authority
//      LOCKIN_TREASURY  mainnet setup: the wallet whose SKR account receives forfeits
//      LOCKIN_FAST=1  use the devnet fast TEST program (minute-long days) instead of the real one;
//                     it shares the test token and forfeit account with the real program
// Addresses are saved to scripts/<cluster>-config.json; on devnet put the mint into constants/lockin.ts.

import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkedDays,
  configAddress,
  explainChainError,
  fetchConfig,
  fetchPledge,
  fetchPledgesByOwner,
  settleIx,
} from '../lib/chain/lockin-program'
import {
  ADMIN_KEY_PATH,
  CLUSTER,
  DECIMALS,
  explorerTx,
  FAST_PROGRAM,
  loadKeypair,
  MAINNET,
  REAL_PROGRAM,
  requireYesOnMainnet,
  RPC,
  SKR_MINT,
} from './network'

if (process.env.LOCKIN_FAST === '1' && MAINNET) throw new Error('The fast TEST program exists on devnet only')
const PROGRAM_ID = process.env.LOCKIN_FAST === '1' ? FAST_PROGRAM : REAL_PROGRAM
const LOADER_V3 = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
const UNIT = 10n ** BigInt(DECIMALS)
// Deposit range set by setup. Mainnet (decided by the owner 2026-10-17): 100 to 10,000 SKR per goal.
const MIN_DEPOSIT = (MAINNET ? 100n : 1n) * UNIT
const MAX_DEPOSIT = (MAINNET ? 10_000n : 100_000n) * UNIT

const here = dirname(fileURLToPath(import.meta.url))
const cluster = CLUSTER
// A local validator running the mainnet setup (a rehearsal) keeps its own file, apart from the devnet-style localnet one.
const statePath = join(here, `${cluster}${cluster === 'localnet' && MAINNET ? '-mainnet' : ''}-config.json`)
const connection = new Connection(RPC, 'confirmed')
const admin = loadKeypair(ADMIN_KEY_PATH)

/** Forfeits go to this wallet's token account: on devnet a test treasury, on mainnet the owner's wallet. */
function treasuryOwner(): PublicKey {
  if (!MAINNET) return loadKeypair(join(here, 'treasury-devnet.json')).publicKey
  if (!process.env.LOCKIN_TREASURY) throw new Error('Set LOCKIN_TREASURY=<wallet address that receives forfeits>')
  return new PublicKey(process.env.LOCKIN_TREASURY)
}

interface State {
  mint: string
  forfeitTo: string
  treasuryOwner: string
}

function loadState(): State {
  if (!existsSync(statePath)) throw new Error(`Run "setup" first (${statePath} is missing)`)
  return JSON.parse(readFileSync(statePath, 'utf8'))
}

function adminIx(disc: number[], arg?: boolean) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: configAddress(PROGRAM_ID), isSigner: false, isWritable: true },
    ],
    data: Buffer.from([...disc, ...(arg === undefined ? [] : [arg ? 1 : 0])]),
  })
}

async function send(...ixs: TransactionInstruction[]) {
  return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [admin])
}

async function setup() {
  requireYesOnMainnet('setup')
  let state: State | null = existsSync(statePath) ? loadState() : null
  if (!state) {
    const owner = treasuryOwner()
    let mint: PublicKey
    if (MAINNET) {
      mint = SKR_MINT
    } else {
      console.log('• Creating the tSKR test mint…')
      mint = await createMint(connection, admin, admin.publicKey, null, DECIMALS)
    }
    console.log(`• Forfeit account: the ${MAINNET ? 'SKR' : 'tSKR'} account of ${owner.toBase58()}`)
    const forfeit = await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner)
    state = { mint: mint.toBase58(), forfeitTo: forfeit.address.toBase58(), treasuryOwner: owner.toBase58() }
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
  }
  if (await fetchConfig(connection, PROGRAM_ID)) {
    console.log('• Config already initialized')
  } else {
    console.log('• Initializing the program config…')
    const programData = PublicKey.findProgramAddressSync([PROGRAM_ID.toBytes()], LOADER_V3)[0]
    const data = Buffer.alloc(24)
    Buffer.from([23, 235, 115, 232, 168, 96, 1, 231]).copy(data, 0)
    data.writeBigUInt64LE(MIN_DEPOSIT, 8)
    data.writeBigUInt64LE(MAX_DEPOSIT, 16)
    await send(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: configAddress(PROGRAM_ID), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(state.mint), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(state.forfeitTo), isSigner: false, isWritable: false },
          { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: programData, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
    )
  }
  await status()
  if (!MAINNET) console.log(`\nPut this in constants/lockin.ts → mint: new PublicKey('${state.mint}')`)
}

/** update_config: new deposit range (whole tokens) for goals created from now on; mint and forfeit account stay. */
async function setLimits(minArg?: string, maxArg?: string) {
  if (!/^\d+$/.test(minArg ?? '') || !/^\d+$/.test(maxArg ?? '')) throw new Error('Usage: limits <min> <max> (whole tokens)')
  const min = BigInt(minArg!) * UNIT
  const max = BigInt(maxArg!) * UNIT
  if (min <= 0n || max < min) throw new Error('Expected 0 < min <= max')
  requireYesOnMainnet('limits')
  const c = await fetchConfig(connection, PROGRAM_ID)
  if (!c) throw new Error('Config not initialized')
  const data = Buffer.alloc(24)
  Buffer.from([29, 158, 252, 191, 10, 83, 219, 99]).copy(data, 0)
  data.writeBigUInt64LE(min, 8)
  data.writeBigUInt64LE(max, 16)
  const sig = await send(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: configAddress(PROGRAM_ID), isSigner: false, isWritable: true },
        { pubkey: c.mint, isSigner: false, isWritable: false },
        { pubkey: c.forfeitTo, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    }),
  )
  console.log(`• Limits changed: ${explorerTx(sig)}`)
  await status()
}

async function status() {
  const c = await fetchConfig(connection, PROGRAM_ID)
  if (!c) return console.log('Config not initialized')
  console.log({
    cluster,
    program: PROGRAM_ID.toBase58(),
    admin: c.admin.toBase58(),
    mint: c.mint.toBase58(),
    forfeitTo: c.forfeitTo.toBase58(),
    minDeposit: Number(c.minAmount) / 10 ** DECIMALS,
    maxDeposit: Number(c.maxAmount) / 10 ** DECIMALS,
    pausedNew: c.pausedNew,
    safeMode: c.safeMode,
    adminSol: (await connection.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL,
  })
}

async function fund(wallet: string, tskr = '1000', sol = '0') {
  if (MAINNET) throw new Error('fund is for the devnet test token only')
  const state = loadState()
  const owner = new PublicKey(wallet)
  const mint = new PublicKey(state.mint)
  const ata = await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner)
  await mintTo(connection, admin, mint, ata.address, admin, BigInt(Math.round(Number(tskr) * 10 ** DECIMALS)))
  console.log(`• Minted ${tskr} tSKR to ${wallet}`)
  const lamports = Math.round(Number(sol) * LAMPORTS_PER_SOL)
  if (lamports > 0) {
    await send(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: owner, lamports }))
    console.log(`• Sent ${sol} SOL`)
  }
}

async function showPledge(address: string) {
  const p = await fetchPledge(connection, new PublicKey(address))
  if (!p) return console.log('No such pledge (closed or wrong address)')
  const now = Math.floor(Date.now() / 1000)
  console.log({
    program: PROGRAM_ID.toBase58(),
    owner: p.owner.toBase58(),
    status: p.status,
    amount: Number(p.amount) / 10 ** DECIMALS,
    days: p.days,
    checked: checkedDays(p),
    deviceKey: p.deviceKey.toBase58(),
    closeAt: new Date(p.closeAt * 1000).toISOString(),
    closesIn: p.closeAt > now ? `${p.closeAt - now}s` : 'closed',
    tzName: p.tzName || '(none)',
  })
  // Day windows in UTC and in the goal's own time zone, so a boundary can be checked against local midnight.
  const local = (s: number) =>
    p.tzName ? new Date(s * 1000).toLocaleString('sv-SE', { timeZone: p.tzName, timeZoneName: 'short' }) : '-'
  p.bounds.slice(0, -1).forEach((start, i) => {
    const end = p.bounds[i + 1]
    const mark = checkedDays(p).includes(i) ? '✓' : ' '
    console.log(
      `day ${i} ${mark} ${new Date(start * 1000).toISOString()} → ${new Date(end * 1000).toISOString()}  (${local(start)} → ${local(end)})`,
    )
  })
}

async function settle(address: string) {
  requireYesOnMainnet('settle')
  const p = await fetchPledge(connection, new PublicKey(address))
  if (!p) throw new Error('No such pledge')
  try {
    const sig = await send(settleIx(PROGRAM_ID, TOKEN_PROGRAM_ID, p))
    console.log(`• Settled: ${sig}`)
  } catch (e) {
    console.log(`• Rejected: ${explainChainError(e)}`)
  }
  await showPledge(address)
}

const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--yes')
const on = (v?: string) => {
  if (v !== 'on' && v !== 'off') throw new Error('Expected on|off')
  return v === 'on'
}
const commands: Record<string, () => Promise<unknown>> = {
  setup,
  status,
  fund: () => fund(args[0], args[1], args[2]),
  limits: () => setLimits(args[0], args[1]),
  'safe-mode': () => {
    requireYesOnMainnet('safe-mode')
    return send(adminIx([174, 243, 122, 183, 2, 140, 100, 142], on(args[0]))).then(status)
  },
  pause: () => {
    requireYesOnMainnet('pause')
    return send(adminIx([211, 76, 235, 67, 28, 146, 143, 18], on(args[0]))).then(status)
  },
  settle: () => settle(args[0]),
  pledge: () => showPledge(args[0]),
  pledges: async () => {
    for (const p of await fetchPledgesByOwner(connection, PROGRAM_ID, new PublicKey(args[0]))) {
      const left = p.closeAt - Math.floor(Date.now() / 1000)
      console.log(
        `${p.address.toBase58()}  ${p.status.padEnd(9)} days=${p.days} checked=[${checkedDays(p)}] device=${p.deviceKey.toBase58().slice(0, 6)}… close ${left > 0 ? `in ${left}s` : 'passed'}`,
      )
    }
  },
}

if (!cmd || !commands[cmd]) {
  console.log(
    'Commands: setup | status | limits <min> <max> | fund <wallet> [tSKR] [SOL] | safe-mode on|off | pause on|off | settle <pledge> | pledge <pledge> | pledges <owner>',
  )
  process.exit(1)
}
commands[cmd]().catch((e) => {
  console.error(e)
  process.exit(1)
})
