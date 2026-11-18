import { create } from 'zustand'

/** Which frame the app uses: the classic sidebar, or the command-centre rail with tabs and a docked record pane. Kept per computer. */
export type Layout = 'classic' | 'command'
const KEY = 'onesync.layout'
const read = (): Layout => { try { return localStorage.getItem(KEY) === 'command' ? 'command' : 'classic' } catch { return 'classic' } }
interface LayoutState { layout: Layout; set(layout: Layout): void }
export const useLayout = create<LayoutState>()((set) => ({
  layout: read(),
  set: (layout) => { try { localStorage.setItem(KEY, layout) } catch { /* not remembered */ } set({ layout }) },
}))
