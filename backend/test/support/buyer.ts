import type pg from 'pg';
import { call, makeGstin, type TestServer } from './harness.js';
import { ok, shopKit, type Shop } from './shop.js';

export interface Buyer extends Shop { sup: { inter: string; intra: string; unreg: string; composition: string } }

/** Purchasing test world: a buyer in Maharashtra (27) with every purchasing account set and suppliers of each GST kind. */
export function buyerKit(server: TestServer, supers: pg.Pool) {
  const kit = shopKit(server, supers);
  let seq = 0;
  let invoiceSeq = 0;

  async function buyer(name: string, settings: object = {}): Promise<Buyer> {
    const s = await kit.shop(name);
    ok(await call(server, 'PUT', `/v1/companies/${s.companyId}/purchasing-settings`, {
      tenant: s.tenant,
      body: {
        payableAccountId: s.acc['2110'], grniAccountId: s.acc['2120'], purchasePriceVarianceAccountId: s.acc['5400'], expensePurchaseAccountId: s.acc['5900'], roundOffAccountId: s.acc['5900'], costVarianceAccountId: s.acc['5300'], freightAccountId: s.acc['5220'],
        inputCgstAccountId: s.acc['1310'], inputSgstAccountId: s.acc['1320'], inputIgstAccountId: s.acc['1330'], rcmCgstAccountId: s.acc['2210'], rcmSgstAccountId: s.acc['2220'], rcmIgstAccountId: s.acc['2230'], ...settings,
      },
    }), 200);
    const sup = async (code: string, treatment: string, state?: string) =>
      ok(await call(server, 'POST', '/v1/parties', { tenant: s.tenant, body: { code: `${code}-${++seq}`, legalName: `${code} Supplies`, gstTreatment: treatment, isSupplier: true, ...(state ? { gstin: makeGstin(state, 'KLMNO9012P', (++seq % 35 + 1).toString(36).toUpperCase()) } : {}) } })).id as string;
    return { ...s, sup: { inter: await sup('INTER', 'registered_regular', '29'), intra: await sup('INTRA', 'registered_regular', '27'), unreg: await sup('UNREG', 'unregistered'), composition: await sup('COMP', 'registered_composition', '27') } };
  }

  /** Net debit minus credit on an account (code), from the trial balance, which must balance. */
  const net = async (b: Buyer, code: string) => {
    const t = (await call(server, 'GET', `/v1/accounting/trial-balance?companyId=${b.companyId}&from=2025-04-01&to=2026-03-31`, { tenant: b.tenant })).json;
    const r = t.rows.find((x: { code: string }) => x.code === code) as { closingDebit: string; closingCredit: string } | undefined;
    if (!t.balanced) throw new Error('trial balance does not balance');
    return r ? Math.round((Number(r.closingDebit) - Number(r.closingCredit)) * 10000) / 10000 : 0;
  };

  /** An order for `quantity` units, fully received: returns the receipt and the ids a bill needs. */
  const ordered = async (b: Buyer, supplier: string, o: { quantity?: string; price?: string; discount?: string; itemId?: string } = {}) => {
    const order = ok(await call(server, 'POST', '/v1/purchasing/orders', { tenant: b.tenant, body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: supplier, orderDate: '2025-04-10', lines: [{ itemId: o.itemId ?? b.item.widget, quantity: o.quantity ?? '10', unitPrice: o.price ?? '500', discountPercent: o.discount ?? '0', warehouseId: b.wh }] } }));
    const receipt = ok(await call(server, 'POST', '/v1/purchasing/receipts', { tenant: b.tenant, body: { companyId: b.companyId, purchaseOrderId: order.id, receiptDate: '2025-04-12', lines: [{ orderLineId: order.lines[0].id, quantity: o.quantity ?? '10' }] } }));
    return { order, receipt, grnLine: receipt.lines[0].id as string, poLine: order.lines[0].id as string };
  };
  const bill = (b: Buyer, supplier: string, lines: object[], o: object = {}, token?: string) =>
    call(server, 'POST', '/v1/purchasing/bills', { ...(token ? { token } : { tenant: b.tenant }), body: { companyId: b.companyId, gstRegistrationId: b.regId, supplierId: supplier, supplierInvoiceNo: `SI-${++invoiceSeq}`, supplierInvoiceDate: '2025-04-14', billDate: '2025-04-15', lines, ...o } });
  const bl = (grnLine: string, o: object = {}) => ({ grnLineId: grnLine, quantity: '10', unitPrice: '500', ...o });
  const withItem = (b: Buyer, line: object) => ({ itemId: b.item.widget, ...line });
  /** One call: receive 10 widgets at 500 and bill them (5,900 with 18% GST intra-state). */
  const billed = async (b: Buyer, supplier: string, o: { billDate?: string; quantity?: string } = {}) => {
    const g = await ordered(b, supplier, o.quantity ? { quantity: o.quantity } : {});
    return ok(await bill(b, supplier, [withItem(b, bl(g.grnLine, o.quantity ? { quantity: o.quantity } : {}))], o.billDate ? { billDate: o.billDate, supplierInvoiceDate: o.billDate } : {}));
  };
  const key = async (b: Buyer, permissions: string[]) => (await call(server, 'POST', '/v1/api-keys', { tenant: b.tenant, body: { name: 'k', permissions } })).json.key as string;
  return { buyer, net, ordered, bill, bl, withItem, billed, key };
}
