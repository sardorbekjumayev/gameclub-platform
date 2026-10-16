# 02 — DATABASE (PostgreSQL 16 + PostGIS)

## 1. Umumiy qoidalar
- Extensionlar: `postgis`, `btree_gist`, `pg_trgm`, `citext`, `pgcrypto`.
- PK: `id uuid` (UUID v7, app generatsiya). Jadval nomlari `snake_case`, ko'plikda.
- Har jadvalda: `created_at timestamptz default now()`, `updated_at`. Biznes entitylarda `deleted_at` (soft delete). To'lov, ledger, audit — hech qachon o'chirilmaydi.
- Pul: `BIGINT` tiyin; ustun nomi `*_amount` yoki `*_price`. Valyuta `char(3)` default `'UZS'`.
- Vaqt: `timestamptz` (UTC). Filial vaqt zonasi `branches.timezone`.
- Enumlar: PostgreSQL enum emas, `text` + `CHECK` (o'zgartirish oson). Ro'yxatlar quyida.
- Multi-tenant: `club_id` ni tegishli jadvallarda denormalizatsiya qilib saqlash (tez scope filtr va RLS uchun).
- Migratsiya: Prisma migrate + `prisma/sql/*.sql` (raw: PostGIS, exclusion, trigger, index). Faqat oldinga.
- Ixtiyoriy himoya qatlami 🆕: Postgres Row Level Security `club_id = current_setting('app.club_id')` — API har so'rovda tranzaksiya boshida `SET LOCAL app.club_id`.

## 2. Enum qiymatlari

| Nom | Qiymatlar |
|---|---|
| user.status | ACTIVE, BLOCKED, DELETED, PENDING_VERIFICATION |
| user.type | CUSTOMER, STAFF, PLATFORM |
| club.status | DRAFT, PENDING_APPROVAL, ACTIVE, SUSPENDED, REJECTED, CLOSED |
| branch.status | ACTIVE, INACTIVE, TEMPORARILY_CLOSED |
| room.status | ACTIVE, INACTIVE |
| device.type | PC, PS5, PS4, XBOX, RACING_SIMULATOR, OTHER |
| device.operational_status | ACTIVE, MAINTENANCE, DISABLED |
| device.connectivity | UNKNOWN, ONLINE, OFFLINE (V2 agent) |
| occupancy (hisoblanadi, saqlanmaydi) | AVAILABLE, RESERVED, OCCUPIED, UNAVAILABLE |
| booking.status | PENDING_PAYMENT, CONFIRMED, CHECKED_IN, ACTIVE, COMPLETED, CANCELLED, EXPIRED, NO_SHOW |
| booking.source | APP, WEB, WALK_IN, PHONE |
| booking.payment_status | UNPAID, PARTIAL, PAID, REFUNDED, PARTIALLY_REFUNDED |
| rental_item.type | PS5, PS4, XBOX, NINTENDO_SWITCH, VR, OTHER |
| rental.status | REQUESTED, CONFIRMED, ACTIVE, RETURNED, CANCELLED, REJECTED, EXPIRED |
| rental.rate_unit / fulfillment / deposit_status | HOUR, DAY / PICKUP, DELIVERY / NONE, HELD, RETURNED, KEPT |
| session.status | WAITING, ACTIVE, PAUSED, COMPLETED, CANCELLED |
| session_charge.type | EXTENSION, OVERTIME, ADJUSTMENT, PRODUCT |
| payment.status | PENDING, PROCESSING, PAID, FAILED, REFUNDED, PARTIALLY_REFUNDED, CANCELLED |
| payment.method | ONLINE_CARD, WALLET, CASH, TERMINAL, CARD_TRANSFER |
| refund.status | PENDING, COMPLETED, FAILED |
| subscription.status | TRIALING, ACTIVE, PAST_DUE, CANCELLED, EXPIRED |
| plan.code | FREE, STARTER, PRO, ENTERPRISE |
| review.status | VISIBLE, HIDDEN, PENDING_MODERATION |
| notification.channel | PUSH, IN_APP, EMAIL, SMS, TELEGRAM |
| ticket.status | OPEN, IN_PROGRESS, RESOLVED, CLOSED |
| promo.type | PERCENT, FIXED |
| shift.status | OPEN, CLOSED |
| maintenance.status | OPEN, IN_PROGRESS, DONE |
| payout.status | PENDING, PROCESSING, PAID, FAILED |

## 3. Jadvallar

Ustun ro'yxatida `*` = NOT NULL. Standart ustunlar (`id`, `created_at`, `updated_at`) qayta yozilmaydi.

### 3.1 Identity va RBAC
**users**: `type*`, `phone* (unique, E.164)`, `phone_verified_at`, `email citext (unique, nullable)`, `email_verified_at`, `password_hash`, `must_change_password bool default false` 🆕, `first_name`, `last_name`, `avatar_file_id`, `language* default 'uz'`, `status*`, `last_login_at`, `no_show_count int default 0`, `booking_blocked_until`, `totp_secret_enc`, `totp_enabled bool`, `deleted_at`.
**roles**: `code* unique`, `name`, `scope_type* (PLATFORM|CLUB|BRANCH)`, `is_system bool`.
**permissions**: `code* unique` (masalan `devices.update`), `description`.
**role_permissions**: `role_id*`, `permission_id*` — PK (role_id, permission_id).
**user_roles**: `user_id*`, `role_id*`, `club_id`, `branch_id`, `granted_by`, `expires_at` — unique (user_id, role_id, club_id, branch_id). CHECK: scope_type ga mos club_id/branch_id to'ldirilgan.
**refresh_tokens**: `user_id*`, `family_id*`, `token_hash*`, `device_info jsonb`, `ip inet`, `expires_at*`, `revoked_at`, `replaced_by_id`, `reuse_detected_at`. Index: (user_id), (family_id), (token_hash).
**otp_requests** 🆕 (audit uchun; kodning o'zi Redis'da, hash): `phone*`, `purpose*`, `ip`, `status`, `attempts`, `expires_at`.
**staff_invitations** 🆕: `club_id*`, `branch_id`, `role_id*`, `phone_or_email*`, `token_hash*`, `invited_by*`, `expires_at*`, `accepted_at`, `status`.
**consents** 🆕: `user_id*`, `document_type* (TERMS|PRIVACY)`, `version*`, `accepted_at*`, `ip`.
**device_tokens** 🆕 (push): `user_id*`, `platform* (ios|android|web)`, `token* unique`, `app_version`, `locale`, `last_seen_at`, `disabled_at`.

### 3.2 Club, filial, xona
**clubs**: `owner_id*`, `name*`, `slug* unique`, `logo_file_id`, `description`, `phone`, `telegram`, `instagram`, `website`, `rules text`, `amenities text[]`, `min_booking_minutes int`, `cancellation_policy jsonb` (§5), `transfer_card_number`, `transfer_card_holder` (mijoz o'tkazadigan karta; faqat to'lanmagan bron egasiga ko'rsatiladi), `status*`, `rejection_reason`, `approved_by`, `approved_at`, `suspended_reason`, `rating_avg numeric(3,2)`, `rating_count int`, `settings jsonb` (booking qoidalari), `deleted_at`.
**club_documents** 🆕: `club_id*`, `type* (LICENSE|TAX_ID|PASSPORT|OTHER)`, `file_id*`, `status* (PENDING|APPROVED|REJECTED)`, `reviewed_by`, `note`.
**club_members**: `club_id*`, `user_id*`, `title` — xodimlar ro'yxati (ruxsatlar `user_roles` da).
**branches**: `club_id*`, `name*`, `slug*`, `address*`, `address_details jsonb`, `location geography(Point,4326)*`, `latitude`, `longitude` (yordamchi), `phone`, `description`, `timezone* default 'Asia/Tashkent'`, `working_hours jsonb*` (§5), `status*`, `booking_settings jsonb` (slot_minutes, buffer_minutes, min_advance_minutes, max_advance_days, hold_minutes, early_checkin_minutes, grace_minutes, allow_category_booking, allow_specific_device, auto_no_show, open_min_minutes, open_round_minutes), `rating_avg`, `rating_count`, `deleted_at`.
**branch_hours_exceptions** 🆕: `branch_id*`, `date*`, `is_closed bool`, `open_time`, `close_time`, `reason`.
**branch_images / files**: `files` jadvali orqali (§3.9), bog'lash `entity_type/entity_id/position`.
**amenities** 🆕 (katalog): `code* unique`, `name_i18n jsonb`, `icon`. Klub/filialda `amenities text[]` shu kodlarni saqlaydi.
**rooms**: `branch_id*`, `club_id*`, `name*`, `type`, `capacity`, `description`, `status*`, `position`, `deleted_at`.

### 3.3 Qurilmalar
**device_categories**: `club_id*`, `name*` (Standard, Premium, VIP), `device_type*`, `description`, `position`.
**devices**: `club_id*`, `branch_id*`, `room_id`, `category_id`, `name*` (PC-01), `type*`, `specs jsonb` (cpu, gpu, ram, monitor, refresh_rate, peripherals), `operational_status* default 'ACTIVE'`, `connectivity default 'UNKNOWN'`, `last_heartbeat_at`, `agent_id`, `position_order`, `layout jsonb` (x, y — zal sxemasi uchun 🆕), `deleted_at`. Unique (branch_id, name) where deleted_at is null.
**device_maintenance** 🆕: `device_id*`, `reported_by*`, `title*`, `description`, `status*`, `started_at`, `resolved_at`.

### 3.4 Tariflar
**tariffs**: `club_id*`, `branch_id*`, `name*`, `device_type`, `category_id`, `room_id`, `device_id` (aniq qurilma uchun), `price_per_hour*` (tiyin), `min_minutes`, `max_minutes`, `priority int default 0`, `is_active`, `valid_from date`, `valid_to date`, `deleted_at`.
**tariff_rules**: `tariff_id*`, `days_of_week smallint[]*` (1–7), `start_time*`, `end_time*` (kesib o'tuvchi, masalan 22:00–08:00, ruxsat), `price_per_hour*` (shu oyna narxi), `kind (STANDARD|WEEKEND|NIGHT|HOLIDAY)`, `date` (bayram uchun aniq sana).
**tariff_packages** 🆕 (2026-10-13): `tariff_id*` (FK, cascade), `club_id*`, `branch_id*` (scope), `name*` ("3 soat"), `duration_minutes*` (30–1440), `price*` (tiyin, butun paket narxi), `days_of_week smallint[] default {}` (bo'sh — har kuni), `start_time`, `end_time` (HH:mm, ikkalasi ham yoki hech biri; kesib o'tuvchi 22:00–08:00 ruxsat; null — istalgan vaqt), `is_active`, `position`, `deleted_at`. Index (tariff_id), (branch_id).
**promotions** 🆕: `club_id` (null = platforma promosi), `code` unique, `type*`, `value*`, `max_discount_amount`, `min_order_amount`, `usage_limit`, `per_user_limit`, `used_count`, `starts_at`, `ends_at`, `applies_to jsonb` (branch_ids, device_types, weekdays), `funded_by* (CLUB|PLATFORM)`, `is_active`.
**promotion_redemptions** 🆕: `promotion_id*`, `user_id*`, `booking_id*`, `discount_amount*`. Unique (promotion_id, booking_id).

### 3.5 Bron va sessiya
**bookings**: `code* unique` (GC-XXXXXX), `customer_id` (walk-in uchun null), `guest_name`, `guest_phone`, `club_id*`, `branch_id*`, `source*`, `status*`, `start_at*`, `end_at*`, `duration_minutes*`, `subtotal_amount*`, `discount_amount* default 0`, `total_amount*`, `paid_amount* default 0`, `payment_status*`, `promotion_id`, `hold_expires_at`, `cancelled_at`, `cancelled_by`, `cancellation_reason`, `refund_amount`, `checked_in_at`, `checked_in_by`, `no_show_marked_at`, `rescheduled_from_id` 🆕, `notes`, `idempotency_key`, `price_snapshot jsonb`. Index: (branch_id, start_at), (customer_id, start_at desc), (status, hold_expires_at) where status='PENDING_PAYMENT'. Unique (customer_id, idempotency_key).
**booking_items**: `booking_id*`, `club_id*`, `branch_id*`, `device_id*`, `category_id`, `requested_category_id`, `start_at*`, `end_at*`, `blocked_until*` (end_at + buffer), `time_range tstzrange GENERATED (tstzrange(start_at, blocked_until,'[)')) STORED`, `active bool*` (bron faol statusda bo'lsa true), `price_amount*`, `tariff_id`, `price_breakdown jsonb*`.
**sessions**: `club_id*`, `branch_id*`, `booking_id`, `booking_item_id`, `device_id*`, `customer_id`, `status*`, `started_at`, `expected_end_at`, `ended_at`, `paused_at`, `total_paused_seconds int default 0`, `started_by`, `ended_by`, `end_reason (COMPLETED|CANCELLED|FORCE_STOPPED|NO_PAYMENT)`, `overtime_minutes int`. Partial unique index: (device_id) where status in ('ACTIVE','PAUSED','WAITING') — bitta qurilmada bitta faol sessiya.
**session_charges** 🆕: `session_id*`, `type*`, `minutes`, `amount*`, `description`, `payment_id`, `created_by`.
**booking_events** 🆕 (timeline/audit bron): `booking_id*`, `type*`, `actor_id`, `data jsonb`, `at*`.
**waitlist_entries** 🆕 (V1.5): `user_id*`, `branch_id*`, `desired_start_at*`, `duration_minutes*`, `category_id`, `status`, `notified_at`.

### 3.6 To'lov va moliya
**payments**: `booking_id`, `session_id`, `rental_id`, `user_id`, `club_id*`, `branch_id`, `amount*`, `currency*`, `method*`, `provider (PAYME|CLICK|UZUM|MANUAL|...)`, `provider_transaction_id`, `provider_payload jsonb`, `status*`, `paid_at`, `failed_reason`, `received_by` (operator), `shift_id`, `idempotency_key`, `commission_bps int`, `commission_amount`, `club_amount`. Unique (provider, provider_transaction_id) where not null.
**payment_events** 🆕 (webhook logi): `provider*`, `event_id*`, `payment_id`, `raw jsonb`, `signature_valid bool`, `processed_at`. Unique (provider, event_id) — idempotentlik.
**refunds**: `payment_id*`, `booking_id`, `amount*`, `reason`, `status*`, `provider_refund_id`, `initiated_by`, `policy_snapshot jsonb`, `completed_at`.
**ledger_entries** 🆕: `account* (CUSTOMER|CLUB|PLATFORM|PROVIDER)`, `account_id`, `direction* (DEBIT|CREDIT)`, `amount*`, `currency`, `ref_type*`, `ref_id*`, `created_at*`. Faqat INSERT (immutable).
**platform_commissions**: `payment_id*`, `club_id*`, `rate_bps*`, `amount*`, `status`.
**club_payouts**: `club_id*`, `period_start`, `period_end`, `gross_amount`, `commission_amount`, `refunds_amount`, `net_amount`, `status*`, `paid_at`, `reference`.
**cash_shifts** 🆕: `branch_id*`, `operator_id*`, `opened_at*`, `closed_at`, `opening_cash*`, `closing_cash_counted`, `expected_cash`, `difference`, `status*`, `note`.
**wallets / wallet_transactions** (V2): `user_id`, `balance`, tranzaksiya yozuvlari.

### 3.7 Sharh, sevimli, qo'llab-quvvatlash
**reviews**: `user_id*`, `club_id*`, `branch_id*`, `booking_id* unique`, `rating* (1–5)`, `text`, `status*`, `reply_text` 🆕 (klub javobi), `replied_at`, `moderated_by`, `moderation_note`.
**review_images**: `review_id*`, `file_id*`.
**favorites**: `user_id*`, `branch_id*` (spetsda "club" deyilgan; xarita markerlari filial bo'lgani uchun filial saqlanadi 🆕) — PK (user_id, branch_id).
**support_tickets** 🆕: `user_id*`, `club_id`, `booking_id`, `type* (SUGGESTION|REQUEST|COMPLAINT|QUESTION|BUG|PAYMENT|OTHER)`, `subject`, `status*`, `assigned_to`, `priority`, `sender_role*` (yuborilgandagi rol), `awaiting_reply*` (oxirgi xabar egasidan), `last_message_at*`. Indeks: `(status, awaiting_reply, last_message_at desc)`.
**support_messages** 🆕: `ticket_id*`, `sender_id*`, `body*`, `attachments jsonb`.

### 3.8 Bildirishnoma, obuna, sozlamalar, audit
**notifications**: `user_id*`, `type*`, `title_i18n`, `body_i18n`, `data jsonb`, `channels text[]`, `read_at`, `sent_at`.
**notification_deliveries** 🆕: `notification_id*`, `channel*`, `status*`, `provider_message_id`, `error`, `sent_at`.
**notification_preferences** 🆕: `user_id*`, `type*`, `channel*`, `enabled*` — unique (user_id, type, channel).
**announcements** 🆕: `club_id` (null = platforma), `title_i18n`, `body_i18n`, `audience`, `starts_at`, `ends_at`.
**plans**: `code*`, `name`, `price_per_month`, `limits jsonb` (branches, devices, operators, analytics, online_booking, api_access, pc_agent).
**subscriptions**: `club_id*`, `plan_id*`, `status*`, `current_period_start/end`, `cancel_at`, `trial_ends_at`.
**subscription_invoices** 🆕: `subscription_id*`, `amount*`, `status`, `payment_id`, `period`.
**platform_settings**: `key* unique`, `value jsonb*`, `updated_by`. Misol kalitlar: `booking.hold_minutes`, `commission.default_bps`, `otp.ttl_seconds`, `app.min_version.android/ios`, `maintenance_mode`.
**feature_flags** 🆕: `key*`, `enabled`, `rules jsonb`.
**audit_logs**: `actor_id`, `actor_role`, `club_id`, `action*`, `target_type*`, `target_id`, `old_value jsonb`, `new_value jsonb`, `ip`, `user_agent`, `request_id`, `at*`. Faqat INSERT. Index (club_id, at desc), (actor_id, at desc), (target_type, target_id).
**outbox_events** 🆕: `aggregate_type*`, `aggregate_id*`, `event_type*`, `payload jsonb*`, `created_at`, `processed_at`, `attempts`.
**idempotency_keys** 🆕: `key*`, `user_id`, `route*`, `request_hash*`, `response_status`, `response_body jsonb`, `expires_at` — unique (key, user_id, route).

### 3.9 Fayllar
**files**: `owner_id`, `club_id`, `entity_type*`, `entity_id`, `kind* (IMAGE|DOCUMENT)`, `bucket`, `key*`, `mime*`, `size*`, `width`, `height`, `variants jsonb` (thumb/medium/large), `status* (UPLOADING|READY|REJECTED)`, `position`.

### 3.10 Manzillar
**addresses**: `region`, `district`, `city`, `street`, `house`, `landmark`, `postal_code`, `location geography`. (Filial `address_details` o'rniga ishlatilishi mumkin; MVP'da `branches.address` + koordinata yetarli.)

## 4. Muhim constraint va SQL

### 4.1 Double-booking'dan DB darajasida himoya
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE booking_items
  ADD CONSTRAINT booking_items_no_overlap
  EXCLUDE USING gist (device_id WITH =, time_range WITH &&)
  WHERE (active);
```
- `active = true` bo'ladi: bron statusi `PENDING_PAYMENT`, `CONFIRMED`, `CHECKED_IN`, `ACTIVE` bo'lganda. `CANCELLED`, `EXPIRED`, `NO_SHOW`, `COMPLETED` da `false` (bir tranzaksiyada yangilanadi).
- `time_range` `blocked_until` (end + buffer) gacha, shuning uchun buffer avtomatik hisobga olinadi.
- Muddati o'tgan hold constraint'ni "band" qilib turmasligi uchun bron yaratishda tranzaksiya boshida shu qurilma/oraliqdagi eski holdlar `EXPIRED` qilinadi (`01-API.md` §7.3).
- Constraint buzilsa Postgres `23P01` xatosi → API `BOOKING_SLOT_TAKEN` (409).

### 4.2 Bitta qurilmada bitta faol sessiya
```sql
CREATE UNIQUE INDEX sessions_one_live_per_device
  ON sessions (device_id) WHERE status IN ('WAITING','ACTIVE','PAUSED');
```

### 4.3 Yaqin filiallarni topish (PostGIS)
```sql
CREATE INDEX branches_location_gix ON branches USING gist (location);

SELECT b.id, b.name,
       ST_Distance(b.location, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography) AS distance_m
FROM branches b
JOIN clubs c ON c.id = b.club_id AND c.status = 'ACTIVE'
WHERE b.status = 'ACTIVE' AND b.deleted_at IS NULL
  AND ST_DWithin(b.location, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radius_m)
ORDER BY distance_m
LIMIT :limit;
```
Diqqat: `ST_MakePoint(longitude, latitude)` — tartib **lng, lat**.

### 4.4 Tekst qidiruv
`pg_trgm` GIN index: `clubs.name`, `branches.name`, `branches.address`. `ILIKE '%q%'` yoki `similarity()`.

### 4.5 Boshqa CHECK va indekslar
- `bookings`: CHECK (`end_at > start_at`), CHECK (`total_amount = subtotal_amount - discount_amount`), CHECK (`paid_amount >= 0`).
- `booking_items`: CHECK (`end_at > start_at`).
- `payments`: CHECK (`amount > 0`).
- `reviews`: CHECK (`rating BETWEEN 1 AND 5`).
- `user_roles`: partial unique indekslar (NULL club/branch bilan to'g'ri ishlashi uchun `COALESCE` yoki alohida indekslar).
- Tez-tez ishlatiladigan: `bookings (branch_id, status, start_at)`, `sessions (branch_id, status)`, `payments (club_id, paid_at)`, `notifications (user_id, read_at, created_at desc)`, `audit_logs`, `outbox_events (processed_at) where processed_at is null`.
- `clubs.rating_avg` va `branches.rating_avg` — trigger emas, review yaratilganda/moderatsiya qilinganda service ichida qayta hisoblanadi (yoki job).

## 5. JSON sxemalar

**working_hours**
```json
{ "mon": [{"open":"10:00","close":"02:00"}], "tue": [...], "sun": [], "always_open": false }
```
`close < open` bo'lsa keyingi kunga o'tadi. Bo'sh massiv = yopiq.

**cancellation_policy**
```json
{
  "free_cancel_minutes_before": 120,
  "rules": [
    {"min_minutes_before_start": 120, "refund_percent": 100},
    {"min_minutes_before_start": 30,  "refund_percent": 50},
    {"min_minutes_before_start": 0,   "refund_percent": 0}
  ],
  "platform_fee_refundable": false,
  "no_show_refund_percent": 0
}
```
Bron yaratilganda siyosat `bookings.price_snapshot.cancellation_policy` ga nusxalanadi; cancel/no-show refundi snapshot bo'yicha hisoblanadi.
`CARD_TRANSFER` to'lovda `payments.provider_payload = {payer_name, payer_card_last4, card_last4}`; uning refundi `PENDING` bo'lib, klub qaytargach `COMPLETED`.

**price_breakdown** (booking_item)
```json
{ "segments":[
   {"from":"2026-09-29T15:00Z","to":"2026-09-29T17:00Z","tariff_id":"..","rule":"STANDARD","price_per_hour":2500000,"amount":5000000}
  ], "rounding":"CEIL_TO_SLOT", "currency":"UZS" }
```

## 6. Seed ma'lumotlar
- Rollar va permissionlar (`01-API.md` §5) — idempotent seed.
- 1 Super Admin (env orqali parol).
- Amenities katalogi (wifi, parking, ac, vip, ps5, ps4, racing, food, drinks, smoking, non_smoking).
- Plans (FREE/STARTER/PRO/ENTERPRISE) limitlari bilan.
- `platform_settings` default qiymatlari.
- Demo: 2 klub, 3 filial (Toshkent koordinatalari), xonalar, 30 qurilma, tariflar, 20 bron, 5 sharh (faqat `NODE_ENV != production`).
- Demo arenda (`prisma/seed/rentals.ts`): demo klub filiallarida 11 ta arenda konsoli (PS5, PS4, Xbox, Switch, VR2 — soatlik/kunlik, garov, yetkazib berish) va `customer@gameclub.local` uchun har holatdagi 9 ta arenda `RN-DEMO01..09` (qaytarilgan, mijozda, kechikkan, tasdiqlangan, yangi so'rov, bekor/rad etilgan). Konsol — filial+nom, arenda — kod bo'yicha takrorlanmaydi; to'langanlariga `payments` + `ledger_entries`.

## 7. Zaxira va saqlash muddati 🆕
- Kunlik `pg_dump` + WAL arxiv (PITR), 30 kun saqlash; oyiga bir marta restore sinovi.
- `otp_requests` 30 kun, `payment_events` 2 yil, `audit_logs` 2 yil, `outbox_events` (processed) 14 kun, `idempotency_keys` 48 soat.
- Foydalanuvchi akkauntni o'chirsa: shaxsiy maydonlar anonimlashtiriladi (`phone`, `name`, `email`), moliyaviy yozuvlar saqlanadi.

### rooms.grid_cols / grid_rows (migratsiya `20261001120000_room_seat_map`)
Xona sxemasi o'lchami (default 10×5). Qurilma joyi `devices.layout {x,y}` — shu xona gridi ichidagi katak.
### rooms.decor (migratsiya `20261001150000_room_decor`)
`JSONB [{kind, x, y}]`, default `[]` — kirish, kassa, devor, yo'lak, TV, hojatxona kataklari.

### rental_items, rentals, payments.rental_id (migratsiya `20261002150000_console_rentals`)
**rental_items** (uyga beriladigan konsol): `club_id*`, `branch_id*`, `name*`, `type*`, `description`, `image_url`, `includes text[]`, `games text[]`, `quantity* ≥1`, `price_per_hour`, `price_per_day` (tiyin; kamida bittasi NOT NULL), `min_hours`, `max_days`, `deposit_amount` (dona uchun), `delivery_available`, `delivery_fee`, `requirements`, `status (ACTIVE|INACTIVE)`, `position`, `deleted_at`.
**rentals**: `code* unique (RN-XXXXXX)`, `item_id*`, `club_id*`, `branch_id*`, `customer_id*`, `contact_phone`, `quantity`, `rate_unit*`, `units*`, `start_at*`, `end_at*`, `unit_price`, `subtotal_amount`, `delivery_fee_amount`, `late_fee_amount`, `total_amount` (CHECK = subtotal + delivery + late), `deposit_amount`, `deposit_status`, `paid_amount`, `payment_status`, `status*`, `fulfillment`, `delivery_address`, `notes`, `item_snapshot jsonb*`, `idempotency_key` (unique customer_id+key), `confirmed_*`, `handed_over_*`, `returned_*`, `cancelled_*`, `cancel_reason`. Indekslar: (item_id, start_at), (branch_id, status, start_at), (customer_id, created_at desc). Dona soni bo'yicha band qilish exclusion constraint bilan emas — `rental_items` qatorini `FOR UPDATE` qulflab, tranzaksiyada hisoblanadi.

### users.must_change_password + permission `staff.reset_password` (migratsiya `20261016120000_staff_password_reset`)
Admin xodim parolini tiklaganda `true`; foydalanuvchi `POST /auth/password` bilan yangi parol o'rnatgach `false`. Migratsiya permission'ni yaratadi va `SUPER_ADMIN`, `CLUB_OWNER`, `CLUB_ADMIN` rollariga biriktiradi (`catalog.ts` bilan mos).

### club_applications (migratsiya `20261016150000_club_applications`)
`full_name*`, `phone*`, `club_name*`, `city*`, `address`, `devices_count`, `branches_count`, `telegram`, `comment`, `language*`, `status* (NEW|CONTACTED|APPROVED|REJECTED)`, `admin_note`, `handled_by`, `handled_at`. Indekslar: `(status, created_at desc)`, `(phone)`. Akkauntga bog'lanmagan (ariza egasi foydalanuvchi emas).
