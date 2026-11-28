-- Sales in a foreign currency. The ledger and GST stay in rupees: an export invoice is priced in the customer's currency, converted at a rate on the
-- invoice date, and booked in rupees. The currency, the rate and the amount the customer owes in their currency are kept on the invoice so that a
-- receipt in that currency can be settled against it and the difference (realised exchange gain or loss) posted.
ALTER TABLE erp.sales_invoices
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN foreign_total numeric(18,4);
ALTER TABLE erp.sales_invoices ADD CONSTRAINT sales_invoices_currency_valid CHECK (currency ~ '^[A-Z]{3}$' AND exchange_rate > 0 AND (currency = 'INR' OR foreign_total IS NOT NULL)) NOT VALID;

-- What a customer actually paid, in their currency, and the exchange gain (positive) or loss (negative) that settling invoices with it produced.
ALTER TABLE erp.customer_receipts
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN foreign_amount numeric(18,4),
  ADD COLUMN fx_amount numeric(18,4) NOT NULL DEFAULT 0;
