-- Paket narxlar: qat'iy davomiylik + qat'iy narx (masalan, 3 soat — 30 000 so'm), tarifga tegishli.
-- days_of_week bo'sh — har kuni; start_time/end_time null — istalgan vaqt (kesib o'tuvchi oyna ruxsat).
CREATE TABLE "tariff_packages" (
    "id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price" BIGINT NOT NULL,
    "days_of_week" SMALLINT[] NOT NULL DEFAULT '{}',
    "start_time" TEXT,
    "end_time" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tariff_packages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tariff_packages_duration_check" CHECK ("duration_minutes" BETWEEN 30 AND 1440),
    CONSTRAINT "tariff_packages_price_check" CHECK ("price" >= 0),
    CONSTRAINT "tariff_packages_window_check" CHECK (("start_time" IS NULL) = ("end_time" IS NULL))
);

CREATE INDEX "tariff_packages_tariff_id_idx" ON "tariff_packages"("tariff_id");
CREATE INDEX "tariff_packages_branch_id_idx" ON "tariff_packages"("branch_id");

ALTER TABLE "tariff_packages" ADD CONSTRAINT "tariff_packages_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
