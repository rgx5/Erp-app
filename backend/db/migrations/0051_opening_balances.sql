-- Opening balances of customers and suppliers. A business moving from another program (or starting mid-year) owes and is owed money that was
-- booked before it started here. Each such balance is one document with no lines: an "opening balance" invoice for a customer who owes money, or an
-- opening bill for a supplier who is owed money. They behave like any invoice or bill for receipts, payments, ageing and statements, but they are
-- not sales or purchases: they post against the opening-balance equity account, carry no tax, and stay out of GST returns and the e-invoice list.
ALTER TABLE erp.sales_invoices DROP CONSTRAINT sales_invoices_type_valid;
ALTER TABLE erp.sales_invoices ADD CONSTRAINT sales_invoices_type_valid CHECK (document_type IN ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note', 'opening_balance')) NOT VALID;
ALTER TABLE erp.supplier_bills DROP CONSTRAINT supplier_bills_type_valid;
ALTER TABLE erp.supplier_bills ADD CONSTRAINT supplier_bills_type_valid CHECK (document_type IN ('bill', 'debit_note', 'opening_balance')) NOT VALID;

-- "A document equals the sum of its lines" does not apply to a balance brought forward, which has no lines (the header total is the whole of it).
CREATE OR REPLACE FUNCTION erp.check_sales_invoice_complete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s record;
BEGIN
  IF NEW.document_type = 'opening_balance' THEN
    IF NEW.taxable_total <> NEW.grand_total OR NEW.cgst_total <> 0 OR NEW.sgst_total <> 0 OR NEW.igst_total <> 0 OR NEW.cess_total <> 0 THEN
      RAISE EXCEPTION 'an opening balance carries no tax' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  SELECT count(*) AS n, COALESCE(sum(taxable_value), 0) AS t, COALESCE(sum(cgst_amount), 0) AS c, COALESCE(sum(sgst_amount), 0) AS sg,
         COALESCE(sum(igst_amount), 0) AS i, COALESCE(sum(cess_amount), 0) AS ce
    INTO s FROM erp.sales_invoice_lines WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.id;
  IF s.n = 0 OR s.t <> NEW.taxable_total OR s.c <> NEW.cgst_total OR s.sg <> NEW.sgst_total OR s.i <> NEW.igst_total OR s.ce <> NEW.cess_total THEN
    RAISE EXCEPTION 'sales document % does not equal the sum of its lines', NEW.invoice_no USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION erp.check_supplier_bill_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF NEW.document_type = 'opening_balance' THEN
    IF NEW.taxable_total <> NEW.grand_total OR NEW.cgst_total <> 0 OR NEW.sgst_total <> 0 OR NEW.igst_total <> 0 OR NEW.cess_total <> 0 OR NEW.itc_total <> 0 THEN
      RAISE EXCEPTION 'an opening balance carries no tax' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  SELECT count(*) AS n, COALESCE(sum(taxable_value), 0) AS t, COALESCE(sum(cgst_amount), 0) AS c, COALESCE(sum(sgst_amount), 0) AS sg,
         COALESCE(sum(igst_amount), 0) AS i, COALESCE(sum(cess_amount), 0) AS ce,
         COALESCE(sum(cgst_amount + sgst_amount + igst_amount + cess_amount) FILTER (WHERE itc_eligible), 0) AS itc
    INTO s FROM erp.supplier_bill_lines WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.id;
  IF s.n = 0 OR s.t <> NEW.taxable_total OR s.c <> NEW.cgst_total OR s.sg <> NEW.sgst_total OR s.i <> NEW.igst_total OR s.ce <> NEW.cess_total OR s.itc <> NEW.itc_total THEN
    RAISE EXCEPTION 'supplier bill % does not equal the sum of its lines', NEW.bill_no USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
