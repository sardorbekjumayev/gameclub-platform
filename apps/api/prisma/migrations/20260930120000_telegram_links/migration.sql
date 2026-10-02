-- Telegram orqali OTP: telefon ↔ Telegram chat bog'lanishi
CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "tg_user_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "linked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_links_phone_key" ON "telegram_links"("phone");
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");
