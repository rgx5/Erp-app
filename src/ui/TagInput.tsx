import React, { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { T } from './Text'
import { Tap } from './primitives'
import { Close } from './icons'
import { fonts, useTheme } from './theme'

/** Type a value and press return (or comma) to turn it into a chip — for sizes, colours, pack sizes, portions. */
export function TagInput({ label, value, onChange, placeholder, hint, error, suggestions, caps = 'words' }: {
  label?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; hint?: string; error?: string | null; suggestions?: string[]
  /** Keyboard capitalisation: sizes read best in capitals (XL), colours and names in words. */
  caps?: 'characters' | 'words'
}) {
  const { c, radius } = useTheme()
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)

  const commit = (raw: string) => {
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean)
    if (!parts.length) { setText(''); return }
    const next = [...value]
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setText('')
  }

  const free = (suggestions ?? []).filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase()))

  return (
    <View>
      {label ? <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10, minHeight: 50, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: focus || error ? 1.5 : StyleSheet.hairlineWidth * 2, borderColor: error ? c.danger : focus ? c.primary : c.lineStrong, alignItems: 'center' }}>
        {value.map((t) => (
          <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, height: 32, borderRadius: 16, backgroundColor: c.primaryTint }}>
            <T v="bodyStrong" tone="primary" style={{ fontSize: 13.5 }}>{t}</T>
            <Tap onPress={() => onChange(value.filter((x) => x !== t))} hitSlop={8} accessibilityLabel={`Remove ${t}`}><Close size={14} color={c.primary} /></Tap>
          </View>
        ))}
        <TextInput
          value={text}
          onChangeText={(t) => { if (t.includes(',')) commit(t); else setText(t) }}
          onSubmitEditing={() => commit(text)}
          onBlur={() => { setFocus(false); commit(text) }}
          onFocus={() => setFocus(true)}
          placeholder={value.length ? '' : placeholder}
          placeholderTextColor={c.inkMute}
          blurOnSubmit={false}
          returnKeyType="done"
          autoCapitalize={caps}
          style={{ flex: 1, minWidth: 90, height: 32, color: c.ink, fontFamily: fonts.body, fontSize: 16, paddingVertical: 0, outlineWidth: 0 }}
        />
      </View>
      {free.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {free.slice(0, 8).map((s) => (
            <Tap key={s} onPress={() => onChange([...value, s])} style={{ paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
              <T v="caption" tone="soft">+ {s}</T>
            </Tap>
          ))}
        </View>
      ) : null}
      {error ? <T v="caption" tone="danger" style={{ marginTop: 5 }}>{error}</T> : hint ? <T v="caption" tone="mute" style={{ marginTop: 5 }}>{hint}</T> : null}
    </View>
  )
}
