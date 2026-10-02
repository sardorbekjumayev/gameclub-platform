-- Kunlik filial statistikasi (docs/01-API.md §6.17): tungi job to'ldiradi, og'ir hisobotlar shundan o'qiydi
CREATE TABLE "daily_branch_stats" (
    "branch_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "bookings_count" INTEGER NOT NULL DEFAULT 0,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "gmv" BIGINT NOT NULL DEFAULT 0,
    "collected" BIGINT NOT NULL DEFAULT 0,
    "refunds" BIGINT NOT NULL DEFAULT 0,
    "commission" BIGINT NOT NULL DEFAULT 0,
    "session_minutes" INTEGER NOT NULL DEFAULT 0,
    "unique_customers" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "daily_branch_stats_pkey" PRIMARY KEY ("branch_id", "date")
);
CREATE INDEX "daily_branch_stats_club_id_date_idx" ON "daily_branch_stats"("club_id", "date");
