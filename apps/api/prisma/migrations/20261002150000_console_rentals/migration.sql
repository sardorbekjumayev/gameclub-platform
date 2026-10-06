-- Konsol arendasi (PS5/PS4/Xbox va h.k.): klub o'z qurilmasini mijozga uyga soatlik yoki kunlik beradi.
CREATE TABLE "rental_items" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "includes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "games" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price_per_hour" BIGINT,
    "price_per_day" BIGINT,
    "min_hours" INTEGER NOT NULL DEFAULT 1,
    "max_days" INTEGER NOT NULL DEFAULT 30,
    "deposit_amount" BIGINT NOT NULL DEFAULT 0,
    "delivery_available" BOOLEAN NOT NULL DEFAULT false,
    "delivery_fee" BIGINT NOT NULL DEFAULT 0,
    "requirements" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    CONSTRAINT "rental_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_items_branch_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "rental_items_branch_id_idx" ON "rental_items"("branch_id");
CREATE INDEX "rental_items_club_id_idx" ON "rental_items"("club_id");
ALTER TABLE "rental_items" ADD CONSTRAINT rental_items_type_chk CHECK (type IN ('PS5','PS4','XBOX','NINTENDO_SWITCH','VR','OTHER'));
ALTER TABLE "rental_items" ADD CONSTRAINT rental_items_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "rental_items" ADD CONSTRAINT rental_items_price_chk CHECK (
  (price_per_hour IS NOT NULL OR price_per_day IS NOT NULL)
  AND coalesce(price_per_hour, 0) >= 0 AND coalesce(price_per_day, 0) >= 0
  AND deposit_amount >= 0 AND delivery_fee >= 0
);
ALTER TABLE "rental_items" ADD CONSTRAINT rental_items_limits_chk CHECK (quantity >= 1 AND min_hours >= 1 AND max_days >= 1);

CREATE TABLE "rentals" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contact_phone" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rate_unit" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "subtotal_amount" BIGINT NOT NULL,
    "delivery_fee_amount" BIGINT NOT NULL DEFAULT 0,
    "late_fee_amount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL,
    "deposit_amount" BIGINT NOT NULL DEFAULT 0,
    "deposit_status" TEXT NOT NULL DEFAULT 'NONE',
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "status" TEXT NOT NULL,
    "fulfillment" TEXT NOT NULL DEFAULT 'PICKUP',
    "delivery_address" TEXT,
    "notes" TEXT,
    "item_snapshot" JSONB NOT NULL,
    "idempotency_key" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by" UUID,
    "handed_over_at" TIMESTAMPTZ,
    "handed_over_by" UUID,
    "returned_at" TIMESTAMPTZ,
    "returned_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rentals_item_fkey" FOREIGN KEY ("item_id") REFERENCES "rental_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rentals_code_key" ON "rentals"("code");
CREATE UNIQUE INDEX "rentals_customer_id_idempotency_key_key" ON "rentals"("customer_id", "idempotency_key");
CREATE INDEX "rentals_item_id_start_at_idx" ON "rentals"("item_id", "start_at");
CREATE INDEX "rentals_branch_id_status_start_at_idx" ON "rentals"("branch_id", "status", "start_at");
CREATE INDEX "rentals_customer_id_created_at_idx" ON "rentals"("customer_id", "created_at" DESC);
ALTER TABLE "rentals" ADD CONSTRAINT rentals_status_chk CHECK (status IN ('REQUESTED','CONFIRMED','ACTIVE','RETURNED','CANCELLED','REJECTED','EXPIRED'));
ALTER TABLE "rentals" ADD CONSTRAINT rentals_unit_chk CHECK (rate_unit IN ('HOUR','DAY') AND units >= 1 AND quantity >= 1);
ALTER TABLE "rentals" ADD CONSTRAINT rentals_fulfillment_chk CHECK (fulfillment IN ('PICKUP','DELIVERY'));
ALTER TABLE "rentals" ADD CONSTRAINT rentals_deposit_chk CHECK (deposit_status IN ('NONE','HELD','RETURNED','KEPT'));
ALTER TABLE "rentals" ADD CONSTRAINT rentals_paystatus_chk CHECK (payment_status IN ('UNPAID','PARTIAL','PAID','REFUNDED','PARTIALLY_REFUNDED'));
ALTER TABLE "rentals" ADD CONSTRAINT rentals_range_chk CHECK (end_at > start_at);
ALTER TABLE "rentals" ADD CONSTRAINT rentals_total_chk CHECK (total_amount = subtotal_amount + delivery_fee_amount + late_fee_amount AND paid_amount >= 0);

-- To'lov arendaga ham bog'lanadi (topshirishda naqd/terminal/o'tkazma)
ALTER TABLE "payments" ADD COLUMN "rental_id" UUID;
CREATE INDEX "payments_rental_id_idx" ON "payments"("rental_id");
