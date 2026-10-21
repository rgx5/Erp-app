import React from 'react'
import { csvFileName, toCsv, type CsvCell } from '@/domain/csv'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { T } from '@/ui/Text'
import { Download } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** A screen's "you may not" page. */
export function NoAccess({ title, who }: { title: string; who: string }) {
  return <Screen title={title} back><T tone="mute">{title} is for {who}.</T></Screen>
}

/** Exports a report's rows as a CSV file. */
export function CsvButton({ name, rows }: { name: string; rows: () => CsvCell[][] }) {
  const { c } = useTheme()
  return <Button label="CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName(name), toCsv(rows())).catch(() => toast('Could not export', 'err'))} />
}
