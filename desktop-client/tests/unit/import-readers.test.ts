import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoMap, codeFromName, type TargetField } from '@/features/import/mapping'
import { readImportFile, detectDelimiter, decodeText } from '@/features/import/readers'
import { columnsOf } from '@/features/import/sqlite'

const fx = (n: string): Uint8Array => new Uint8Array(readFileSync(`tests/fixtures/import/${n}`))
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('reading data files', () => {
  it('reads a SQLite backup (a Vyapar .vyb): every row, text decoded, binary skipped, big rows joined up', async () => {
    const s = await readImportFile('company.vyb', fx('sample.vyb'))
    expect(s.format).toBe('Vyapar backup')
    const names = s.tables.find((t) => t.name === 'kb_names')!
    expect(names.rows).toHaveLength(400)
    expect(names.columns).toEqual(['name_id', 'full_name', 'phone_number', 'email', 'address', 'tin_number', 'name_type', 'name_image'])
    expect(names.rows[0]).toEqual(['1', 'Party 1 ₹ Traders', '9810000001', 'p1@x.in', '1 Main Road', '27ABCDE1234F1Z5', '1', ''])
    expect(names.rows[49]?.[4]).toHaveLength(720); expect(names.rows[349]?.[4]).toHaveLength(720) // rows that spill onto overflow pages
    expect(names.rows[6]?.[7]).toBe('') // the picture is not data
    expect(names.rows.map((r) => r[0])).toEqual(Array.from({ length: 400 }, (_, i) => String(i + 1))) // in order, none missed across pages
    expect(s.tables.find((t) => t.name === 'kb_items')!.rows[0]).toEqual(['1', 'Item 1', 'IT001', '8479', '101.5', '2', ''])
  })
  it('reads an Excel workbook: every sheet, shared text, dates written as dates', async () => {
    const s = await readImportFile('data.xlsx', fx('sample.xlsx'))
    expect(s.format).toBe('Excel workbook'); expect(s.tables.map((t) => t.name)).toEqual(['Parties', 'Items'])
    expect(s.tables[0]?.rows).toEqual([['Asha Traders', '27ABCDE1234F1Z5', '2026-04-15', '1234.5'], ['Ravi & Sons', '', '2026-04-16 10:30:00', '99']])
    expect(s.tables[1]?.rows).toEqual([['Widget', '8479']])
  })
  it('opens a zip of data files, and detects a semicolon-separated file', async () => {
    const s = await readImportFile('export.zip', fx('sample.zip'))
    expect(s.tables[0]).toMatchObject({ columns: ['Code', 'Name'], rows: [['A1', 'Alpha'], ['A2', 'Beta']] })
  })
  it('reads XML exports, one table per kind of record', async () => {
    const s = await readImportFile('ledgers.xml', fx('tally.xml'))
    const led = s.tables.find((t) => t.name === 'LEDGER')!
    expect(led.columns).toEqual(expect.arrayContaining(['NAME', 'PARENT', 'GSTIN']))
    expect(led.rows.map((r) => r[led.columns.indexOf('NAME')])).toEqual(['Asha Traders', 'Vendor & Co'])
  })
  it('reads JSON in its common shapes: a list, a wrapped list, records inside records, one record per line', async () => {
    const t = async (txt: string) => (await readImportFile('a.json', enc(txt))).tables
    expect((await t('[{"name":"A","price":1},{"name":"B","price":2,"extra":"x"}]'))[0]).toMatchObject({ columns: ['name', 'price', 'extra'], rows: [['A', '1', ''], ['B', '2', 'x']] })
    expect((await t('{"items":[{"n":"A"}],"customers":[{"n":"C"}]}')).map((x) => x.name)).toEqual(['items', 'customers'])
    expect((await t('[{"n":"A","addr":{"city":"Pune","pin":"411001"},"tags":["a","b"]}]'))[0]?.columns).toEqual(['n', 'addr.city', 'addr.pin', 'tags'])
    expect((await t('{"n":1}\n{"n":2}\n'))[0]?.rows).toEqual([['1'], ['2']])
    expect((await t('[["code","name"],["A1","Alpha"]]'))[0]?.rows).toEqual([['A1', 'Alpha']])
    await expect(t('{broken')).rejects.toThrow(/JSON/)
  })
  it('reads CSV and text variants: quoted, BOM, Windows code page, semicolon, tab, pipe', async () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';'); expect(detectDelimiter('a\tb\n1\t2')).toBe('\t'); expect(detectDelimiter('a|b\n1|2')).toBe('|'); expect(detectDelimiter('a,b\n1,"x,y"')).toBe(',')
    expect(decodeText(new Uint8Array([0x4d, 0xe9, 0x72, 0x65]))).toBe('Mére') // Windows-1252
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Name,Note\n"Ann, Jr","say ""hi"""\n')])
    expect((await readImportFile('x.csv', withBom)).tables[0]).toMatchObject({ columns: ['Name', 'Note'], rows: [['Ann, Jr', 'say "hi"']] })
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('A,B\n1,2\n').flatMap((ch) => [ch.charCodeAt(0), 0])])
    expect((await readImportFile('x.csv', utf16)).tables[0]?.rows).toEqual([['1', '2']])
    expect((await readImportFile('dups.csv', enc('Name,Name,\nA,B,C\n'))).tables[0]?.columns).toEqual(['Name', 'Name (2)', 'Column 3'])
  })
  it('says plainly what it cannot read', async () => {
    await expect(readImportFile('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).rejects.toThrow(/\.xlsx or CSV/)
    await expect(readImportFile('x.pdf', enc('%PDF-1.4 ...'))).rejects.toThrow(/PDF/)
    await expect(readImportFile('empty.csv', new Uint8Array())).rejects.toThrow(/empty/)
    await expect(readImportFile('hdr.csv', enc('Only,A,Header\n'))).rejects.toThrow(/No rows/)
    const cut = fx('sample.vyb').subarray(0, 5000)
    await expect(readImportFile('cut.vyb', cut)).rejects.toThrow()
  })
  it('works out column names from a table definition', () => {
    expect(columnsOf('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, "full name" TEXT, `x` REAL, [y] INT, PRIMARY KEY (id), price NUMERIC(10,2) DEFAULT 0)')).toEqual({ names: ['id', 'full name', 'x', 'y', 'price'], rowidAlias: 0 })
  })
})

