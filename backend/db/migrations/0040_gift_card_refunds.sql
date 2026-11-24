-- A return can be refunded onto a gift card: the refund is paid from the gift card liability account.
ALTER TABLE erp.customer_refunds DROP CONSTRAINT customer_refunds_method_valid;
ALTER TABLE erp.customer_refunds ADD CONSTRAINT customer_refunds_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other', 'gift_card'));
