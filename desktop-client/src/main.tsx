import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '@/api/errors'
import { useSession } from '@/auth/session'
import { router } from './router'
import './styles.css'

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => { if (e instanceof ApiError && e.isUnauthorized) void useSession.getState().logout() } }),
  defaultOptions: { queries: { staleTime: 15_000, retry: (count, e) => !(e instanceof ApiError) && count < 2, refetchOnWindowFocus: true } },
})

// The session is resolved before the first screen, so the app never flashes the sign-in page at someone who is already in.
void useSession.getState().restore().then(() => {
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
