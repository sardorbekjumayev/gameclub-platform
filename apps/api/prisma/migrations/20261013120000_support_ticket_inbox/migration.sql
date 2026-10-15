-- Murojaatlar (talab va taklif) — barcha rollardan super admin inbox'iga.
-- sender_role: yuborilgan paytdagi rol snapshot'i (CUSTOMER | CLUB_OWNER | CLUB_ADMIN | BRANCH_ADMIN | OPERATOR | SUPER_ADMIN | SUPPORT).
-- awaiting_reply: oxirgi xabar murojaat egasidan (platforma javobini kutmoqda).
ALTER TABLE "support_tickets"
  ADD COLUMN "sender_role" TEXT NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN "awaiting_reply" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "support_tickets" t SET
  "awaiting_reply" = NOT COALESCE(m.is_staff, false),
  "last_message_at" = COALESCE(m.created_at, t.created_at)
FROM (
  SELECT DISTINCT ON (ticket_id) ticket_id, is_staff, created_at
  FROM "support_messages" ORDER BY ticket_id, created_at DESC
) m
WHERE m.ticket_id = t.id;

CREATE INDEX "support_tickets_inbox_idx" ON "support_tickets"("status", "awaiting_reply", "last_message_at" DESC);
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");
