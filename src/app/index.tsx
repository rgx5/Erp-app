import { Redirect } from 'expo-router'
import { useApp } from '@/data/store'

/** The front door: no business yet → welcome; a business but nobody signed in → who's there; otherwise the app. */
export default function Index() {
  const ws = useApp((s) => s.workspace)
  const session = useApp((s) => s.session)
  if (!ws) return <Redirect href="/welcome" />
  if (!session) return <Redirect href="/who" />
  return <Redirect href="/(tabs)" />
}
