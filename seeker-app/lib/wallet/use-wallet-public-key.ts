import { PublicKey } from '@solana/web3.js'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { useMemo } from 'react'

/**
 * The connected account as a real web3.js PublicKey.
 *
 * `account.address` is typed as PublicKey but at runtime the wallet adapter hands back a
 * plain address, so passing it to web3.js (getBalance, getParsedTokenAccountsByOwner,
 * token instructions) throws "toBase58 is not a function". Always go through this hook.
 */
export function useWalletPublicKey(): PublicKey | null {
  const { account } = useMobileWallet()
  const address = account?.address?.toString()
  return useMemo(() => (address ? new PublicKey(address) : null), [address])
}
