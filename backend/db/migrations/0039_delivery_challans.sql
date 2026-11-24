-- Delivery challans: a record that goods went out to a customer before they are invoiced. A challan is a sales order of its own kind:
-- it has its own number series, carries the vehicle and transporter, posts nothing, and is invoiced (in full or in parts) through the
-- normal invoice posting, which is where stock leaves and GST is charged.
ALTER TABLE erp.sales_orders ADD COLUMN kind text NOT NULL DEFAULT 'order';
ALTER TABLE erp.sales_orders ADD COLUMN vehicle_no text;
ALTER TABLE erp.sales_orders ADD COLUMN transporter text;
ALTER TABLE erp.sales_orders ADD CONSTRAINT sales_orders_kind_valid CHECK (kind IN ('order', 'challan'));
ALTER TABLE erp.sales_orders ADD CONSTRAINT sales_orders_challan_fields CHECK (kind = 'challan' OR (vehicle_no IS NULL AND transporter IS NULL));
ALTER TABLE erp.sales_orders ADD CONSTRAINT sales_orders_challan_no_hold CHECK (kind = 'order' OR reserve_stock = false);
