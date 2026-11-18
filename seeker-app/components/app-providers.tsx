import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js'
import { PropsWithChildren } from 'react'
import { AppState } from 'react-native'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ClusterProvider, useCluster } from '@/components/cluster/cluster-provider'
import { AppTheme } from '@/components/app-theme'
import { AppConfig } from '@/constants/app-config'
import { PledgeProvider } from '@/lib/pledge/pledge-provider'

const queryClient = new QueryClient()

// React Native has no window focus: tell React Query when the app comes back to the foreground, so balances
// refresh after the user tops up in a wallet app or comes back from signing (instead of showing old numbers).
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (state) => setFocused(state === 'active'))
  return () => sub.remove()
})
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AppTheme>
      <QueryClientProvider client={queryClient}>
        <ClusterProvider>
          <SolanaProvider>
            <AuthProvider>
              <PledgeProvider>{children}</PledgeProvider>
            </AuthProvider>
          </SolanaProvider>
        </ClusterProvider>
      </QueryClientProvider>
    </AppTheme>
  )
}

// We have this SolanaProvider because of the network switching logic.
// If you only connect to a single network, use MobileWalletProvider directly.
function SolanaProvider({ children }: PropsWithChildren) {
  const { selectedCluster } = useCluster()
  return (
    <MobileWalletProvider
      chain={selectedCluster.id}
      endpoint={selectedCluster.endpoint}
      identity={{ name: AppConfig.name, uri: AppConfig.uri }}
    >
      {children}
    </MobileWalletProvider>
  )
}
