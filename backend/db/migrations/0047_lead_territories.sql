-- Who sees which leads: a person with only leads:read sees the leads they own or created, plus those in their territory.
ALTER TABLE erp.lead_settings ADD COLUMN territories jsonb NOT NULL DEFAULT '[]';
