-- A PIN code is no longer required on an Indian party address. Many customers are known only by name, town and state (and programs being moved
-- from, such as Vyapar, often hold no PIN code). A PIN code, when given, must still be valid, and a foreign address still has none. The e-invoice
-- file builder already reports a missing buyer PIN code, so the gap shows up where it matters.
ALTER TABLE erp.party_addresses DROP CONSTRAINT party_addresses_pincode_rule;
ALTER TABLE erp.party_addresses ADD CONSTRAINT party_addresses_pincode_rule CHECK ((country = 'IN' OR pincode IS NULL) AND (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$')) NOT VALID;
