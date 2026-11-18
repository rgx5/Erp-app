import { createContext, useContext } from 'react'

/** The docked pane beside the page. A record opened from a list appears here, so the list stays on screen. Null outside the shell. */
export const PaneContext = createContext<HTMLElement | null>(null)
export const usePane = (): HTMLElement | null => useContext(PaneContext)
