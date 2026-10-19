import React from 'react'
import { Text as RNText, type TextProps, type TextStyle } from 'react-native'
import { toneColor, typography, useTheme, type Tone, type Variant } from './theme'

export interface TProps extends TextProps {
  v?: Variant
  tone?: Tone
  align?: TextStyle['textAlign']
  /** Cap font scaling so dense rows do not break at the largest accessibility sizes. */
  fixed?: boolean
}

/** The one text component. Every string in the app goes through it, so type and colour stay on the system. */
export function T({ v = 'body', tone = 'default', align, style, fixed, ...rest }: TProps) {
  const { c } = useTheme()
  return <RNText allowFontScaling={!fixed} maxFontSizeMultiplier={1.25} {...rest} style={[typography[v], { color: toneColor(c, tone) }, align ? { textAlign: align } : null, style]} />
}
