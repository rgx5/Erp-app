-- Each business defines the extra details its leads carry (a solar installer asks for roof and bill; a school asks for the child's class).
ALTER TABLE erp.lead_settings ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]';
