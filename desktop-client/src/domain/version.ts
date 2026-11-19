/** Compares dotted version numbers ("1.4.10" is newer than "1.4.9"). Returns a negative number when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const y = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d }
  return 0
}
