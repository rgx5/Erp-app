import type { CapacitorConfig } from '@capacitor/cli'

/** The phone app: the same client as the desktop app, built as a web page and shown in an Android shell. Online only: nothing is kept for offline use. */
const config: CapacitorConfig = {
  appId: 'com.onesync.erp.mobile',
  appName: 'OneSyncERP',
  webDir: 'out/web',
  server: { androidScheme: 'https', cleartext: true },
  android: { allowMixedContent: true },
  plugins: {
    // calls to the server go through the phone's own network layer, so the server needs no special cross-origin settings for the app
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchAutoHide: true, launchShowDuration: 800, backgroundColor: '#0c1747' },
  },
}
export default config
