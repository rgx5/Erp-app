# Industry packs

One engine, many trades. The billing, stock, GST, returns, loyalty and reports engine is the same for everyone; an
**industry pack** changes what the business *calls* things and what it starts with. Choosing a pack at onboarding
(or in *Settings → Industry*) never changes how money is calculated.

| Pack | Item → | Customer → | Defaults worth knowing |
| --- | --- | --- | --- |
| Clothing & Textile (`apparel`) | Item | Customer | The reference product's categories, verbatim; size × colour variants; fabric by the metre; price-slab GST (5% / 18%) |
| Grocery & Kirana (`grocery`) | Product | Customer | Loose goods by the kilo in 0.25 kg steps; per-item GST 0 / 5 / 12 / 18%; pack-size variants |
| Pharmacy & Medical (`pharmacy`) | Medicine | Patient | Strip / bottle / tube units; composition and schedule on each item; 12% default GST |
| Electronics & Mobiles (`electronics`) | Product | Customer | Storage × colour variants; repair & service items that never touch stock; model + warranty attributes; 18% |
| Restaurant & Café (`restaurant`) | Dish (menu) | Guest | Half / Full portions as options; made-to-order, no stock counting; **tax-exclusive** pricing with 5% GST added on top |
| Salon, Spa & Services (`salon`) | Service | Client | Services never touch stock, retail products do; stylist-wise sales and discount report; 18% |
| Hardware & Building (`hardware`) | Product | Customer | Sell by metre, kilo, litre, bag or piece; cut-to-length in 0.5 m steps; HSN summary on invoices; 18% |
| General Store & Wholesale (`general`) | Product | Customer | Blank-slate retail defaults; also the fallback for an unknown pack id |

## What a pack contains

`src/industries/types.ts` is the contract. In short:

* `labels` — `item/items`, `customer/customers`, the two option axes (`option1` "Size" / `option2` "Colour"), two
  optional extra attributes (`attr1`, `attr2`, `null` hides them), `sale/sales/newSale`, `staff`, `price`.
  Screens read these through `useLabels()`; no screen hard-codes "Item" or "Customer".
* `tax` — GST `slabs` (price → rate), whether prices are `inclusive`, an HSN hint and a default HSN.
* `categories` + `groupOrder` — categories with a `CategoryConfig` (unit, fractional, step, min qty, `variantMode`
  `sizes | plain`, `optionLabel`, SKU `prefix`, HSN, flat `gstRate`, `trackStock`, `noDiscount`, `reorderLevel`).
  Creating an item in a category copies these rules onto it, so editing the category later never changes old items.
* `settings` — starting store settings (return policy, footer, loyalty, discount cap, return window…).
* `expenseCategories`, `stockReasons`, `returnReasons` — the dropdown vocabularies.
* `highlights` / `caveat` — honest copy for the picker (what it is good at, what it is not).
* `demo` — a sample business: items, suppliers, traffic, payment mix, trading hours, recurring expenses.

## The demo workspace is real

*Explore a demo* on the welcome screen does not load canned screenshots. `src/data/demo.ts` creates the business and then
**runs the real ops** — purchases, 45 days of bills with the pack's traffic and payment mix, returns, expenses, day
open/close — with a deterministic seeded RNG. Everything the demo shows was produced by the same code that runs in
production, and `src/data/__tests__/demo.test.ts` asserts the invariants (stock never negative, ledger matches
on-hand, every bill's maths reconciles) for all eight packs.

## Adding an industry

1. Copy `src/industries/general.ts` to `src/industries/<id>.ts` and edit it. Keep ids unique (`cat_<pack>_…`).
2. Export it from `src/industries/index.ts` (add to `INDUSTRIES`).
3. If it needs a new glyph, add the icon to `PackIcon` in `types.ts`, `src/ui/icons.ts` and `src/features/packIcons.tsx`.
4. Run `npm test`. `demo.test.ts` iterates `INDUSTRIES`, so your demo data is validated automatically.

Guidance for good packs:

* Prefer **`variantMode: 'plain'` + `optionLabel`** for single-axis choices (portions, strengths, shades).
* Mark made-to-order and service categories `trackStock: false` — the engine will never check or deduct stock for them.
* Use flat `gstRate` for goods with a fixed rate; leave it unset to use the price slabs.
* Set `fractional: true` (or a fractional `unit`) for goods sold by weight, volume or length; `step` controls the ± buttons.
* Keep demo prices tax-inclusive when the pack's `tax.inclusive` is true — they are what the customer pays.

## What is deliberately *not* in a pack (yet)

Batch / expiry (pharmacy), IMEI / serial numbers (electronics), tables and kitchen tickets (restaurant), appointments
(salon). They are product features, not vocabulary, and are listed in [ROADMAP.md](./ROADMAP.md). Each pack's
`caveat` says so plainly rather than pretending.
