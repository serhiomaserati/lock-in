import { createContext, type PropsWithChildren, use, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { SignInOutput, useMobileWallet } from '@wallet-ui/react-native-web3js'
import { AppConfig } from '@/constants/app-config'
import { useMutation } from '@tanstack/react-query'

export interface AuthState {
  isAuthenticated: boolean
  signIn: () => Promise<SignInOutput>
  signOut: () => Promise<void>
}

const Context = createContext<AuthState>({} as AuthState)

export function useAuth() {
  const value = use(Context)
  if (!value) {
    throw new Error('useAuth must be wrapped in a <AuthProvider />')
  }

  return value
}

function useSignInMutation() {
  const { signIn } = useMobileWallet()

  return useMutation({
    mutationFn: async () =>
      await signIn({
        // Wallets without native Sign-In (Phantom) get a signed message instead, and the adapter
        // fills a missing domain from `window.location.host`, which doesn't exist in a release build.
        domain: AppConfig.domain,
        uri: AppConfig.uri,
        statement: 'Sign in to Lock-In',
      }),
  })
}

/**
 * `value`, but a change made while Lock-In is in the background (the wallet app in front) only
 * shows once we're back. Android Fabric pauses mounting in the background and replays the queue
 * on resume; swapping the whole navigator into that queue is the crash class in NEXT_STEPS.
 */
function useForegroundValue<T>(value: T): T {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    // Only a known background state waits; 'unknown' at startup must never block sign-in.
    if (AppState.currentState !== 'background') {
      setShown(value)
      return
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background') setShown(value)
    })
    return () => sub.remove()
  }, [value])
  return shown
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { accounts, disconnect } = useMobileWallet()
  const { mutateAsync } = useSignInMutation()
  // The adapter re-saves its accounts after every wallet round-trip. Depend on the boolean only,
  // so the root navigator re-renders on a real sign-in/out and not after each transaction.
  const isAuthenticated = useForegroundValue((accounts?.length ?? 0) > 0)

  const value: AuthState = useMemo(
    () => ({
      signIn: async () => await mutateAsync(),
      signOut: async () => await disconnect(),
      isAuthenticated,
    }),
    [isAuthenticated, disconnect, mutateAsync],
  )

  return <Context value={value}>{children}</Context>
}
