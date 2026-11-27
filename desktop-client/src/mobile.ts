import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

export const isNativeApp = (): boolean => { try { return Capacitor.isNativePlatform() } catch { return false } }

/** Set-up that only the Android app needs: a light status bar over the app's own top bar, and the phone's Back button walking back through the screens. */
export function startNativeApp(): void {
  if (!isNativeApp()) return
  document.documentElement.setAttribute('data-native', Capacitor.getPlatform())
  void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined)
  void App.addListener('backButton', ({ canGoBack }) => { if (canGoBack || window.history.length > 1) window.history.back(); else void App.exitApp() })
  void SplashScreen.hide().catch(() => undefined)
}
