import { norm } from './mapping'

interface Named { code: string; name: string }
const digitsOf = (raw: string): string | null => /\d+(?:\.\d+)?/.exec(raw)?.[0] ?? null

const UNIT_ALIASES: [string[], string[]][] = [
  [['nos', 'no', 'number', 'numbers', 'piece', 'pieces', 'pc', 'pcs', 'unit', 'units', 'each', 'ea', 'unt'], ['NOS', 'PCS', 'UNT']],
  [['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kgm'], ['KGS', 'KG']], [['g', 'gm', 'gms', 'gram', 'grams'], ['GMS', 'GM']],
  [['l', 'lt', 'ltr', 'ltrs', 'litre', 'liter', 'litres', 'liters'], ['LTR', 'L']], [['ml', 'mls', 'millilitre', 'milliliter'], ['MLT', 'ML']],
  [['m', 'mt', 'mtr', 'mtrs', 'meter', 'metre', 'meters', 'metres'], ['MTR', 'M']], [['cm', 'cms', 'centimeter', 'centimetre'], ['CMS']],
  [['box', 'boxes'], ['BOX']], [['doz', 'dozen', 'dozens'], ['DOZ']], [['pair', 'pairs', 'prs'], ['PRS']], [['pac', 'pack', 'packs', 'pkt', 'packet', 'packets'], ['PAC']],
  [['set', 'sets'], ['SET']], [['bag', 'bags'], ['BAG']], [['btl', 'bottle', 'bottles'], ['BTL']], [['ctn', 'carton', 'cartons'], ['CTN']], [['rol', 'roll', 'rolls'], ['ROL']],
  [['sqft', 'sqfeet', 'sqf', 'squarefeet'], ['SQF']], [['sqm', 'sqmt', 'sqmtr', 'squaremeter', 'squaremetre'], ['SQM']], [['ton', 'tons', 'tonne', 'tonnes', 'mton'], ['TON']], [['qtl', 'quintal'], ['QTL']],
]
/** Our unit for a unit named in a file: by code, by name, or by the usual spellings (Pcs, Kg, Ltr, Mtr...). */
export function resolveUnit(units: Named[], raw: string): string | null {
  const n = norm(raw); if (!n) return null
  const byCode = units.find((u) => norm(u.code) === n) ?? units.find((u) => norm(u.name) === n); if (byCode) return byCode.code
  for (const [names, codes] of UNIT_ALIASES) if (names.includes(n)) { for (const c of codes) { const u = units.find((x) => x.code.toUpperCase() === c); if (u) return u.code } }
  return null
}

/** Our GST code for a rate or name in a file: "GST12", "GST 12%", "12%", "12", "IGST@12%", or exempt/nil for 0. */
export function resolveTax(taxes: Named[], raw: string): string | null {
  const n = norm(raw); if (!n) return null
  const direct = taxes.find((t) => norm(t.code) === n) ?? taxes.find((t) => norm(t.name) === n); if (direct) return direct.code
  if (/^(exempt|exempted|nil|nilrated|none|notax|zero)$/.test(n)) return taxes.find((t) => /exempt|nil|zero/i.test(`${t.code} ${t.name}`))?.code ?? null
  const d = digitsOf(raw); if (d === null) return null
  const rate = Number(d)
  if (rate === 0) return taxes.find((t) => /exempt|nil|zero/i.test(`${t.code} ${t.name}`))?.code ?? null
  const find = (re: RegExp): Named | undefined => taxes.find((t) => re.test(norm(t.code)) || re.test(norm(t.name)))
  const hit = find(new RegExp(`^(i|c|s)?gst${rate}(percent)?$`)) ?? find(new RegExp(`^gst${rate}`))
  return hit?.code ?? null
}

export function resolveByCodeOrName(list: Named[], raw: string): string | null {
  const n = norm(raw); if (!n) return null
  return (list.find((c) => norm(c.code) === n) ?? list.find((c) => norm(c.name) === n))?.code ?? null
}

/** The kind of item from the words programs use. */
export function resolveItemType(raw: string): string | null {
  const n = norm(raw); if (!n) return null
  if (/service|labou?r|work/.test(n)) return 'service'
  if (/raw/.test(n)) return 'raw_material'
  if (/packing|packaging/.test(n)) return 'packing_material'
  if (/semi/.test(n)) return 'semi_finished'
  if (/consumable/.test(n)) return 'consumable'
  if (/trading|traded|resale/.test(n)) return 'trading_good'
  if (/finished|^product$|^products$|^goods?$|^stock$|^inventory|^item$/.test(n)) return 'finished_good'
  return null
}

/** Customer, supplier or both, from how the file labels a party. */
export function resolveRole(raw: string): string | null {
  const n = norm(raw); if (!n) return null
  const cust = /cust|debtor|buyer|client|receivable|sale/.test(n); const supp = /supp|vend|creditor|payable|purchase/.test(n)
  if (/both/.test(n) || (cust && supp)) return 'both'
  if (/sub.?contract|jobwork/.test(n)) return 'subcontractor'
  return cust ? 'customer' : supp ? 'supplier' : null
}

export function resolveTreatment(raw: string): string | null {
  const n = norm(raw); if (!n) return null
  if (/unreg|nogst|nonregistered|notregistered|^no$|^false$/.test(n)) return 'unregistered'
  if (/consumer|b2c|retail|walkin/.test(n)) return 'consumer'
  if (/composition/.test(n)) return 'registered_composition'
  if (/sez/.test(n)) return 'sez'
  if (/overseas|export|foreign/.test(n)) return 'overseas'
  if (/regular|registered|^yes$|^true$/.test(n)) return 'registered_regular'
  return null
}
