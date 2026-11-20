import type { Rectangle } from 'electron'

export interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean; zoom: number }
export const DEFAULT_STATE: WindowState = { width: 1360, height: 860, maximized: false, zoom: 0 }

const within = (r: Rectangle, d: Rectangle): boolean => r.x + 80 <= d.x + d.width && r.x + r.width - 80 >= d.x && r.y >= d.y - 10 && r.y + 60 <= d.y + d.height

/**
 * Where the window should open: where it was last time, unless that place is no longer on any screen (a monitor was unplugged), in
 * which case it opens centred at the remembered size. A size larger than the screen is cut down to fit.
 */
export function fitState(saved: Partial<WindowState>, screens: Rectangle[]): WindowState {
  const base: WindowState = { ...DEFAULT_STATE, ...saved }
  const primary = screens[0] ?? { x: 0, y: 0, width: 1920, height: 1080 }
  base.width = Math.max(1000, Math.min(base.width, primary.width))
  base.height = Math.max(640, Math.min(base.height, primary.height))
  base.zoom = Number.isFinite(base.zoom) ? Math.max(-3, Math.min(base.zoom, 5)) : 0
  if (typeof base.x === 'number' && typeof base.y === 'number') {
    const place = { x: base.x, y: base.y, width: base.width, height: base.height }
    if (!screens.some((d) => within(place, d))) { delete base.x; delete base.y }
  } else { delete base.x; delete base.y }
  return base
}
