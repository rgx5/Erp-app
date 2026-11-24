-- How to reach a customer or supplier: a phone number (for WhatsApp and calls) and an email address.
ALTER TABLE erp.parties ADD COLUMN phone text;
ALTER TABLE erp.parties ADD COLUMN email text;
ALTER TABLE erp.parties ADD CONSTRAINT parties_phone_valid CHECK (phone IS NULL OR phone ~ '^[0-9+() -]{6,20}$');
ALTER TABLE erp.parties ADD CONSTRAINT parties_email_valid CHECK (email IS NULL OR (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
