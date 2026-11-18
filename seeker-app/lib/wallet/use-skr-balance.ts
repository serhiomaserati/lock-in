import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { LockInConfig } from '@/constants/lockin'
import { useWalletPublicKey } from './use-wallet-public-key'

/**
 * SKR (devnet: test token) in the connected wallet.
 * `null` while no token mint is configured - the app is in pure demo mode then.
 */
export function useSkrBalance() {
  const { connection } = useMobileWallet()
  const owner = useWalletPublicKey()
  const mint = LockInConfig.mint

  return useQuery({
    queryKey: ['skr-balance', { endpoint: connection.rpcEndpoint, owner: owner?.toBase58(), mint: mint?.toBase58() }],
    enabled: !!owner,
    queryFn: async (): Promise<number | null> => {
      if (!mint || !owner) return null
      try {
        const ata = getAssociatedTokenAddressSync(mint, owner)
        const { value } = await connection.getTokenAccountBalance(ata)
        return value.uiAmount ?? 0
      } catch (e) {
        // No token account yet = nothing to deposit. Anything else (RPC down) leaves the balance unknown.
        if (/could not find account/i.test(e instanceof Error ? e.message : String(e))) return 0
        throw e
      }
    },
  })
}
