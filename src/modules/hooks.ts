import { useCallback, useMemo } from 'react'
import { can } from '@/domain/permissions'
import type { Permission } from '@/domain/permissions'
import { currentUser, useApp } from '@/data/store'
import { allModules, type FeatureEntry, type HomeNotice, type ModuleDef, type ReportEntry } from './registry'

export interface Gate { perm?: Permission; industries?: string[]; needsKosh?: boolean }

/** Whether this person, in this workspace and industry, should see something that is gated. */
export function useGate(): (g: Gate) => boolean {
  const role = useApp((s) => currentUser(s)?.role)
  const industry = useApp((s) => s.workspace?.industry ?? '')
  const mode = useApp((s) => s.workspace?.mode)
  const backend = useApp((s) => s.workspace?.backend)
  return useCallback((g: Gate) => {
    if (g.perm && !can(role, g.perm)) return false
    if (g.industries && !g.industries.includes(industry)) return false
    // A Krishna-compatible server has no tables for the new modules; everything else (offline, Kosh) has them.
    if (g.needsKosh && mode === 'remote' && backend !== 'kosh') return false
    return true
  }, [role, industry, mode, backend])
}


/** The apps this person can open here, each with only the features they may use. Apps with nothing to show are left out. */
export function useVisibleModules(): Array<ModuleDef & { visible: FeatureEntry[] }> {
  const gate = useGate()
  const state = useApp((s) => s.data)
  void state
  return useMemo(
    () => allModules()
      .filter((m) => gate(m))
      .map((m) => ({ ...m, visible: m.features.filter((f) => gate(f)) }))
      .filter((m) => m.visible.length),
    [gate],
  )
}

/** Every report from every app that this person may open, grouped. */
export function useVisibleReports(): Array<{ group: string; items: ReportEntry[] }> {
  const gate = useGate()
  return useMemo(() => {
    const groups = new Map<string, ReportEntry[]>()
    for (const m of allModules()) {
      if (!gate(m)) continue
      for (const r of m.reports ?? []) if (gate(r)) groups.set(r.group, [...(groups.get(r.group) ?? []), r])
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }))
  }, [gate])
}

/** Things the apps want to point out on the Home screen right now. */
export function useModuleNotices(): HomeNotice[] {
  const gate = useGate()
  const data = useApp((s) => s.data)
  return useMemo(() => {
    const out: HomeNotice[] = []
    const now = Date.now()
    for (const m of allModules()) {
      if (!gate(m)) continue
      for (const fn of m.notices ?? []) {
        try { const n = fn(data, now); if (n) out.push(n) } catch { /* a faulty notice must never break the Home screen */ }
      }
    }
    return out
  }, [gate, data])
}
