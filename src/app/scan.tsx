import React, { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { closeScanner, handleScan, scannerHint, scannerTitle, type ScanResult } from '@/features/scanBus'
import { Button, IconButton } from '@/ui/Button'
import type { InputRef } from '@/ui/Inputs'
import { Tap } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Camera, Check, Close, Flashlight, XCircle } from '@/ui/icons'
import { success, fail } from '@/ui/feedback'
import { fonts } from '@/ui/theme'

const TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] as const

/**
 * A full-screen scanner that stays open: scan one item after another, each answered with a line of feedback and a
 * haptic tick. No camera (or no permission)? Type the code, or scan with a Bluetooth/USB scanner — they type like a keyboard.
 */
export default function Scan() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [perm, requestPerm] = useCameraPermissions()
  const [torch, setTorch] = useState(false)
  const [last, setLast] = useState<ScanResult | null>(null)
  const [manual, setManual] = useState('')
  const recent = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const inputRef = useRef<InputRef>(null)

  useEffect(() => () => closeScanner(), [])

  function onCode(code: string) {
    const now = Date.now()
    // The camera sees the same barcode dozens of times a second: count it once, then wait.
    if (recent.current.code === code && now - recent.current.at < 1600) return
    recent.current = { code, at: now }
    const r = handleScan(code)
    setLast(r)
    if (r.ok) success(); else fail()
  }

  const granted = perm?.granted
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: [...TYPES] }} onBarcodeScanned={(e) => onCode(e.data)} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 14 }}>
          <Camera size={44} color="rgba(255,255,255,0.7)" />
          <T v="h2" style={{ color: '#fff' }} align="center">Camera access</T>
          <T style={{ color: 'rgba(255,255,255,0.7)' }} align="center">{perm && !perm.canAskAgain ? 'Camera permission is off. Turn it on in your phone’s Settings to scan.' : 'Allow the camera to scan barcodes — or type the code below.'}</T>
          {perm?.canAskAgain !== false && Platform.OS !== 'web' ? <Button label="Allow camera" onPress={() => void requestPerm()} /> : null}
        </View>
      )}

      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton label="Close scanner" tone="dark" onPress={() => router.back()}><Close size={20} color="#fff" /></IconButton>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" style={{ color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 }}>{scannerTitle()}</T>
          {scannerHint() ? <T v="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>{scannerHint()}</T> : null}
        </View>
        {granted ? <IconButton label="Torch" tone="dark" onPress={() => setTorch((t) => !t)}><Flashlight size={20} color={torch ? '#FFB36B' : '#fff'} /></IconButton> : null}
      </View>

      {/* Viewfinder */}
      {granted ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '24%', left: '10%', right: '10%', height: 190 }}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
            <View key={k} style={{ position: 'absolute', width: 34, height: 34, borderColor: '#fff', borderWidth: 4, borderRadius: 8,
              ...(k[0] === 't' ? { top: 0, borderBottomWidth: 0 } : { bottom: 0, borderTopWidth: 0 }), ...(k[1] === 'l' ? { left: 0, borderRightWidth: 0 } : { right: 0, borderLeftWidth: 0 }) }} />
          ))}
          <View style={{ position: 'absolute', left: 14, right: 14, top: '50%', height: 2, backgroundColor: '#FF5A5F', opacity: 0.85 }} />
        </View>
      ) : null}

      {/* Result + manual entry */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: Math.max(insets.bottom, 16), gap: 12 }}>
        {last ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: last.ok ? 'rgba(14,159,110,0.95)' : 'rgba(224,62,68,0.95)' }}>
            {last.ok ? <Check size={22} color="#fff" /> : <XCircle size={22} color="#fff" />}
            <T v="bodyStrong" style={{ color: '#fff', flex: 1 }} numberOfLines={2}>{last.text}</T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <TextInput ref={inputRef} value={manual} onChangeText={setManual} placeholder="Type or scan a code" placeholderTextColor="rgba(255,255,255,0.5)" autoCapitalize="characters" autoCorrect={false}
            returnKeyType="done" onSubmitEditing={() => { if (manual.trim()) { onCode(manual.trim()); setManual('') } inputRef.current?.focus() }}
            style={{ flex: 1, height: 50, borderRadius: 16, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', color: '#fff', fontFamily: fonts.body, fontSize: 16, outlineWidth: 0 }} />
          <Tap onPress={() => router.back()} style={{ height: 50, paddingHorizontal: 22, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <T v="bodyStrong" style={{ color: '#0B1440' }}>Done</T>
          </Tap>
        </View>
      </View>
    </View>
  )
}
