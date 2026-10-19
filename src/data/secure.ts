import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/** Small secrets (the sign-in token) live in the system keychain / keystore, never in the app database. On web (design
 *  previews only) there is no keychain, so localStorage stands in. */
const web = Platform.OS === 'web'

export async function secureGet(key: string): Promise<string | null> {
  try {
    return web ? globalThis.localStorage?.getItem(`secure.${key}`) ?? null : await SecureStore.getItemAsync(key)
  } catch { return null }
}

export async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (web) globalThis.localStorage?.setItem(`secure.${key}`, value)
    else await SecureStore.setItemAsync(key, value)
  } catch { /* a failed save only means signing in again next launch */ }
}

export async function secureDelete(key: string): Promise<void> {
  try {
    if (web) globalThis.localStorage?.removeItem(`secure.${key}`)
    else await SecureStore.deleteItemAsync(key)
  } catch { /* nothing to delete */ }
}
