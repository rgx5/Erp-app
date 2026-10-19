import React from 'react'
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { T } from './Text'
import { IconButton } from './Button'
import { ChevronLeft } from './icons'
import { useTheme } from './theme'

export interface ScreenProps {
  title?: string
  subtitle?: string
  /** A large left-aligned title (tab roots). Detail screens use a compact centred one with a back button. */
  large?: boolean
  back?: boolean | (() => void)
  right?: React.ReactNode
  /** Replaces the whole header (the Home screen draws its own). */
  header?: React.ReactNode
  children?: React.ReactNode
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  /** Pinned under the content: the primary action of the screen. */
  footer?: React.ReactNode
  padded?: boolean
  contentStyle?: StyleProp<ViewStyle>
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled'
}

/** Every screen's frame: safe areas, header, scrolling content with pull-to-refresh, and an optional pinned footer. */
export function Screen({ title, subtitle, large, back, right, header, children, scroll = true, refreshing, onRefresh, footer, padded = true, contentStyle, keyboardShouldPersistTaps = 'handled' }: ScreenProps) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const goBack = typeof back === 'function' ? back : () => (router.canGoBack() ? router.back() : router.replace('/'))

  const head = header ?? (title !== undefined || back || right ? (
    large ? (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <T v="h1" numberOfLines={1}>{title}</T>
          {subtitle ? <T v="caption" tone="mute" numberOfLines={1}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10, minHeight: 56 }}>
        {back ? <IconButton label="Back" onPress={goBack}><ChevronLeft size={22} color={c.ink} /></IconButton> : null}
        <View style={{ flex: 1, paddingLeft: back ? 2 : 4 }}>
          <T v="h2" numberOfLines={1}>{title}</T>
          {subtitle ? <T v="caption" tone="mute" numberOfLines={1}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
    )
  ) : null)

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingHorizontal: padded ? 20 : 0, paddingTop: 6, paddingBottom: footer ? 20 : 28 }, contentStyle]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: padded ? 20 : 0 }, contentStyle]}>{children}</View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      {head}
      {body}
      {footer ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 14), backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line }}>
          {footer}
        </View>
      ) : null}
    </View>
  )
}
