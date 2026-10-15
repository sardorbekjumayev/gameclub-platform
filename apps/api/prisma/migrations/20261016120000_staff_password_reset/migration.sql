-- Xodim parolini ierarxiya bo'yicha tiklash: vaqtinchalik parol bilan kirgan foydalanuvchi
-- keyingi kirishda yangi parol o'rnatishi shart.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- Yangi permission (catalog.ts bilan mos; seed ham qayta yaratadi — idempotent)
INSERT INTO "permissions" ("id", "code", "updated_at")
VALUES (gen_random_uuid(), 'staff.reset_password', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Default rollar: SUPER_ADMIN (hammasi), CLUB_OWNER (klubdagi hammasi), CLUB_ADMIN
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p."code" = 'staff.reset_password'
  AND r."code" IN ('SUPER_ADMIN', 'CLUB_OWNER', 'CLUB_ADMIN')
  AND r."club_id" IS NULL
ON CONFLICT DO NOTHING;
