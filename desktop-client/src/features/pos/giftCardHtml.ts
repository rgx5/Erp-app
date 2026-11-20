import { formatDate, formatInr } from '@/domain/format'
import { barcodeSvg } from '@/features/retail/labels'
import { getPaper, paperCss } from './paper'
import type { GiftCard } from '@/api/schemas'

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** The slip handed over with a new gift card: the code to spend it with, as text and as a barcode the counter can scan. */
export function giftCardHtml(card: GiftCard, shop: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gift card ${esc(card.code)}</title>
<style>${paperCss(getPaper())}h1{font-size:13px;margin:0;text-align:center}.c{text-align:center}.big{font-size:16px;font-weight:700;margin:6px 0}hr{border:0;border-top:1px dashed #000;margin:5px 0}</style></head><body>
<h1>${esc(shop)}</h1><div class="c">Gift card</div><hr>
<div class="c big">${esc(formatInr(card.initialAmount))}</div>
<div class="c">${barcodeSvg(card.code, 40)}</div><div class="c big">${esc(card.code)}</div>
${card.holderName ? `<div class="c">For ${esc(card.holderName)}</div>` : ''}
<div class="c">${card.expiresOn ? `Valid until ${esc(formatDate(card.expiresOn))}` : 'No expiry date'}</div><hr>
<div class="c">Show this code at the counter to spend the balance.</div></body></html>`
}
