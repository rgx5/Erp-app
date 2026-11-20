import { z } from 'zod'
import { itemBarcode, type ItemBarcode } from '@/api/schemas'
import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'
import { generateEan13 } from './labels'

const barcodesOf = async (itemId: string): Promise<ItemBarcode[]> => {
  const api = currentApi()
  const r = await api.call(api.raw.GET('/v1/items/{id}/barcodes', { params: { path: { id: itemId } } }), z.object({ items: z.array(itemBarcode) }))
  return r.items
}

/** Gives an item a new in-store barcode (retrying on the rare clash) and returns it. */
export async function generateBarcode(itemId: string): Promise<string> {
  const api = currentApi()
  for (let attempt = 0; attempt < 6; attempt++) {
    const barcode = generateEan13()
    try {
      await api.call(api.raw.POST('/v1/items/{id}/barcodes', { params: { path: { id: itemId } }, body: { barcode }, headers: { 'idempotency-key': crypto.randomUUID() } }), itemBarcode)
      return barcode
    } catch (e) { if (!(e instanceof ApiError && e.code === 'barcode_in_use')) throw e }
  }
  throw new Error('Could not find a free barcode number. Try again.')
}

/** The barcode to print for an item: its first active one; made when it has none and `generate` is on; else null (the label then uses the item code). */
export async function barcodeForLabel(itemId: string, generate: boolean): Promise<{ barcode: string | null; made: boolean }> {
  const active = (await barcodesOf(itemId)).find((b) => b.status === 'active')
  if (active) return { barcode: active.barcode, made: false }
  return generate ? { barcode: await generateBarcode(itemId), made: true } : { barcode: null, made: false }
}
