import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { AppText } from '@/components/app-text'
import { ellipsify } from '@/utils/ellipsify'
import { AppView } from '@/components/app-view'
import { AppPage } from '@/components/app-page'
import { AccountUiButtons } from './account-ui-buttons'
import { AccountUiBalance } from '@/components/account/account-ui-balance'
import { AccountUiTokenAccounts } from '@/components/account/account-ui-token-accounts'
import { RefreshControl, ScrollView } from 'react-native'
import { useCallback, useState } from 'react'
import { useGetBalanceInvalidate } from '@/components/account/use-get-balance'
import { useWalletPublicKey } from '@/lib/wallet/use-wallet-public-key'
import { useGetTokenAccountsInvalidate } from '@/components/account/use-get-token-accounts'
import { WalletUiButtonConnect } from '@/components/solana/wallet-ui-button-connect'

export function AccountFeature() {
  const { account } = useMobileWallet()
  const owner = useWalletPublicKey()
  const [refreshing, setRefreshing] = useState(false)
  const invalidateBalance = useGetBalanceInvalidate({ address: owner! })
  const invalidateTokenAccounts = useGetTokenAccountsInvalidate({ address: owner! })
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([invalidateBalance(), invalidateTokenAccounts()])
    setRefreshing(false)
  }, [invalidateBalance, invalidateTokenAccounts])

  return (
    <AppPage>
      {account && owner ? (
        <ScrollView
          contentContainerStyle={{}}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => onRefresh()} />}
        >
          <AppView style={{ alignItems: 'center', gap: 4 }}>
            <AccountUiBalance address={owner} />
            <AppText style={{ opacity: 0.7 }}>{ellipsify(account.address.toString(), 8)}</AppText>
          </AppView>
          <AppView style={{ marginTop: 16, alignItems: 'center' }}>
            <AccountUiButtons />
          </AppView>
          <AppView style={{ marginTop: 16, alignItems: 'center' }}>
            <AccountUiTokenAccounts address={owner} />
          </AppView>
        </ScrollView>
      ) : (
        <AppView style={{ flexDirection: 'column', justifyContent: 'flex-end' }}>
          <AppText>Connect your wallet.</AppText>
          <WalletUiButtonConnect />
        </AppView>
      )}
    </AppPage>
  )
}
