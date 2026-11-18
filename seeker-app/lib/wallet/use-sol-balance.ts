import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { useWalletPublicKey } from './use-wallet-public-key'

/** SOL (lamports) in the connected wallet: it pays the network fees and the goal's storage. */
export function useSolBalance() {
  const { connection } = useMobileWallet()
  const owner = useWalletPublicKey()

  return useQuery({
    queryKey: ['sol-balance', { endpoint: connection.rpcEndpoint, owner: owner?.toBase58() }],
    enabled: !!owner,
    queryFn: () => connection.getBalance(owner!, 'confirmed'),
  })
}
