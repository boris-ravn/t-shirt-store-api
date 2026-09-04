-- Closes two concurrent-request races the schema's own comments anticipated
-- but the migration hadn't closed yet (docs/decisions.md, 2026-09-04):
-- concurrent createPaymentIntent calls for the same order, and concurrent
-- first-time createPaymentLinkCheckout calls for the same sku.

-- At most one pending payment_intent-style payment in flight per order.
CREATE UNIQUE INDEX "payments_order_id_pending_key" ON "payments"("order_id") WHERE "status" = 'pending';

-- At most one active payment link per sku.
CREATE UNIQUE INDEX "payment_links_sku_id_active_key" ON "payment_links"("sku_id") WHERE "deactivated_at" IS NULL;
