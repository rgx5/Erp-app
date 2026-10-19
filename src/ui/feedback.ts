import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'
import { useApp } from '@/data/store'

/** Haptics that respect the person's setting and quietly do nothing where there is no motor (web, simulators). */
const on = () => Platform.OS !== 'web' && useApp.getState().prefs.haptics

export const tap = () => { if (on()) void Haptics.selectionAsync().catch(() => undefined) }
export const soft = () => { if (on()) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined) }
export const success = () => { if (on()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined) }
export const warn = () => { if (on()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined) }
export const fail = () => { if (on()) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined) }
