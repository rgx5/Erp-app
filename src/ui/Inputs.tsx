import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Switch, TextInput, View, type KeyboardTypeOptions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { fmtQty, isFrac, round3, type SellRules } from '@/domain/qty'
import { T } from './Text'
import { Tap } from './primitives'
import { Check, ChevronDown, Close, Minus, Plus, Search as SearchIcon } from './icons'
import { fonts, useTheme } from './theme'
import { Sheet } from './Sheet'

/** What a ref to one of our text inputs points at. */
export type InputRef = React.ComponentRef<typeof TextInput>

export interface FieldProps extends Omit<TextInputProps, 'style' | 'onChange'> {
  label?: string
  hint?: string
  error?: string | null
  prefix?: string
  suffix?: string
  left?: React.ReactNode
  right?: React.ReactNode
  large?: boolean
  mono?: boolean
  align?: 'left' | 'right' | 'center'
  containerStyle?: StyleProp<ViewStyle>
  inputRef?: React.Ref<InputRef>
}

/** A labelled text input on a soft well. Focus draws a cobalt ring; errors turn the border red and explain themselves. */
export function Field({ label, hint, error, prefix, suffix, left, right, large, mono, align, containerStyle, inputRef, editable = true, multiline, ...rest }: FieldProps) {
  const { c, radius } = useTheme()
  const [focus, setFocus] = useState(false)
  return (
    <View style={containerStyle}>
      {label ? <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}</T> : null}
      <View style={{
        flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 8, minHeight: large ? 60 : 50, paddingHorizontal: 14, borderRadius: radius.md,
        backgroundColor: editable ? c.surface : c.sunken, borderWidth: focus || error ? 1.5 : StyleSheet.hairlineWidth * 2,
        borderColor: error ? c.danger : focus ? c.primary : c.lineStrong,
      }}>
        {left}
        {prefix ? <T v="bodyStrong" tone="mute">{prefix}</T> : null}
        <TextInput
          ref={inputRef}
          editable={editable}
          multiline={multiline}
          placeholderTextColor={c.inkMute}
          selectionColor={c.primary}
          cursorColor={c.primary}
          onFocus={(e) => { setFocus(true); rest.onFocus?.(e) }}
          onBlur={(e) => { setFocus(false); rest.onBlur?.(e) }}
          {...rest}
          style={{
            flex: 1, minWidth: 0, color: c.ink, fontFamily: large ? fonts.display : mono ? fonts.displayMedium : fonts.body, fontSize: large ? 24 : 16,
            paddingVertical: multiline ? 12 : 0, minHeight: multiline ? 84 : undefined, textAlign: align ?? 'left', textAlignVertical: multiline ? 'top' : 'center',
            // web only: the focus ring above replaces the browser's outline
            outlineWidth: 0,
          }}
        />
        {suffix ? <T v="bodyStrong" tone="mute">{suffix}</T> : null}
        {right}
      </View>
      {error ? <T v="caption" tone="danger" style={{ marginTop: 5 }}>{error}</T> : hint ? <T v="caption" tone="mute" style={{ marginTop: 5 }}>{hint}</T> : null}
    </View>
  )
}

const cleanDecimal = (s: string) => {
  const t = s.replace(/[^\d.]/g, '')
  const i = t.indexOf('.')
  return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, 3)
}

/** Rupee amount entry: decimal keypad, only digits and one point, ₹ prefix. The value stays a string until it is used. */
export function MoneyField({ value, onChange, ...rest }: Omit<FieldProps, 'value' | 'onChangeText' | 'prefix' | 'keyboardType'> & { value: string; onChange: (v: string) => void }) {
  return <Field {...rest} value={value} onChangeText={(t) => onChange(cleanDecimal(t))} prefix="₹" keyboardType="decimal-pad" placeholder={rest.placeholder ?? '0'} />
}

export function NumberField({ value, onChange, decimals, ...rest }: Omit<FieldProps, 'value' | 'onChangeText'> & { value: string; onChange: (v: string) => void; decimals?: boolean }) {
  return <Field {...rest} value={value} onChangeText={(t) => onChange(decimals ? cleanDecimal(t) : t.replace(/\D/g, ''))} keyboardType={decimals ? 'decimal-pad' : 'number-pad'} />
}

export function SearchBar({ value, onChange, placeholder = 'Search', right, autoFocus, onSubmit, inputRef }: {
  value: string; onChange: (v: string) => void; placeholder?: string; right?: React.ReactNode; autoFocus?: boolean; onSubmit?: () => void; inputRef?: React.Ref<InputRef>
}) {
  const { c, radius, shadow } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line }, shadow(1)]}>
        <View style={{ flexShrink: 0 }}><SearchIcon size={18} color={c.inkMute} /></View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.inkMute}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          selectionColor={c.primary}
          style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 16, outlineWidth: 0 }}
        />
        {value ? <Tap onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear search"><Close size={18} color={c.inkMute} /></Tap> : null}
      </View>
      {right}
    </View>
  )
}

