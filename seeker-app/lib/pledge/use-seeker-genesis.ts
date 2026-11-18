import { getMetadataPointerState, getTokenGroupMemberState, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { SeekerGenesis } from '@/constants/lockin'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'

/**
 * Returns whether the connected wallet holds a Seeker Genesis Token (SGT).
 *
 * Per the official spec, a mint is a genuine SGT only when ALL three Token-2022
 * extension checks pass simultaneously:
 *   1. mint authority === SGT mint authority
 *   2. metadata pointer === SGT group address
 *   3. token group member group === SGT group address
 */
export function useSeekerGenesis() {
  const { connection } = useMobileWallet()
  const owner = useWalletPublicKey()

  return useQuery({
    queryKey: ['seeker-genesis', { endpoint: connection.rpcEndpoint, address: owner?.toBase58() }],
    enabled: !!owner,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      const { value: tokenAccounts } = await connection.getParsedTokenAccountsByOwner(owner!, {
        programId: TOKEN_2022_PROGRAM_ID,
      })

      const heldMints = tokenAccounts
        .filter((a) => Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0) > 0)
        .map((a) => new PublicKey(a.account.data.parsed.info.mint))

      if (heldMints.length === 0) return false

      // Fetch mint accounts in batches of 100 and validate the extensions.
      for (let i = 0; i < heldMints.length; i += 100) {
        const batch = heldMints.slice(i, i + 100)
        const infos = await connection.getMultipleAccountsInfo(batch)
        for (let j = 0; j < batch.length; j++) {
          const info = infos[j]
          if (!info) continue
          try {
            const mint = unpackMint(batch[j], info, TOKEN_2022_PROGRAM_ID)
            const authorityOk = mint.mintAuthority?.equals(SeekerGenesis.mintAuthority) ?? false
            const metadataOk = getMetadataPointerState(mint)?.metadataAddress?.equals(SeekerGenesis.group) ?? false
            const groupOk = getTokenGroupMemberState(mint)?.group?.equals(SeekerGenesis.group) ?? false
            if (authorityOk && metadataOk && groupOk) return true
          } catch {
            // Not a well-formed Token-2022 mint with these extensions - skip.
          }
        }
      }
      return false
    },
  })
}
