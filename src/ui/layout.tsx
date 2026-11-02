import { useWindowDimensions } from 'react-native'

/**
 * Below this width the app is a phone: one screen at a time, a bottom tab bar, edge-to-edge content.
 * At or above it (a tablet in landscape, or a desktop/browser window) there is room for a permanent side
 * navigation and a comfortably wide reading column instead of content stretched edge to edge.
 */
export const DESKTOP_BREAKPOINT = 840
/** Above this, the content column stops growing and sits centred, so a 1920px window does not read like a spreadsheet. */
export const CONTENT_MAX_WIDTH = 960

export function useBreakpoint() {
  const { width } = useWindowDimensions()
  return { width, isDesktop: width >= DESKTOP_BREAKPOINT }
}
