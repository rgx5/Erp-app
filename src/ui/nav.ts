import type { useRouter } from 'expo-router'

/** Back, or home when there is nothing to go back to (a deep link, a restored session). */
export function goBack(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}