export interface SegOption<V extends string> { value: V; label: string; icon?: React.ReactNode }

/** Pill-shaped segmented control. */
export function Segmented<V extends string>({ value, options, onChange, compact }: { value: V; options: Array<SegOption<V>>; onChange: (v: V) => void; compact?: boolean }) {
  const { c, radius } = useTheme()
  return (
    <View style={{ flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: c.sunken, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Tap key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1, height: compact ? 32 : 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? c.surface : 'transparent', ...(on ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.line } : null) }}>
            {o.icon}
            <T v="bodyStrong" style={{ fontSize: compact ? 12.5 : 13.5, color: on ? c.ink : c.inkSoft }} numberOfLines={1}>{o.label}</T>
          </Tap>
        )
      })}
    </View>
  )
}

export function SwitchRow({ title, subtitle, value, onChange, disabled }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{title}</T>
        {subtitle ? <T v="caption" tone="mute">{subtitle}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: c.lineStrong, true: c.primary }} thumbColor="#FFFFFF" ios_backgroundColor={c.lineStrong} />
    </View>
  )
}

/** A field that opens a sheet of choices. */
export function Select<V extends string>({ label, value, options, onChange, placeholder = 'Choose', hint, error, searchable }: {
  label?: string; value: V | ''; options: Array<{ value: V; label: string; sub?: string }>; onChange: (v: V) => void; placeholder?: string; hint?: string; error?: string | null; searchable?: boolean
}) {
  const { c, radius } = useTheme()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const cur = options.find((o) => o.value === value)
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options
  return (
    <View>
      {label ? <T v="label" tone="soft" style={{ marginBottom: 6 }}>{label}</T> : null}
      <Tap onPress={() => { setQ(''); setOpen(true) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: error ? c.danger : c.lineStrong }}>
        <T v="body" tone={cur ? 'default' : 'mute'} style={{ flex: 1 }} numberOfLines={1}>{cur?.label ?? placeholder}</T>
        <ChevronDown size={18} color={c.inkMute} />
      </Tap>
      {error ? <T v="caption" tone="danger" style={{ marginTop: 5 }}>{error}</T> : hint ? <T v="caption" tone="mute" style={{ marginTop: 5 }}>{hint}</T> : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? placeholder}>
        {searchable ? <View style={{ marginBottom: 12 }}><SearchBar value={q} onChange={setQ} placeholder="Search" /></View> : null}
        {shown.map((o) => (
          <Tap key={o.value} onPress={() => { onChange(o.value); setOpen(false) }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">{o.label}</T>
              {o.sub ? <T v="caption" tone="mute">{o.sub}</T> : null}
            </View>
            {o.value === value ? <Check size={20} color={c.primary} /> : null}
          </Tap>
        ))}
        {!shown.length ? <T tone="mute" align="center" style={{ paddingVertical: 20 }}>Nothing found</T> : null}
      </Sheet>
    </View>
  )
}

/** Quantity stepper: − / editable value / +. Fractions (kg, metres) step by the item's own step and accept typed values. */
export function Stepper({ value, onChange, rules, max, min, compact }: { value: number; onChange: (n: number) => void; rules?: SellRules; max?: number; min?: number; compact?: boolean }) {
  const { c } = useTheme()
  const step = rules?.step ?? (isFrac(rules) ? 0.5 : 1)
  const lo = min ?? 0
  const [text, setText] = useState(fmtQty(value))
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setText(fmtQty(value)) }, [value])
  const clamp = (n: number) => round3(Math.max(lo, max !== undefined ? Math.min(max, n) : n))
  const size = compact ? 32 : 38
  const btn = (kind: 'minus' | 'plus') => (
    <Tap onPress={() => onChange(clamp(value + (kind === 'plus' ? step : -step)))} accessibilityLabel={kind === 'plus' ? 'Increase quantity' : 'Decrease quantity'}
      style={{ width: size, height: size, borderRadius: size / 2.4, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === 'plus' ? c.primaryTint : c.sunken }}>
      {kind === 'plus' ? <Plus size={17} color={c.primary} /> : <Minus size={17} color={c.inkSoft} />}
    </Tap>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {btn('minus')}
      <TextInput
        value={text}
        onChangeText={(t) => { editing.current = true; setText(t.replace(isFrac(rules) ? /[^\d.]/g : /\D/g, '')) }}
        onEndEditing={() => { editing.current = false; const n = Number(text); onChange(Number.isFinite(n) && text !== '' ? clamp(isFrac(rules) ? n : Math.floor(n)) : value); setText(fmtQty(value)) }}
        keyboardType={(isFrac(rules) ? 'decimal-pad' : 'number-pad') as KeyboardTypeOptions}
        selectTextOnFocus
        style={{ width: compact ? 40 : 48, textAlign: 'center', color: c.ink, fontFamily: fonts.display, fontSize: compact ? 15 : 16, paddingVertical: 0, outlineWidth: 0 }}
      />
      {btn('plus')}
    </View>
  )
}
