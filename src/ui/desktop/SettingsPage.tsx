import React from 'react'
import { ScrollView, View } from 'react-native'
import { DeskPage, Toolbar } from './kit'

/**
 * The shared shell for every desktop settings screen. Settings are forms, not data grids — so unlike the rest of
 * `kit.tsx` this does not reach for `DataTable`/`SplitPane`. It reuses just the app chrome (`DeskPage` + `Toolbar`)
 * and then centres whatever the screen passes as `children` in a comfortably narrow column, the way a desktop
 * preferences window reads (System Settings, Slack's own settings), instead of stretching a form edge to edge at
 * 1440px. Every desktop settings screen below is this shell plus the *same* mobile building blocks (`Field`,
 * `Section`, `Card`, `ListRow`, …) the phone screen already uses — never a re-layout in `kit.tsx`'s grid language.
 */
export function DesktopSettingsPage({ title, subtitle, right, children, maxWidth = 720 }: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
  /** Most forms read best around 720px; a few (long preview, wide tables of fields) may want a touch more. */
  maxWidth?: number
}) {
  return (
    <DeskPage toolbar={<Toolbar title={title} subtitle={subtitle} right={right} />}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingVertical: 32, paddingHorizontal: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: '100%', maxWidth, paddingBottom: 24 }}>{children}</View>
      </ScrollView>
    </DeskPage>
  )
}
