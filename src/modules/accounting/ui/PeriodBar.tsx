import React from 'react'
import { FlatList, View } from 'react-native'
import { Field } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { PERIOD_OPTIONS } from '../logic'
import type { PeriodState } from './hooks'

/** Chips for the usual periods, and two date fields when "Custom" is chosen. */
export function PeriodBar({ p }: { p: PeriodState }) {
  return (
    <View style={{ gap: 10 }}>
      <FlatList horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} data={PERIOD_OPTIONS} keyExtractor={(o) => o.value}
        renderItem={({ item }) => <Chip label={item.label} selected={p.key === item.value} onPress={() => p.setKey(item.value)} />} />
      {p.key === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="From" value={p.fromText} onChangeText={p.setFromText} placeholder="YYYY-MM-DD" containerStyle={{ flex: 1 }} autoCapitalize="none" />
          <Field label="To" value={p.toText} onChangeText={p.setToText} placeholder="YYYY-MM-DD" containerStyle={{ flex: 1 }} autoCapitalize="none" />
        </View>
      ) : null}
    </View>
  )
}
