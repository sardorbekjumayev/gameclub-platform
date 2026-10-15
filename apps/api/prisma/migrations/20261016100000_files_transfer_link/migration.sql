-- O'z fayl saqlash joyimiz (STORAGE_DIR): metama'lumot shu jadvalda, fayl diskda (storage_key).
CREATE TABLE "files" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "club_id" UUID,
  "purpose" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_name" TEXT,
  "ref_type" TEXT,
  "ref_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");
CREATE INDEX "files_owner_id_purpose_idx" ON "files"("owner_id", "purpose");
CREATE INDEX "files_ref_type_ref_id_idx" ON "files"("ref_type", "ref_id");

-- Klub to'lov havolasi (Click/Payme/bank QR havolasi) — karta raqamiga muqobil; chek majburiyligi.
ALTER TABLE "clubs" ADD COLUMN "transfer_link_url" TEXT;
ALTER TABLE "clubs" ADD COLUMN "transfer_link_label" TEXT;
ALTER TABLE "clubs" ADD COLUMN "transfer_receipt_required" BOOLEAN NOT NULL DEFAULT false;
