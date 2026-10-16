-- Klub egalarining ulanish arizalari (zonup.uz → "Klub ochish" formasi) — super admin paneliga.
CREATE TABLE "club_applications" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "club_name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "devices_count" INTEGER,
    "branches_count" INTEGER,
    "telegram" TEXT,
    "comment" TEXT,
    "language" TEXT NOT NULL DEFAULT 'uz',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "admin_note" TEXT,
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "club_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "club_applications_status_created_at_idx" ON "club_applications"("status", "created_at" DESC);
CREATE INDEX "club_applications_phone_idx" ON "club_applications"("phone");
