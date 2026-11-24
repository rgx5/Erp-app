import { describe, expect, it } from 'vitest'
import { parseReply } from '@/features/einvoice/reply'

const irn = 'a'.repeat(64)
describe('portal reply', () => {
  it('reads a list of answers whatever the key spelling', () => {
    const r = parseReply(JSON.stringify([{ Irn: irn, AckNo: 112010012345678, AckDt: '2026-04-15 10:31:22', SignedQRCode: 'a.b.c', SignedInvoice: 'x.y.z', DocNo: 'INV1' }]))
    expect(r.items).toEqual([{ irn, ackNo: '112010012345678', ackDate: '2026-04-15 10:31:22', signedQr: 'a.b.c', signedInvoice: 'x.y.z', docNo: 'INV1' }])
  })
  it('finds answers inside wrappers and keeps what the portal refused', () => {
    const r = parseReply(JSON.stringify({ data: { success: [{ irn, ackno: '5', ackdate: '2026-04-15 10:31:22', signedqrcode: 'q.r.s' }], errors: [{ DocNo: 'INV2', ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }] } }))
    expect(r.items).toHaveLength(1); expect(r.rejected).toEqual([{ docNo: 'INV2', message: 'Duplicate IRN' }])
  })
  it('refuses a file that is not JSON', () => { expect(() => parseReply('not json')).toThrow(/JSON/) })
  it('returns nothing for an unrelated file', () => { expect(parseReply('{"hello":1}')).toEqual({ items: [], rejected: [] }) })
})
