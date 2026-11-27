import { useSyncExternalStore } from 'react'

/** A phone (or a very narrow window): the layout switches to the phone one below this width. */
const QUERY = '(max-width: 820px)'
const mq = (): MediaQueryList | null => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null)
const subscribe = (cb: () => void): (() => void) => { const m = mq(); m?.addEventListener('change', cb); return () => m?.removeEventListener('change', cb) }
export const usePhone = (): boolean => useSyncExternalStore(subscribe, () => mq()?.matches ?? false, () => false)
