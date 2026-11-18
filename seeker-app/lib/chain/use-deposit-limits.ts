import { PublicKey } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { isLockEnabled, LockInConfig } from '@/constants/lockin'
import { fetchConfig } from './lockin-program'

export interface DepositLimits {
  min: number
  max: number
  /** The admin stopped new goals (pause switch). */
  pausedNew: boolean
}

/**
 * The deposit range a new goal on `program` accepts, read from the program config (the admin can change it, so it's
 * not a constant here). `null` when the config can't be read: the program still enforces the limits.
 */
export function useDepositLimits(program: PublicKey) {
  const { connection } = useMobileWallet()
  return useQuery({
    queryKey: ['deposit-limits', { endpoint: connection.rpcEndpoint, program: program.toBase58() }],
    enabled: isLockEnabled(),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<DepositLimits | null> => {
      const c = await fetchConfig(connection, program).catch(() => null)
      if (!c) return null
      const unit = 10 ** LockInConfig.decimals
      return { min: Number(c.minAmount) / unit, max: Number(c.maxAmount) / unit, pausedNew: c.pausedNew }
    },
  })
}
