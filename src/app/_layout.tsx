import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope'
import { bootApp } from '@/data/auth'
import { startSync, stopSync } from '@/data/runtime'
import { watchAppLock } from '@/data/lock'
import { useApp } from '@/data/store'
import { DesktopSidebar } from '@/features/DesktopSidebar'
import { useFocusMode } from '@/features/focusMode'
import { LockScreen } from '@/features/LockScreen'
import { useBreakpoint } from '@/ui/layout'
import { ThemeProvider, useTheme } from '@/ui/theme'
import { DialogHost, ToastHost } from '@/ui/overlays'
import '@/modules/all'

void SplashScreen.preventAutoHideAsync()

function Shell() {
  const { c } = useTheme()
  const ready = useApp((s) => s.ready)
  const mode = useApp((s) => s.workspace?.mode)
  const locked = useApp((s) => s.locked)
  // Signed into a business (not the welcome/onboarding/who-is-this screens) — the sidebar belongs to the whole
  // app from here, not just the five tabs, so it stays put in Bills, a module, Settings, anywhere.
  const signedIn = useApp((s) => !!s.workspace && !!s.session)
  const { isDesktop } = useBreakpoint()
  const focusMode = useFocusMode((s) => s.on)

  // Background sync runs only for a business connected to a server.
  useEffect(() => {
    if (!ready) return
    if (mode === 'remote') startSync(); else stopSync()
    return () => stopSync()
  }, [ready, mode])

  const stack = (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: c.bg }, gestureEnabled: true }}>
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="sell/checkout" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="sell/done" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
    </Stack>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.isDark ? 'light' : 'dark'} />
      {isDesktop && signedIn ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {focusMode ? null : <DesktopSidebar />}
          <View style={{ flex: 1 }}>{stack}</View>
        </View>
      ) : stack}
      <ToastHost />
      <DialogHost />
      {locked ? <LockScreen /> : null}
    </View>
  )
}

export default function Root() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold })
  const ready = useApp((s) => s.ready)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    bootApp().catch((e: unknown) => setBootError(e instanceof Error ? e.message : 'Could not open the app data'))
    watchAppLock()
  }, [])

  useEffect(() => {
    if ((fontsLoaded && ready) || bootError) void SplashScreen.hideAsync()
  }, [fontsLoaded, ready, bootError])

  if (!fontsLoaded || (!ready && !bootError)) return null
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
