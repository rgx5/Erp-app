import { describe, expect, it } from 'vitest'
import { asRecords, parseCsv, toCsv } from '@/features/masterdata/csv'
import { hsnProblem } from '@/features/masterdata/ItemForm'

describe('CSV', () => {
  it('reads quoted commas, quotes, line breaks inside quotes, CRLF and a byte-order mark', () => {
    const text = '﻿Code,Name\r\nA1,"Shirt, cotton"\r\nA2,"He said ""hi"""\r\nA3,"two\nlines"\r\n\r\n'
    expect(parseCsv(text)).toEqual([['Code', 'Name'], ['A1', 'Shirt, cotton'], ['A2', 'He said "hi"'], ['A3', 'two\nlines']])
  })
  it('keys records by a forgiving header', () => {
    const { header, records } = asRecords(parseCsv('Code, Legal Name ,GST/Treatment\nC1,Asha,consumer\n'))
    expect(header).toEqual(['code', 'legalname', 'gsttreatment'])
    expect(records).toEqual([{ code: 'C1', legalname: 'Asha', gsttreatment: 'consumer' }])
  })
  it('writes what it reads, and defuses spreadsheet formulas', () => {
    const rows = [['A1', 'Shirt, "cotton"'], ['=HYPERLINK("x")', '-5'], ['-evil', '+1']]
    const out = toCsv(['Code', 'Name'], rows)
    expect(out).toContain('"Shirt, ""cotton"""')
    expect(out).toContain("'=HYPERLINK") // a formula is stored as text
    expect(out).toContain(',-5\r\n') // a plain negative number is left alone
    expect(out).toContain("'-evil")
    expect(parseCsv(out).slice(1, 2)).toEqual([['A1', 'Shirt, "cotton"']])
  })
})

describe('item rules shared with the server', () => {
  it('checks HSN and SAC shapes', () => {
    expect(hsnProblem('finished_good', '6205')).toBeNull()
    expect(hsnProblem('finished_good', '62051000')).toBeNull()
    expect(hsnProblem('finished_good', '62')).toMatch(/4, 6 or 8/)
    expect(hsnProblem('finished_good', '12345')).toMatch(/4, 6 or 8/)
    expect(hsnProblem('service', '998821')).toBeNull()
    expect(hsnProblem('service', '6205')).toMatch(/99/)
    expect(hsnProblem('service', '')).toBeNull()
  })
})
