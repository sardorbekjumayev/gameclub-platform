-- VIP / ochiq vaqt: operator klubda sessiyani tugash vaqtisiz ochadi, mijoz o'ynab bo'lgach haqiqiy vaqt bo'yicha to'laydi.
-- Ochiq sessiya qurilmani operator yopguncha band qiladi (booking_items oralig'i + sessions.expected_end_at IS NULL).
-- must_end_by: shu qurilmada oldindan qilingan keyingi bron bo'lsa — sessiya shu vaqtgacha yakunlanishi kerak.
ALTER TABLE "sessions"
  ADD COLUMN "is_open" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "must_end_by" TIMESTAMPTZ;

CREATE INDEX "sessions_open_must_end_by_idx" ON "sessions"("must_end_by") WHERE "is_open" AND "status" IN ('ACTIVE', 'PAUSED');