describe('matching columns to fields', () => {
  const fields: TargetField[] = [
    { key: 'code', label: 'Code', required: false }, { key: 'legalname', label: 'Legal name', required: true }, { key: 'gstin', label: 'GSTIN', required: false }, { key: 'pan', label: 'PAN', required: false },
  ]
  it('recognises names used by other software', () => {
    expect(autoMap(['name_id', 'full_name', 'phone_number', 'tin_number'], fields)).toEqual({ legalname: 1, gstin: 3 })
    expect(autoMap(['Party Name', 'GST No.', 'PAN Number', 'Customer Code'], fields)).toEqual({ legalname: 0, gstin: 1, pan: 2, code: 3 })
    expect(autoMap(['NAME', 'GSTIN/UIN'], fields)).toEqual({ legalname: 0, gstin: 1 })
  })
  it('uses a column once, and leaves unknown columns alone', () => {
    expect(autoMap(['Name', 'Colour'], fields)).toEqual({ legalname: 0 })
  })
  it('makes codes from names and keeps them different', () => {
    const used = new Set<string>()
    expect([codeFromName('Steel widget (M)', used), codeFromName('Steel widget (M)', used), codeFromName('   ', used)]).toEqual(['STEEL-WIDGET-M', 'STEEL-WIDGET-M-2', 'ITEM'])
  })
})

import { resolveByCodeOrName, resolveItemType, resolveRole, resolveTax, resolveTreatment, resolveUnit } from '@/features/import/resolvers'
describe('translating values from other software', () => {
  const units = [{ code: 'NOS', name: 'Numbers' }, { code: 'KGS', name: 'Kilograms' }, { code: 'LTR', name: 'Litres' }]
  const taxes = [{ code: 'GST5', name: 'GST 5%' }, { code: 'GST12', name: 'GST 12%' }, { code: 'GST18', name: 'GST 18%' }, { code: 'EXEMPT', name: 'Exempt' }]
  it('units', () => {
    expect(['Pcs', 'kg', 'Ltr', 'NOS', 'Kilograms', 'piece'].map((u) => resolveUnit(units, u))).toEqual(['NOS', 'KGS', 'LTR', 'NOS', 'KGS', 'NOS'])
    expect(resolveUnit(units, '3')).toBeNull(); expect(resolveUnit(units, 'Bundle')).toBeNull()
  })
  it('GST rates', () => {
    expect(['12', '12%', 'GST 18%', 'IGST@5%', 'GST12', '0', 'Exempted', 'nil'].map((t) => resolveTax(taxes, t))).toEqual(['GST12', 'GST12', 'GST18', 'GST5', 'GST12', 'EXEMPT', 'EXEMPT', 'EXEMPT'])
    expect(resolveTax(taxes, '28%')).toBeNull()
  })
  it('categories, item types, roles and GST treatments', () => {
    expect(resolveByCodeOrName([{ code: 'MEN', name: 'Menswear' }], 'menswear')).toBe('MEN')
    expect(['Services', 'Raw Material', 'Product', 'goods'].map(resolveItemType)).toEqual(['service', 'raw_material', 'finished_good', 'finished_good'])
    expect(['Sundry Debtors', 'Customer', 'Sundry Creditors', 'Vendor', 'Both', '1'].map(resolveRole)).toEqual(['customer', 'customer', 'supplier', 'supplier', 'both', null])
    expect(['Unregistered', 'Regular', 'Composition', 'SEZ', 'Consumer', 'Overseas'].map(resolveTreatment)).toEqual(['unregistered', 'registered_regular', 'registered_composition', 'sez', 'consumer', 'overseas'])
  })
})
