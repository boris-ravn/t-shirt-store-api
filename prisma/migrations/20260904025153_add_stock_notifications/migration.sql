-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "low_stock_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "triggered_by_sku_id" UUID,
    "stock_at_trigger" INTEGER NOT NULL,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "low_stock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "low_stock_event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "low_stock_events_product_id_created_at_idx" ON "low_stock_events"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_notifications_low_stock_event_id_user_id_key" ON "stock_notifications"("low_stock_event_id", "user_id");

-- At most one open low-stock event per product (docs/database/README.md §7).
CREATE UNIQUE INDEX "low_stock_events_product_id_open_key" ON "low_stock_events"("product_id") WHERE "resolved_at" IS NULL;

-- AddForeignKey
ALTER TABLE "low_stock_events" ADD CONSTRAINT "low_stock_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_events" ADD CONSTRAINT "low_stock_events_triggered_by_sku_id_fkey" FOREIGN KEY ("triggered_by_sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_low_stock_event_id_fkey" FOREIGN KEY ("low_stock_event_id") REFERENCES "low_stock_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
