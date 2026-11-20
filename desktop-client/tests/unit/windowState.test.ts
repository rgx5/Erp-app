import { describe, expect, it } from 'vitest'
import { fitState } from '../../electron/main/windowState'

const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 1024 }]

describe('window state', () => {
  it('opens at the default size when nothing is saved', () => {
    expect(fitState({}, screens)).toMatchObject({ width: 1360, height: 860, maximized: false })
    expect(fitState({}, screens).x).toBeUndefined()
  })
  it('keeps a saved place that is still on a screen, including a second monitor', () => {
    expect(fitState({ x: 100, y: 80, width: 1200, height: 800 }, screens)).toMatchObject({ x: 100, y: 80 })
    expect(fitState({ x: 2000, y: 40, width: 1100, height: 700 }, screens)).toMatchObject({ x: 2000, y: 40 })
  })
  it('centres the window when its monitor has been unplugged', () => {
    const s = fitState({ x: 2000, y: 40, width: 1100, height: 700 }, [screens[0] as (typeof screens)[number]])
    expect(s.x).toBeUndefined(); expect(s.width).toBe(1100)
  })
  it('cuts an oversized window down, never below the minimum, and keeps maximised and zoom', () => {
    expect(fitState({ width: 5000, height: 4000 }, screens)).toMatchObject({ width: 1920, height: 1040 })
    expect(fitState({ width: 300, height: 200 }, screens)).toMatchObject({ width: 1000, height: 640 })
    expect(fitState({ maximized: true, zoom: 1.5 }, screens)).toMatchObject({ maximized: true, zoom: 1.5 })
    expect(fitState({ zoom: 99 }, screens).zoom).toBe(5)
  })
})
