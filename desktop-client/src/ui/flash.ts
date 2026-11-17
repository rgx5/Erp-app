import { create } from 'zustand'

/** A short message shown at the top of the next screen (for example "Invoice INV/2627/00001 posted"). */
interface Flash { message: string | null; tone: 'info' | 'error'; show(message: string, tone?: 'info' | 'error'): void; clear(): void }
export const useFlash = create<Flash>()((set) => ({ message: null, tone: 'info', show: (message, tone = 'info') => set({ message, tone }), clear: () => set({ message: null }) }))
