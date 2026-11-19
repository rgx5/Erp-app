/** One item as the counter keeps it on this computer. */
export interface LocalItem {
  id: string; code: string; name: string; taxCodeId: string | null; tracking: string; mrp: string | null; noDiscount: boolean
  barcodes: string[]; active: boolean
}

export interface CatalogueIndex { items: LocalItem[]; byBarcode: Map<string, LocalItem>; byCode: Map<string, LocalItem>; lowerName: Map<string, string> }

export function buildIndex(items: LocalItem[]): CatalogueIndex {
  const byBarcode = new Map<string, LocalItem>(); const byCode = new Map<string, LocalItem>(); const lowerName = new Map<string, string>()
  const live = items.filter((i) => i.active).sort((a, b) => a.code.localeCompare(b.code))
  for (const i of live) { byCode.set(i.code.toLowerCase(), i); lowerName.set(i.id, i.name.toLowerCase()); for (const b of i.barcodes) byBarcode.set(b.toLowerCase(), i) }
  return { items: live, byBarcode, byCode, lowerName }
}

export interface SearchResult {
  /** A barcode or code that matched exactly: add it without asking. */
  exact: LocalItem | null
  /** What to offer while typing (best first). */
  matches: LocalItem[]
}

/**
 * Finds items on this computer, instantly and without the server: an exact barcode or code first, then codes that start with the text, then
 * names where every typed word starts a word, then names that contain the text anywhere.
 */
export function searchItems(ix: CatalogueIndex, text: string, limit = 8): SearchResult {
  const q = text.trim().toLowerCase()
  if (!q) return { exact: null, matches: [] }
  const exact = ix.byBarcode.get(q) ?? ix.byCode.get(q) ?? null
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { item: LocalItem; rank: number }[] = []
  for (const i of ix.items) {
    const code = i.code.toLowerCase(); const name = ix.lowerName.get(i.id) ?? ''
    let rank = -1
    if (i === exact) rank = 0
    else if (code.startsWith(q)) rank = 1
    else if (words.every((w) => name.split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))) rank = 2
    else if (name.includes(q) || code.includes(q)) rank = 3
    else if (i.barcodes.some((b) => b.toLowerCase().startsWith(q))) rank = 3
    if (rank >= 0) scored.push({ item: i, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.item.code.localeCompare(b.item.code))
  return { exact, matches: scored.slice(0, limit).map((s) => s.item) }
}
