import { create } from 'zustand'

/**
 * Whether the desktop sidebar is hidden so a screen can use the full window — the counter screen wants every pixel
 * it can get while a cashier is ringing someone up. Lives only in memory: leaving the screen always restores the
 * sidebar, there is nothing here worth remembering across a restart.
 */
export const useFocusMode = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: false,
  set: (on) => set({ on }),
}))
