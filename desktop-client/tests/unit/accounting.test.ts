import { describe, expect, it } from 'vitest'
import { parseBankDate, parseStatementCsv } from '@/features/accounting/statementCsv'

describe('bank statement CSV', () => {
  it('reads a signed Amount column and day-first dates', () => {
    const r = parseStatementCsv('Date,Description,Reference,Amount\n30/04/2026,Cheque 123,CHQ123,"-1,250.50"\n2026-05-02,NEFT from Asha,UTR9,10000\n')
    expect(r.errors).toEqual([])
    expect(r.lines).toEqual([
      { date: '2026-04-30', description: 'Cheque 123', reference: 'CHQ123', amount: '-1250.5000' },
      { date: '2026-05-02', description: 'NEFT from Asha', reference: 'UTR9', amount: '10000.0000' },
    ])
  })
  it('turns Withdrawal and Deposit columns into one signed amount', () => {
    const r = parseStatementCsv('Txn Date,Narration,Withdrawal,Deposit\n01-05-2026,Rent,5000,\n02-05-2026,Sale,,700\n')
    expect(r.lines.map((l) => l.amount)).toEqual(['-5000.0000', '700.0000'])
  })
  it('reports unreadable rows instead of guessing', () => {
    const r = parseStatementCsv('Date,Description,Amount\nyesterday,Oops,10\n01/05/2026,No amount,\n01/05/2026,Fine,5\n')
    expect(r.lines).toHaveLength(1)
    expect(r.errors).toHaveLength(2)
  })
  it('refuses a file without the needed columns', () => {
    expect(parseStatementCsv('A,B\n1,2\n').errors[0]).toMatch(/needs Date and Description/)
  })
  it('parses dates strictly', () => {
    expect(parseBankDate('5/6/2026')).toBe('2026-06-05')
    expect(parseBankDate('June 5')).toBeNull()
  })
})

import { buildJournalBody } from '@/features/accounting/JournalsPage'

describe('journal body', () => {
  const acct = (id: string) => ({ id, code: id, name: id, type: 'expense', parentId: null, isGroup: false, controlKind: null, status: 'active', version: 1 })
  const h = { companyId: 'c', date: '2026-05-01', description: 'Tea', journalType: 'general' }
  const line = (id: string, debit: string, credit: string) => ({ key: id + debit + credit, account: acct(id), debit, credit, note: '' })
  it('builds only a balanced entry with one side per line', () => {
    expect(buildJournalBody(h, [line('a', '500', ''), line('b', '', '500')])?.lines).toEqual([{ accountId: 'a', debit: '500' }, { accountId: 'b', credit: '500' }])
    expect(buildJournalBody(h, [line('a', '500', ''), line('b', '', '400')])).toBeNull()
    expect(buildJournalBody(h, [line('a', '500', '500'), line('b', '', '0')])).toBeNull()
    expect(buildJournalBody({ ...h, description: ' ' }, [line('a', '5', ''), line('b', '', '5')])).toBeNull()
  })
})
