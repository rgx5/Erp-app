import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '@/api/errors'
import { useSession } from '@/auth/session'
import { startReconnectWatch } from '@/auth/reconnect'
import { startChangeStream } from './api/changes'
import { applyFreshness } from './api/freshness'
import { startOfflineCache } from './offline/queryPersist'
import { isNativeApp, startNativeApp } from './mobile'
import { router } from './router'
import '@fontsource-variable/inter'
import './styles.css'

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => { if (e instanceof ApiError && e.isUnauthorized) void useSession.getState().logout() } }),
  defaultOptions: { queries: { staleTime: 15_000, networkMode: 'always', retry: (count, e) => !(e instanceof ApiError) && count < 2, refetchOnWindowFocus: true } },
})

// Inside the desktop shell the screens leave room for the window buttons; the platform decides where.
if (window.onesync) document.documentElement.dataset['shell'] = window.onesync.platform

// The session is resolved before the first screen, so the app never flashes the sign-in page at someone who is already in.
void useSession.getState().restore().then(() => {
  applyFreshness(queryClient)
  // the phone app is online only: nothing is saved for use without a connection
  if (!isNativeApp()) startOfflineCache(queryClient)
  startNativeApp()
  startChangeStream(queryClient)
  startReconnectWatch(queryClient)
  // Signing out (or losing the session) sends everyone back to the right entrance.
  useSession.subscribe((s, prev) => { if (prev.status === 'authenticated' && s.status !== 'authenticated') { queryClient.clear(); void router.navigate({ to: s.server ? '/login' : '/connect' }) } })
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
})
