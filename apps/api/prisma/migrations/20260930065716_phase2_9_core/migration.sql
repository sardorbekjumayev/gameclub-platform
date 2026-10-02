-- CreateTable
CREATE TABLE "clubs" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "cover_url" TEXT,
    "description" TEXT,
    "phone" TEXT,
    "telegram" TEXT,
    "instagram" TEXT,
    "website" TEXT,
    "rules" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_booking_minutes" INTEGER NOT NULL DEFAULT 60,
    "cancellation_policy" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejection_reason" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "suspended_reason" TEXT,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "commission_bps" INTEGER,
    "settings" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_documents" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "address_details" JSONB,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "phone" TEXT,
    "description" TEXT,
    "cover_url" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "working_hours" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "booking_settings" JSONB,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_hours_exceptions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT true,
    "open_time" TEXT,
    "close_time" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branch_hours_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "capacity" INTEGER,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID,
    "role_id" UUID NOT NULL,
    "phone_or_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_categories" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "device_type" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "device_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "room_id" UUID,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "specs" JSONB,
    "operational_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "connectivity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "last_heartbeat_at" TIMESTAMPTZ,
    "agent_id" TEXT,
    "position_order" INTEGER NOT NULL DEFAULT 0,
    "layout" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_maintenance" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "started_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "device_type" TEXT,
    "category_id" UUID,
    "room_id" UUID,
    "device_id" UUID,
    "price_per_hour" BIGINT NOT NULL,
    "min_minutes" INTEGER,
    "max_minutes" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" DATE,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_rules" (
    "id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "days_of_week" SMALLINT[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "price_per_hour" BIGINT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STANDARD',
    "date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tariff_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "club_id" UUID,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "max_discount_amount" BIGINT,
    "min_order_amount" BIGINT,
    "usage_limit" INTEGER,
    "per_user_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "applies_to" JSONB,
    "funded_by" TEXT NOT NULL DEFAULT 'CLUB',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "user_id" UUID,
    "booking_id" UUID NOT NULL,
    "discount_amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customer_id" UUID,
    "guest_name" TEXT,
    "guest_phone" TEXT,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "subtotal_amount" BIGINT NOT NULL,
    "discount_amount" BIGINT NOT NULL DEFAULT 0,
    "total_amount" BIGINT NOT NULL,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "promotion_id" UUID,
    "hold_expires_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "cancellation_reason" TEXT,
    "refund_amount" BIGINT,
    "checked_in_at" TIMESTAMPTZ,
    "checked_in_by" UUID,
    "no_show_marked_at" TIMESTAMPTZ,
    "rescheduled_from_id" UUID,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "idempotency_key" TEXT,
    "price_snapshot" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "category_id" UUID,
    "requested_category_id" UUID,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "blocked_until" TIMESTAMPTZ NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "price_amount" BIGINT NOT NULL,
    "tariff_id" UUID,
    "price_breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "data" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "booking_id" UUID,
    "booking_item_id" UUID,
    "device_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ,
    "expected_end_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "paused_at" TIMESTAMPTZ,
    "total_paused_seconds" INTEGER NOT NULL DEFAULT 0,
    "started_by" UUID,
    "ended_by" UUID,
    "end_reason" TEXT,
    "overtime_minutes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_charges" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "minutes" INTEGER,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "payment_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID,
    "session_id" UUID,
    "user_id" UUID,
    "club_id" UUID NOT NULL,
    "branch_id" UUID,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "method" TEXT NOT NULL,
    "provider" TEXT,
    "provider_transaction_id" TEXT,
    "provider_payload" JSONB,
    "status" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "failed_reason" TEXT,
    "received_by" UUID,
    "shift_id" UUID,
    "idempotency_key" TEXT,
    "commission_bps" INTEGER,
    "commission_amount" BIGINT,
    "club_amount" BIGINT,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payment_id" UUID,
    "raw" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT true,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "booking_id" UUID,
    "club_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "initiated_by" UUID,
    "policy_snapshot" JSONB,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "account_id" UUID,
    "direction" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "opening_cash" BIGINT NOT NULL,
    "closing_cash_counted" BIGINT,
    "expected_cash" BIGINT,
    "difference" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "reply_text" TEXT,
    "replied_at" TIMESTAMPTZ,
    "reported_count" INTEGER NOT NULL DEFAULT 0,
    "moderated_by" UUID,
    "moderation_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "club_id" UUID,
    "booking_id" UUID,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "read_at" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "club_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_per_month" BIGINT NOT NULL,
    "limits" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "current_period_start" TIMESTAMPTZ NOT NULL,
    "current_period_end" TIMESTAMPTZ NOT NULL,
    "cancel_at" TIMESTAMPTZ,
    "trial_ends_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_payouts" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ NOT NULL,
    "period_end" TIMESTAMPTZ NOT NULL,
    "gross_amount" BIGINT NOT NULL,
    "commission_amount" BIGINT NOT NULL,
    "refunds_amount" BIGINT NOT NULL,
    "net_amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ,
    "reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE INDEX "club_documents_club_id_idx" ON "club_documents"("club_id");

-- CreateIndex
CREATE INDEX "branches_club_id_idx" ON "branches"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_club_id_slug_key" ON "branches"("club_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "branch_hours_exceptions_branch_id_date_key" ON "branch_hours_exceptions"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "amenities_code_key" ON "amenities"("code");

-- CreateIndex
CREATE INDEX "rooms_branch_id_idx" ON "rooms"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invitations_club_id_idx" ON "staff_invitations"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_notes_club_id_user_id_key" ON "customer_notes"("club_id", "user_id");

-- CreateIndex
CREATE INDEX "device_categories_club_id_idx" ON "device_categories"("club_id");

-- CreateIndex
CREATE INDEX "devices_branch_id_idx" ON "devices"("branch_id");

-- CreateIndex
CREATE INDEX "tariffs_branch_id_idx" ON "tariffs"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotion_id_booking_id_key" ON "promotion_redemptions"("promotion_id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_branch_id_start_at_idx" ON "bookings"("branch_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_customer_id_start_at_idx" ON "bookings"("customer_id", "start_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_branch_id_status_start_at_idx" ON "bookings"("branch_id", "status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_customer_id_idempotency_key_key" ON "bookings"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "booking_items_device_id_idx" ON "booking_items"("device_id");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_at_idx" ON "booking_events"("booking_id", "at");

-- CreateIndex
CREATE INDEX "sessions_branch_id_status_idx" ON "sessions"("branch_id", "status");

-- CreateIndex
CREATE INDEX "payments_club_id_paid_at_idx" ON "payments"("club_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_account_id_created_at_idx" ON "ledger_entries"("account", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "cash_shifts_branch_id_status_idx" ON "cash_shifts"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_branch_id_created_at_idx" ON "reviews"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_club_id_idx" ON "subscriptions"("club_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- AddForeignKey
ALTER TABLE "club_documents" ADD CONSTRAINT "club_documents_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_hours_exceptions" ADD CONSTRAINT "branch_hours_exceptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "device_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_maintenance" ADD CONSTRAINT "device_maintenance_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_rules" ADD CONSTRAINT "tariff_rules_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_charges" ADD CONSTRAINT "session_charges_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Raw SQL (Prisma qo'llamaydi): docs/02-DATABASE.md §4 =====
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Filial joylashuvi: geography nuqta latitude/longitude'dan avtomatik (lng, lat tartibi!)
ALTER TABLE "branches" ADD COLUMN location geography(Point,4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;
CREATE INDEX branches_location_gix ON "branches" USING gist (location);
CREATE INDEX branches_name_trgm ON "branches" USING gin (name gin_trgm_ops);
CREATE INDEX branches_address_trgm ON "branches" USING gin (address gin_trgm_ops);
CREATE INDEX clubs_name_trgm ON "clubs" USING gin (name gin_trgm_ops);
CREATE UNIQUE INDEX devices_branch_name_uq ON "devices" (branch_id, name) WHERE deleted_at IS NULL;

-- Double-booking himoyasi (§4.1)
ALTER TABLE "booking_items" ADD COLUMN time_range tstzrange
  GENERATED ALWAYS AS (tstzrange(start_at, blocked_until, '[)')) STORED;
ALTER TABLE "booking_items" ADD CONSTRAINT booking_items_no_overlap
  EXCLUDE USING gist (device_id WITH =, time_range WITH &&) WHERE (active);

-- Bitta qurilmada bitta faol sessiya (§4.2)
CREATE UNIQUE INDEX sessions_one_live_per_device ON "sessions" (device_id) WHERE status IN ('WAITING','ACTIVE','PAUSED');
CREATE UNIQUE INDEX payments_provider_tx_uq ON "payments" (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX cash_shifts_one_open_per_operator ON "cash_shifts" (operator_id) WHERE status = 'OPEN';

-- Enum CHECK'lar (§2)
ALTER TABLE "clubs" ADD CONSTRAINT clubs_status_chk CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','SUSPENDED','REJECTED','CLOSED'));
ALTER TABLE "branches" ADD CONSTRAINT branches_status_chk CHECK (status IN ('ACTIVE','INACTIVE','TEMPORARILY_CLOSED'));
ALTER TABLE "branches" ADD CONSTRAINT branches_coords_chk CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "rooms" ADD CONSTRAINT rooms_status_chk CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE "devices" ADD CONSTRAINT devices_type_chk CHECK (type IN ('PC','PS5','PS4','XBOX','RACING_SIMULATOR','OTHER'));
ALTER TABLE "devices" ADD CONSTRAINT devices_opstatus_chk CHECK (operational_status IN ('ACTIVE','MAINTENANCE','DISABLED'));
ALTER TABLE "device_maintenance" ADD CONSTRAINT maintenance_status_chk CHECK (status IN ('OPEN','IN_PROGRESS','DONE'));
ALTER TABLE "tariffs" ADD CONSTRAINT tariffs_price_chk CHECK (price_per_hour >= 0);
ALTER TABLE "tariff_rules" ADD CONSTRAINT tariff_rules_price_chk CHECK (price_per_hour >= 0);
ALTER TABLE "promotions" ADD CONSTRAINT promotions_type_chk CHECK (type IN ('PERCENT','FIXED'));
ALTER TABLE "bookings" ADD CONSTRAINT bookings_status_chk CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED','CANCELLED','EXPIRED','NO_SHOW'));
ALTER TABLE "bookings" ADD CONSTRAINT bookings_source_chk CHECK (source IN ('APP','WEB','WALK_IN','PHONE'));
ALTER TABLE "bookings" ADD CONSTRAINT bookings_paystatus_chk CHECK (payment_status IN ('UNPAID','PARTIAL','PAID','REFUNDED','PARTIALLY_REFUNDED'));
ALTER TABLE "bookings" ADD CONSTRAINT bookings_range_chk CHECK (end_at > start_at);
ALTER TABLE "bookings" ADD CONSTRAINT bookings_total_chk CHECK (total_amount = subtotal_amount - discount_amount);
ALTER TABLE "bookings" ADD CONSTRAINT bookings_paid_chk CHECK (paid_amount >= 0);
ALTER TABLE "booking_items" ADD CONSTRAINT booking_items_range_chk CHECK (end_at > start_at AND blocked_until >= end_at);
ALTER TABLE "sessions" ADD CONSTRAINT sessions_status_chk CHECK (status IN ('WAITING','ACTIVE','PAUSED','COMPLETED','CANCELLED'));
ALTER TABLE "session_charges" ADD CONSTRAINT session_charges_type_chk CHECK (type IN ('EXTENSION','OVERTIME','ADJUSTMENT','PRODUCT'));
ALTER TABLE "payments" ADD CONSTRAINT payments_status_chk CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED'));
ALTER TABLE "payments" ADD CONSTRAINT payments_method_chk CHECK (method IN ('ONLINE_CARD','WALLET','CASH','TERMINAL'));
ALTER TABLE "payments" ADD CONSTRAINT payments_amount_chk CHECK (amount > 0);
ALTER TABLE "refunds" ADD CONSTRAINT refunds_status_chk CHECK (status IN ('PENDING','COMPLETED','FAILED'));
ALTER TABLE "ledger_entries" ADD CONSTRAINT ledger_dir_chk CHECK (direction IN ('DEBIT','CREDIT'));
ALTER TABLE "cash_shifts" ADD CONSTRAINT cash_shifts_status_chk CHECK (status IN ('OPEN','CLOSED'));
ALTER TABLE "reviews" ADD CONSTRAINT reviews_rating_chk CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "reviews" ADD CONSTRAINT reviews_status_chk CHECK (status IN ('VISIBLE','HIDDEN','PENDING_MODERATION'));
ALTER TABLE "support_tickets" ADD CONSTRAINT tickets_status_chk CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'));
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_status_chk CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED'));

-- Moliya yozuvlari o'zgarmas (faqat INSERT)
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
