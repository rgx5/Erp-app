import React, { useEffect, useRef, useState } from 'react'
import { Animated, Dimensions, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { T } from './Text'
import { IconButton } from './Button'
import { Close } from './icons'
import { useTheme } from './theme'

/**
 * A bottom sheet: slides up over a dimmed backdrop, handle on top, content scrolls, an optional footer stays pinned.
 * Tapping the backdrop or the close button dismisses it.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer, full, scroll = true, bare }: {
  visible: boolean; onClose: () => void; title?: string; subtitle?: string; children?: React.ReactNode; footer?: React.ReactNode
  /** Take (almost) the full height — for long forms. */
  full?: boolean
  scroll?: boolean
  /** No header: the content supplies its own. */
  bare?: boolean
}) {
  const { c, radius } = useTheme()
  const insets = useSafeAreaInsets()
  const H = Dimensions.get('window').height
  const y = useRef(new Animated.Value(H)).current
  const fade = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start()
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(y, { toValue: H, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setMounted(false))
    }
  }, [visible, mounted, H, fade, y])

  if (!mounted) return null
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay, opacity: fade }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: full ? '94%' : '88%' }}>
          <Animated.View style={{
            transform: [{ translateY: y }], backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
            paddingBottom: footer ? 0 : Math.max(insets.bottom, 12), ...(full ? { minHeight: '70%' } : null),
          }}>
            <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: c.lineStrong }} />
            </View>
            {!bare && (title || subtitle) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  {title ? <T v="h2" numberOfLines={1}>{title}</T> : null}
                  {subtitle ? <T v="caption" tone="mute" numberOfLines={2}>{subtitle}</T> : null}
                </View>
                <IconButton label="Close" tone="ghost" size={36} onPress={onClose}><Close size={20} color={c.inkSoft} /></IconButton>
              </View>
            ) : null}
            {scroll ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: footer ? 12 : 8 }} showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            ) : <View style={{ paddingHorizontal: 20 }}>{children}</View>}
            {footer ? (
              <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 14), borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface }}>
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
