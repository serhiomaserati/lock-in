import { clusterApiUrl } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'
import { LockInConfig } from '@/constants/lockin'

// Local testing only: `EXPO_PUBLIC_LOCKIN_CLUSTER=localnet npx expo start` points the dev client at a
// solana-test-validator on the PC (`adb reverse tcp:8899 tcp:8899`). Builds without it use devnet,
// or mainnet with EXPO_PUBLIC_LOCKIN_NETWORK=mainnet (see constants/lockin.ts).
const LOCALNET: Cluster = {
  id: 'solana:localnet',
  name: 'Localnet',
  endpoint: 'http://localhost:8899',
  network: ClusterNetwork.Custom,
}

// The official public endpoint: rate-limited, but it serves getProgramAccounts (goal restore needs it; free
// alternatives like PublicNode refuse it). EXPO_PUBLIC_LOCKIN_RPC swaps in a provider endpoint at build time.
const MAINNET: Cluster = {
  id: 'solana:mainnet',
  name: 'Mainnet',
  endpoint: process.env.EXPO_PUBLIC_LOCKIN_RPC || clusterApiUrl('mainnet-beta'),
  network: ClusterNetwork.Mainnet,
}

// The website that vouches for this app: wallets show it as the requesting dApp, and they verify it only when that
// domain serves /.well-known/assetlinks.json for this package and signing key (website/.well-known/).
// EXPO_PUBLIC_LOCKIN_SITE (an https origin, no path) sets it at build time; the default is a placeholder we don't own.
// Parsed by hand: React Native's URL class doesn't implement `host`.
const SITE = (process.env.EXPO_PUBLIC_LOCKIN_SITE || 'https://lock-in.app').replace(/\/+$/, '')
const SITE_HOST = SITE.replace(/^https:\/\//, '')

export class AppConfig {
  static name = 'Lock-In'
  static uri = SITE
  static domain = SITE_HOST
  static clusters: Cluster[] =
    LockInConfig.cluster === 'localnet'
      ? [LOCALNET]
      : LockInConfig.cluster === 'mainnet'
        ? [MAINNET]
        : [
            {
              id: 'solana:devnet',
              name: 'Devnet',
              endpoint: clusterApiUrl('devnet'),
              network: ClusterNetwork.Devnet,
            },
            {
              id: 'solana:testnet',
              name: 'Testnet',
              endpoint: clusterApiUrl('testnet'),
              network: ClusterNetwork.Testnet,
            },
          ]
}
