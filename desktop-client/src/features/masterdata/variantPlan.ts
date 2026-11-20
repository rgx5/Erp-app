export interface VariantPlan { code: string; name: string; size: string | undefined; colour: string | undefined }

const MAX = 150
const parts = (v: string): string[] => [...new Set(v.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean))]
const slug = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]+/g, '')

/** Every size and colour combination of one style, with the item code and name each gets. */
export function planVariants(style: string, name: string, sizes: string, colours: string): { plan: VariantPlan[]; tooMany: boolean } {
  const s = parts(sizes); const c = parts(colours)
  const sz: (string | undefined)[] = s.length ? s : [undefined]
  const cl: (string | undefined)[] = c.length ? c : [undefined]
  const plan: VariantPlan[] = []
  for (const a of sz) for (const b of cl) {
    const code = [style.trim().toUpperCase().replace(/[^A-Z0-9_./-]+/g, ''), a ? slug(a) : '', b ? slug(b) : ''].filter(Boolean).join('-').slice(0, 40)
    const tail = [a, b].filter(Boolean).join(' / ')
    plan.push({ code, name: `${name.trim()}${tail ? ` - ${tail}` : ''}`, size: a, colour: b })
  }
  return { plan: plan.slice(0, MAX), tooMany: plan.length > MAX }
}
