import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The phone app: the same client as the desktop app, built as a web page and shown in an Android shell. Online only: nothing is kept for offline use.
 *
 * Store builds talk to servers over https only. A private build for a business that runs its server on a plain-http office network can be made
 * with CAP_CLEARTEXT=1 (the "Mobile app (Android)" workflow sets it); such a build is never uploaded to a store.
 */
const cleartext = process.env['CAP_CLEARTEXT'] === '1'
const config: CapacitorConfig = {
  appId: 'com.onesync.erp.mobile',
  appName: 'OneSyncERP',
  webDir: 'out/web',
  server: { androidScheme: 'https', cleartext },
  android: { allowMixedContent: cleartext, webContentsDebuggingEnabled: false, backgroundColor: '#ffffff' },
  plugins: {
    // calls to the server go through the phone's own network layer, so the server needs no special cross-origin settings for the app
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchAutoHide: true, launchShowDuration: 800, backgroundColor: '#0c1747' },
  },
}
export default config
