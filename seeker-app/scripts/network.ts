// Which cluster the admin scripts talk to. Devnet unless LOCKIN_NETWORK=mainnet; LOCKIN_RPC overrides the endpoint
// (a localhost endpoint means a local test validator).
// On mainnet every command that sends a transaction needs --yes, so nothing is spent by accident.

import { Keypair, PublicKey } from '@solana/web3.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const MAINNET = process.env.LOCKIN_NETWORK === 'mainnet'
export const RPC = process.env.LOCKIN_RPC ?? (MAINNET ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com')
export const CLUSTER: 'mainnet' | 'devnet' | 'localnet' = /localhost|127\.0\.0\.1/.test(RPC)
  ? 'localnet'
  : MAINNET
    ? 'mainnet'
    : 'devnet'

/** The same program address on devnet and mainnet (program/keys/lockin-keypair.json). */
export const REAL_PROGRAM = new PublicKey('6za6iZpEP96dN76pGYj27JmqzMgkRQ3JT3SnvrsZbHbv')
/** Devnet only: the fast TEST build (minute-long days). */
export const FAST_PROGRAM = new PublicKey('8ScDBWhxUadKGvggckCQ3Hb8tVbykmsyKWm4Z6Pzi2nc')
export const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3')
export const DECIMALS = 6

const KEYS = join(here, '../../program/keys')
/** The program's upgrade authority and config admin. */
export const ADMIN_KEY_PATH =
  process.env.LOCKIN_ADMIN ?? join(KEYS, MAINNET ? 'deployer-mainnet.json' : 'deployer-devnet.json')
/** Fee payer for settlements, no admin rights. */
export const KEEPER_KEY_PATH = join(KEYS, MAINNET ? 'keeper-mainnet.json' : 'keeper-devnet.json')

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}${CLUSTER === 'mainnet' ? '' : CLUSTER === 'devnet' ? '?cluster=devnet' : '?cluster=custom'}`
}

/** Stops a mainnet command that would send a transaction unless --yes was given. */
export function requireYesOnMainnet(what: string) {
  if (CLUSTER === 'mainnet' && !process.argv.includes('--yes')) {
    console.error(`Mainnet: "${what}" sends a real transaction. Run it again with --yes to go ahead.`)
    process.exit(2)
  }
}
