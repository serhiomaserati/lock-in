import { Linking } from 'react-native'
import { AppConfig } from '@/constants/app-config'

/** Opens a page of the Lock-In website (website/) in the browser, e.g. 'terms.html'; '' is the home page. */
export function openSitePage(page: string) {
  Linking.openURL(`${AppConfig.uri}/${page}`).catch(() => {})
}
