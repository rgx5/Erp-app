import { createHash } from 'node:crypto';

export interface Issue { field: string; message: string; blocking: boolean }
export interface PartyIn { gstin: string | null; legalName: string; tradeName: string | null; address1: string | null; address2: string | null; city: string | null; pincode: string | null; stateCode: string | null }
export interface LineIn {
  lineNo: number; description: string; hsn: string | null; isService: boolean; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean; taxableValue: string;
  igstRate: string; cgstRate: string; sgstRate: string; cessRate: string; igstAmount: string; cgstAmount: string; sgstAmount: string; cessAmount: string; lineTotal: string; uqc: string | null; unitCode: string;
}
export type DocType = 'tax_invoice' | 'bill_of_supply' | 'credit_note' | 'debit_note';
export interface InvoiceIn {
  invoiceNo: string; documentType: DocType; invoiceDate: string; status: string; supplyType: string; taxPayment: string | null; reverseCharge: boolean; placeOfSupply: string;
  taxableTotal: string; cgstTotal: string; sgstTotal: string; igstTotal: string; cessTotal: string; roundOff: string; grandTotal: string;
  original: { invoiceNo: string; invoiceDate: string } | null; lines: LineIn[];
}

const n2 = (v: string | number): number => Math.round(Number(v) * 100) / 100;
const n3 = (v: number): number => Math.round(v * 1000) / 1000;
const dmy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The unit quantity codes the GST portals accept. */
export const UQC = new Set(['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'FTS', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLS', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS']);
const UQC_ALIASES: Record<string, string> = { KG: 'KGS', KGM: 'KGS', G: 'GMS', GM: 'GMS', GMS: 'GMS', L: 'LTR', LT: 'LTR', M: 'MTR', MT: 'MTR', NO: 'NOS', NOS: 'NOS', EA: 'NOS', PAIR: 'PRS', PACK: 'PAC', PKT: 'PAC', CARTON: 'CTN', SQFT: 'SQF', SQMT: 'SQM', TONNE: 'TON', MTON: 'TON' };
export function uqcOf(uqc: string | null, unitCode: string): { code: string; guessed: boolean } {
  for (const c of [uqc, unitCode]) { const u = (c ?? '').trim().toUpperCase(); if (UQC.has(u)) return { code: u, guessed: false }; if (UQC_ALIASES[u]) return { code: UQC_ALIASES[u] as string, guessed: false }; }
  return { code: 'OTH', guessed: true };
}

/** The financial year a date falls in, as the portal writes it (2026-27). */
export function financialYear(iso: string): string {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const portalDocType = (t: DocType): 'INV' | 'CRN' | 'DBN' => (t === 'credit_note' ? 'CRN' : t === 'debit_note' ? 'DBN' : 'INV');

/** The 64-character invoice reference number: SHA-256 of seller GSTIN + financial year + document type + document number. The portal computes the same; a reply is matched back by it. */
export function computeIrn(sellerGstin: string, invoiceDate: string, type: DocType, invoiceNo: string): string {
  return createHash('sha256').update(`${sellerGstin}${financialYear(invoiceDate)}${portalDocType(type)}${invoiceNo}`).digest('hex');
}

const DOC_NO = /^[A-Z1-9a-z][0-9A-Za-z/-]{0,15}$/;
const addIf = (issues: Issue[], bad: boolean, field: string, message: string, blocking = true): void => { if (bad) issues.push({ field, message, blocking }); };

function checkParty(who: 'Seller' | 'Buyer', p: PartyIn, issues: Issue[], opts: { needGstin: boolean; foreign?: boolean }): void {
  const f = who.toLowerCase();
  if (opts.needGstin) addIf(issues, !/^[0-9]{2}[A-Z0-9]{13}$/.test(p.gstin ?? ''), `${f}.gstin`, `${who}'s GSTIN is missing or not 15 characters.`);
  addIf(issues, p.legalName.trim().length < 3 || p.legalName.length > 100, `${f}.legalName`, `${who}'s legal name must be 3 to 100 characters.`);
  addIf(issues, !(p.address1 ?? '').trim(), `${f}.address`, `${who}'s address is missing. Add it on the ${who === 'Seller' ? 'business location' : "customer's billing address"}.`);
  addIf(issues, (p.city ?? '').trim().length < 3, `${f}.city`, `${who}'s city or town must be at least 3 characters.`);
  if (!opts.foreign) addIf(issues, !/^[1-9][0-9]{5}$/.test(p.pincode ?? ''), `${f}.pincode`, `${who}'s 6-digit PIN code is missing.`);
  addIf(issues, !opts.foreign && !/^[0-9]{2}$/.test(p.stateCode ?? ''), `${f}.state`, `${who}'s state is missing.`);
}

/** What stops an invoice going to the e-invoice portal, and what is only worth a look. An empty blocking list means the file can be made. */
export function checkEInvoice(inv: InvoiceIn, seller: PartyIn, buyer: PartyIn, alreadyIssued: boolean): Issue[] {
  const issues: Issue[] = [];
  if (inv.documentType === 'bill_of_supply') { issues.push({ field: 'document', message: 'A bill of supply does not go on the e-invoice portal.', blocking: true }); return issues; }
  addIf(issues, inv.status !== 'posted', 'status', 'Only a posted invoice can be sent. This one was cancelled.');
  addIf(issues, alreadyIssued, 'irn', 'An IRN has already been recorded for this invoice.');
  if (!['b2b', 'sez', 'export'].includes(inv.supplyType)) { issues.push({ field: 'buyer', message: 'E-invoicing is for sales to registered businesses, SEZ units and exports. This is a sale to a consumer or an unregistered buyer.', blocking: true }); return issues; }
  const foreign = inv.supplyType === 'export';
  checkParty('Seller', seller, issues, { needGstin: true });
  checkParty('Buyer', buyer, issues, { needGstin: !foreign, foreign });
  addIf(issues, !DOC_NO.test(inv.invoiceNo) || /^0+$/.test(inv.invoiceNo), 'docNo', `The document number "${inv.invoiceNo}" is not accepted: up to 16 letters, digits, / or -, not starting with 0, / or -.`);
  addIf(issues, inv.invoiceDate < '2017-07-01', 'date', 'The date is before GST began.');
  addIf(issues, inv.invoiceDate > new Date().toISOString().slice(0, 10), 'date', 'The invoice date is in the future.');
  addIf(issues, inv.lines.length === 0 || inv.lines.length > 1000, 'items', 'An e-invoice needs between 1 and 1000 items.');
  for (const l of inv.lines) {
    addIf(issues, !/^[0-9]{4,8}$/.test(l.hsn ?? ''), `item${l.lineNo}.hsn`, `Item ${l.lineNo} (${l.description.slice(0, 30)}): HSN or SAC code of 4 to 8 digits is missing.`);
    if (uqcOf(l.uqc, l.unitCode).guessed) issues.push({ field: `item${l.lineNo}.unit`, message: `Item ${l.lineNo}: the unit "${l.unitCode}" is not a standard GST unit, so OTH (other) is used. Set a GST unit code on the unit to avoid this.`, blocking: false });
  }
  if (inv.documentType !== 'tax_invoice' && !inv.original) issues.push({ field: 'original', message: 'The original invoice is not recorded on this note; the portal asks for it.', blocking: false });
  return issues;
}

/** The invoice in the portal's JSON layout (version 1.1), ready for its bulk upload. Call checkEInvoice first. */
export function buildEInvoice(inv: InvoiceIn, seller: PartyIn, buyer: PartyIn): Record<string, unknown> {
  const foreign = inv.supplyType === 'export';
  const supTyp = inv.supplyType === 'sez' ? (inv.taxPayment === 'without_payment' ? 'SEZWOP' : 'SEZWP') : foreign ? (inv.taxPayment === 'without_payment' ? 'EXPWOP' : 'EXPWP') : 'B2B';
  const addr = (p: PartyIn) => ({ Addr1: (p.address1 ?? '').slice(0, 100), ...(p.address2 ? { Addr2: p.address2.slice(0, 100) } : {}), Loc: (p.city ?? '').slice(0, 50) });
  let disc = 0;
  const items = inv.lines.map((l, i) => {
    const qty = Number(l.quantity); const assAmt = n2(l.taxableValue); const d = Number(l.discountPercent) / 100;
    const gross = d > 0 && d < 1 ? n2(assAmt / (1 - d)) : assAmt;
    const discount = n2(gross - assAmt); disc += discount;
    const gstRt = Number(l.igstRate) > 0 ? Number(l.igstRate) : Number(l.cgstRate) + Number(l.sgstRate);
    return {
      SlNo: String(i + 1), PrdDesc: l.description.slice(0, 300), IsServc: l.isService ? 'Y' : 'N', HsnCd: l.hsn ?? '', Qty: n3(qty), Unit: uqcOf(l.uqc, l.unitCode).code,
      UnitPrice: n3(gross / qty), TotAmt: gross, Discount: discount, AssAmt: assAmt, GstRt: n2(gstRt), IgstAmt: n2(l.igstAmount), CgstAmt: n2(l.cgstAmount), SgstAmt: n2(l.sgstAmount),
      CesRt: n2(l.cessRate), CesAmt: n2(l.cessAmount), TotItemVal: n2(Number(l.taxableValue) + Number(l.igstAmount) + Number(l.cgstAmount) + Number(l.sgstAmount) + Number(l.cessAmount)),
    };
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: supTyp, RegRev: inv.reverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: portalDocType(inv.documentType), No: inv.invoiceNo, Dt: dmy(inv.invoiceDate) },
    SellerDtls: { Gstin: seller.gstin, LglNm: seller.legalName.slice(0, 100), ...(seller.tradeName ? { TrdNm: seller.tradeName.slice(0, 100) } : {}), ...addr(seller), Pin: Number(seller.pincode), Stcd: seller.stateCode },
    BuyerDtls: { Gstin: foreign ? 'URP' : buyer.gstin, LglNm: buyer.legalName.slice(0, 100), ...(buyer.tradeName ? { TrdNm: buyer.tradeName.slice(0, 100) } : {}), Pos: foreign ? '96' : inv.placeOfSupply, ...addr(buyer), Pin: foreign ? 999999 : Number(buyer.pincode), Stcd: foreign ? '96' : buyer.stateCode },
    ...(inv.original && inv.documentType !== 'tax_invoice' ? { PrecDocDtls: [{ InvNo: inv.original.invoiceNo, InvDt: dmy(inv.original.invoiceDate) }] } : {}),
    ItemList: items,
    ValDtls: { AssVal: n2(inv.taxableTotal), CgstVal: n2(inv.cgstTotal), SgstVal: n2(inv.sgstTotal), IgstVal: n2(inv.igstTotal), CesVal: n2(inv.cessTotal), Disc: n2(disc), RndOffAmt: n2(inv.roundOff), TotInvVal: n2(inv.grandTotal) },
  };
}

// ---- e-way bill ------------------------------------------------------------------------------------------------------------
export interface Transport { mode: 'road' | 'rail' | 'air' | 'ship'; distanceKm: number; vehicleNo?: string | undefined; vehicleType?: 'regular' | 'odc' | undefined; transporterId?: string | undefined; transporterName?: string | undefined; transDocNo?: string | undefined; transDocDate?: string | undefined }
const MODE: Record<Transport['mode'], number> = { road: 1, rail: 2, air: 3, ship: 4 };
const VEHICLE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

export function checkEway(inv: InvoiceIn, seller: PartyIn, buyer: PartyIn, t: Transport): Issue[] {
  const issues: Issue[] = [];
  addIf(issues, inv.status !== 'posted', 'status', 'Only a posted invoice can carry an e-way bill.');
  addIf(issues, inv.documentType === 'credit_note' || inv.documentType === 'debit_note', 'document', 'An e-way bill is raised for an invoice or bill of supply, not for a credit or debit note.');
  addIf(issues, !/^[0-9]{2}[A-Z0-9]{13}$/.test(seller.gstin ?? ''), 'seller.gstin', "Seller's GSTIN is missing.");
  addIf(issues, !(seller.address1 ?? '').trim() || !/^[1-9][0-9]{5}$/.test(seller.pincode ?? ''), 'seller.address', "Seller's address and PIN code are needed (set them on the business location).");
  addIf(issues, !(buyer.address1 ?? '').trim() || !/^[1-9][0-9]{5}$/.test(buyer.pincode ?? ''), 'buyer.address', "Buyer's address and PIN code are needed (set them on the customer's address).");
  addIf(issues, !Number.isInteger(t.distanceKm) || t.distanceKm < 1 || t.distanceKm > 4000, 'distance', 'Distance must be a whole number of kilometres from 1 to 4000.');
  if (t.mode === 'road') addIf(issues, !t.vehicleNo && !t.transporterId, 'vehicle', 'Give a vehicle number, or the transporter\'s GSTIN if the vehicle is not known yet.');
  else addIf(issues, !t.transDocNo || !t.transDocDate, 'transportDoc', 'Rail, air and ship movements need the transport document number and date.');
  addIf(issues, Boolean(t.vehicleNo) && !VEHICLE.test((t.vehicleNo ?? '').replace(/[\s-]/g, '').toUpperCase()), 'vehicle', 'The vehicle number looks wrong. Write it like MH12AB1234.');
  addIf(issues, Boolean(t.transporterId) && !/^[0-9]{2}[A-Z0-9]{13}$/.test(t.transporterId ?? ''), 'transporter', "The transporter's ID must be a 15-character GSTIN.");
  for (const l of inv.lines) addIf(issues, !/^[0-9]{4,8}$/.test(l.hsn ?? ''), `item${l.lineNo}.hsn`, `Item ${l.lineNo}: HSN code of 4 to 8 digits is missing.`);
  if (Number(inv.grandTotal) <= 50000) issues.push({ field: 'value', message: 'The goods value is ₹50,000 or less: an e-way bill is normally not required (except for some goods and for movements between states for job work). You can still make one.', blocking: false });
  return issues;
}

/** The bill in the e-way bill portal's bulk-upload layout. */
export function buildEway(inv: InvoiceIn, seller: PartyIn, buyer: PartyIn, t: Transport, shipTo?: PartyIn): Record<string, unknown> {
  const dest = shipTo ?? buyer;
  const bill: Record<string, unknown> = {
    userGstin: seller.gstin, supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: inv.documentType === 'bill_of_supply' ? 'BIL' : 'INV', docNo: inv.invoiceNo, docDate: dmy(inv.invoiceDate), transType: 1,
    fromGstin: seller.gstin, fromTrdName: (seller.tradeName ?? seller.legalName).slice(0, 100), fromAddr1: (seller.address1 ?? '').slice(0, 120), fromAddr2: (seller.address2 ?? '').slice(0, 120), fromPlace: (seller.city ?? '').slice(0, 50),
    fromPincode: Number(seller.pincode), fromStateCode: Number(seller.stateCode), actFromStateCode: Number(seller.stateCode),
    toGstin: buyer.gstin && inv.supplyType !== 'export' ? buyer.gstin : 'URP', toTrdName: (buyer.tradeName ?? buyer.legalName).slice(0, 100), toAddr1: (dest.address1 ?? '').slice(0, 120), toAddr2: (dest.address2 ?? '').slice(0, 120), toPlace: (dest.city ?? '').slice(0, 50),
    toPincode: Number(dest.pincode), toStateCode: Number(buyer.stateCode ?? dest.stateCode), actToStateCode: Number(dest.stateCode),
    totalValue: n2(inv.taxableTotal), cgstValue: n2(inv.cgstTotal), sgstValue: n2(inv.sgstTotal), igstValue: n2(inv.igstTotal), cessValue: n2(inv.cessTotal), cessNonAdvolValue: 0, otherValue: n2(inv.roundOff), totInvValue: n2(inv.grandTotal),
    transMode: MODE[t.mode], transDistance: String(t.distanceKm), vehicleType: t.vehicleType === 'odc' ? 'O' : 'R',
    ...(t.transporterId ? { transporterId: t.transporterId } : {}), ...(t.transporterName ? { transporterName: t.transporterName } : {}),
    ...(t.vehicleNo ? { vehicleNo: t.vehicleNo.replace(/[\s-]/g, '').toUpperCase() } : {}), ...(t.transDocNo ? { transDocNo: t.transDocNo } : {}), ...(t.transDocDate ? { transDocDate: dmy(t.transDocDate) } : {}),
    itemList: inv.lines.map((l) => ({
      productName: l.description.slice(0, 100), productDesc: l.description.slice(0, 100), hsnCode: Number(l.hsn), quantity: n3(Number(l.quantity)), qtyUnit: uqcOf(l.uqc, l.unitCode).code, taxableAmount: n2(l.taxableValue),
      sgstRate: n2(l.sgstRate), cgstRate: n2(l.cgstRate), igstRate: n2(l.igstRate), cessRate: n2(l.cessRate), cessNonAdvol: 0,
    })),
  };
  return { version: '1.0.0621', billLists: [bill] };
}
