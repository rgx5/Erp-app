-- The business's UPI address, so receipts and invoices can carry a pay-by-scanning QR code.
ALTER TABLE erp.retail_settings ADD COLUMN upi_id text;
ALTER TABLE erp.retail_settings ADD CONSTRAINT retail_settings_upi_valid CHECK (upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$');
