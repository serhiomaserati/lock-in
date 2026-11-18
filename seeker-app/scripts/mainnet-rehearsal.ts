// Dress rehearsal of the mainnet setup on a local validator: the deployed binary at the real program address, the real
// SKR mint cloned from mainnet, and a wallet preloaded with SKR (nobody can mint SKR, so the token account is injected).
// Nothing here touches mainnet. Run from seeker-app:
//
//   npx tsx scripts/mainnet-rehearsal.ts prep <dir>   keys + the injected SKR account; prints the validator command
//   (start solana-test-validator with that command in WSL, then:)
//   LOCKIN_NETWORK=mainnet LOCKIN_RPC=http://127.0.0.1:8899 LOCKIN_TREASURY=<printed> npx tsx scripts/lockin-admin.ts setup
//   npx tsx scripts/mainnet-rehearsal.ts run <dir>    deposit limits enforced on-chain with real SKR (99/100/10,000/10,001)

import { ACCOUNT_SIZE, AccountLayout, getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPledgeIx, explainChainError, fetchConfig, pledgeAddress, vaultAddress } from '../lib/chain/lockin-program'
import { DECIMALS, REAL_PROGRAM, SKR_MINT } from './network'

const RPC = 'http://127.0.0.1:8899'
const UNIT = 10n ** BigInt(DECIMALS)
const PRELOADED = 20_000n * UNIT
const [cmd, dir] = process.argv.slice(2)
if (!dir || (cmd !== 'prep' && cmd !== 'run')) {
  console.log('Usage: mainnet-rehearsal.ts prep|run <dir>')
  process.exit(1)
}
const keyFile = (name: string) => join(dir, `${name}.json`)
const loadKey = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile(name), 'utf8'))))

function prep() {
  mkdirSync(dir, { recursive: true })
  for (const name of ['owner', 'device', 'treasury']) {
    writeFileSync(keyFile(name), JSON.stringify(Array.from(Keypair.generate().secretKey)))
  }
  const owner = loadKey('owner').publicKey
  const ata = getAssociatedTokenAddressSync(SKR_MINT, owner)
  const data = Buffer.alloc(ACCOUNT_SIZE)
  AccountLayout.encode(
    {
      mint: SKR_MINT,
      owner,
      amount: PRELOADED,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1, // initialized
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  )
  const account = {
    pubkey: ata.toBase58(),
    account: {
      lamports: 2_039_280,
      data: [data.toString('base64'), 'base64'],
      owner: TOKEN_PROGRAM_ID.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: ACCOUNT_SIZE,
    },
  }
  writeFileSync(join(dir, 'owner-skr.json'), JSON.stringify(account, null, 2))
  console.log(`owner ${owner.toBase58()} (20,000 SKR preloaded at ${ata.toBase58()})`)
  console.log(`treasury ${loadKey('treasury').publicKey.toBase58()}`)
}

async function run() {
  const connection = new Connection(RPC, 'confirmed')
  const owner = loadKey('owner')
  const device = loadKey('device').publicKey
  await connection.confirmTransaction(await connection.requestAirdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL))

  const config = await fetchConfig(connection, REAL_PROGRAM)
  if (!config) throw new Error('Run lockin-admin.ts setup (mainnet, local RPC) first')
  console.log(`config: mint ${config.mint.toBase58()}, range ${config.minAmount / UNIT}-${config.maxAmount / UNIT} SKR`)
  if (!config.mint.equals(SKR_MINT)) throw new Error('config mint is not SKR')

  const now = (await connection.getBlockTime(await connection.getSlot())) ?? Math.floor(Date.now() / 1000)
  const start = now + 3600
  const bounds = [start, start + 86_400, start + 2 * 86_400]
  let id = BigInt(Date.now())
  const results: string[] = []
  for (const skr of [99n, 100n, 10_000n, 10_001n]) {
    id += 1n
    const ix = createPledgeIx({
      programId: REAL_PROGRAM,
      tokenProgram: TOKEN_PROGRAM_ID,
      owner: owner.publicKey,
      mint: SKR_MINT,
      id,
      amount: skr * UNIT,
      days: 1,
      proof: 'manual',
      stepsPerDay: 0,
      bounds,
      tzName: 'Europe/Kyiv',
      deviceKey: device,
    })
    try {
      await sendAndConfirmTransaction(connection, new Transaction().add(ix), [owner])
      const vault = await getAccount(connection, vaultAddress(REAL_PROGRAM, pledgeAddress(REAL_PROGRAM, owner.publicKey, id)))
      results.push(`${skr} SKR: accepted, vault holds ${vault.amount / UNIT} SKR`)
    } catch (e) {
      results.push(`${skr} SKR: rejected (${explainChainError(e).split('\n')[0]})`)
    }
  }
  const left = await getAccount(connection, getAssociatedTokenAddressSync(SKR_MINT, owner.publicKey))
  results.forEach((r) => console.log(`  ${r}`))
  console.log(`owner SKR left: ${left.amount / UNIT} (expected ${PRELOADED / UNIT - 10_100n})`)
}

;(cmd === 'prep' ? Promise.resolve(prep()) : run()).catch((e) => {
  console.error(e)
  process.exit(1)
})
