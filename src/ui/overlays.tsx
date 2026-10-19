import React, { useEffect, useRef } from 'react'
import { Animated, Modal, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { T } from './Text'
import { Button } from './Button'
import { Tap } from './primitives'
import { AlertCircle, CheckCircle, Info } from './icons'
import { success as hapticOk, fail as hapticFail } from './feedback'
import { useTheme } from './theme'

// ───────────────────────────── toasts ─────────────────────────────

export type ToastKind = 'info' | 'ok' | 'err'
interface ToastItem { id: number; text: string; kind: ToastKind; action?: { label: string; run: () => void } }

const useToasts = create<{ items: ToastItem[]; push: (t: ToastItem) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-2), t] })),
  drop: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}))

let seq = 0
/** A short message at the bottom of the screen. With an action (Undo…) it stays long enough to reach the button. */
export function toast(text: string, kind: ToastKind = 'info', action?: ToastItem['action']) {
  const id = ++seq
  if (kind === 'ok') hapticOk(); else if (kind === 'err') hapticFail()
  useToasts.getState().push({ id, text, kind, action })
  setTimeout(() => useToasts.getState().drop(id), action ? 6000 : 2800)
}

function ToastView({ t }: { t: ToastItem }) {
  const { c, shadow } = useTheme()
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start() }, [a])
  const icon = t.kind === 'ok' ? <CheckCircle size={19} color={c.success} /> : t.kind === 'err' ? <AlertCircle size={19} color={c.danger} /> : <Info size={19} color={c.primary} />
  return (
    <Animated.View style={[{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }, shadow(3)]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.ink }}>
        {icon}
        <T v="bodyStrong" style={{ color: c.bg, flexShrink: 1, fontSize: 14 }}>{t.text}</T>
        {t.action ? (
          <Tap onPress={() => { t.action!.run(); useToasts.getState().drop(t.id) }} style={{ marginLeft: 6 }}>
            <T v="bodyStrong" style={{ color: c.primary === '#2B59FF' ? '#8CA9FF' : c.primary, fontSize: 14 }}>{t.action.label}</T>
          </Tap>
        ) : null}
      </View>
    </Animated.View>
  )
}

export function ToastHost() {
  const items = useToasts((s) => s.items)
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 92, gap: 8 }}>
      {items.map((t) => <ToastView key={t.id} t={t} />)}
    </View>
  )
}

// ───────────────────────────── confirm dialogs ─────────────────────────────

interface DialogReq { title: string; message?: string; confirm?: string; cancel?: string; danger?: boolean; info?: boolean; resolve: (ok: boolean) => void }
const useDialog = create<{ req: DialogReq | null; set: (r: DialogReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }))

/** `if (await ask({ title: 'Discard this bill?', danger: true })) …` — a promise, so it reads like the decision it is. */
export function ask(o: Omit<DialogReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().set({ ...o, resolve }))
}
/** An acknowledgement with a single button. */
export const tell = (title: string, message?: string) => ask({ title, message, confirm: 'OK', cancel: '', info: true })

export function DialogHost() {
  const { c, radius, shadow } = useTheme()
  const req = useDialog((s) => s.req)
  if (!req) return null
  const done = (ok: boolean) => { useDialog.getState().set(null); req.resolve(ok) }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => done(false)} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} onPress={() => done(false)} />
        <View style={[{ width: '100%', maxWidth: 380, backgroundColor: c.surface, borderRadius: radius.xl, padding: 22, gap: 8 }, shadow(3)]}>
          <T v="h2">{req.title}</T>
          {req.message ? <T tone="soft">{req.message}</T> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            {req.cancel !== '' ? <View style={{ flex: 1 }}><Button label={req.cancel ?? 'Cancel'} kind="outline" block onPress={() => done(false)} /></View> : null}
            <View style={{ flex: 1 }}><Button label={req.confirm ?? 'Confirm'} kind={req.danger ? 'danger' : 'primary'} block onPress={() => done(true)} /></View>
          </View>
        </View>
      </View>
    </Modal>
  )
}
