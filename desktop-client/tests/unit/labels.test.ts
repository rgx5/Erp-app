import { describe, expect, it } from 'vitest'
import { LABEL_SIZES, labelsHtml } from '@/features/retail/labels'

describe('price labels', () => {
  it('makes one label per copy with name, price and a barcode image', () => {
    const html = labelsHtml([{ code: 'SOAP1', name: 'Lux <soap>', barcode: '8901234567890', price: '45', copies: 3 }], LABEL_SIZES[0]!, 'Shop & Co')
    expect(html.match(/class="l"/g)).toHaveLength(3)
    expect(html).toContain('Lux &lt;soap&gt;') // escaped
    expect(html).toContain('₹ 45.00')
    expect(html).toContain('<svg')
    expect(html).toContain('size:50mm 25mm')
  })
  it('lays a sheet out in columns on A4', () => {
    const html = labelsHtml([{ code: 'A', name: 'A', barcode: 'ABCD', price: null, copies: 1 }], LABEL_SIZES[2]!, 'S')
    expect(html).toContain('size:A4')
    expect(html).toContain('grid-template-columns:repeat(3,64mm)')
    expect(html).not.toContain('class="p"')
  })
})
