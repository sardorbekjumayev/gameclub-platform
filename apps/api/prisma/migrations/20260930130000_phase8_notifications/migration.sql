-- Phase 8: bildirishnoma sozlamalari va takror yuborishdan himoya (dedupe)
ALTER TABLE "users" ADD COLUMN "notification_prefs" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");
