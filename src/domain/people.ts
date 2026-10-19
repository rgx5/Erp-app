const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'shri', 'smt', 'sri', 'shrimati', 'prof', 'er', 'ca', 'adv'])

/** The name to greet someone by: the first word, unless that is only a title ("Dr. Meera Iyer" → "Meera"). */
export function firstName(full: string | undefined | null): string {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean)
  const real = words.find((w) => !TITLES.has(w.replace(/\./g, '').toLowerCase()))
  return real ?? words[0] ?? ''
}
