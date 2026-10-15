# 01 — API (NestJS)

Yagona backend: customer mobile, customer web, club admin, super admin va (V2) PC agent shu API'dan foydalanadi.
Sxema: `02-DATABASE.md`. Qarorlar: `00-README.md` §4.

## 1. Stack
```text
NestJS + TypeScript (strict)
PostgreSQL 16 + PostGIS + btree_gist   Prisma (+ raw SQL)
Redis (cache, rate limit, lock, Socket.IO adapter)   BullMQ
Socket.IO (/ws)   JWT (access+refresh)   Argon2id
class-validator / class-transformer   Swagger (@nestjs/swagger)
Pino (log)   OpenTelemetry (ixtiyoriy)   Sentry
S3-compatible (MinIO dev)   sharp (rasm variantlari)
Jest + Supertest + Testcontainers
```

## 2. Papka tuzilmasi
```text
apps/api/src/
├── main.ts, app.module.ts
├── common/            # guards, decorators, filters, interceptors, pipes, dto (pagination), utils (money, time, code)
├── config/            # env schema (zod/joi), configuration
├── database/          # prisma service, raw sql helpers, transaction helper
├── infra/             # redis, queues, storage, mailer, sms, push, telegram
└── modules/
    ├── auth/  users/  rbac/  clubs/  branches/  rooms/  devices/  tariffs/
    ├── discovery/ availability/ bookings/ sessions/
    ├── payments/ (providers/, webhooks/, refunds/, ledger/, shifts/)
    ├── promotions/ reviews/ favorites/ notifications/ support/
    ├── analytics/ reports/ subscriptions/ commissions/
    ├── admin/ (super admin endpointlari) files/ audit/ settings/ realtime/ health/
```
Har modul: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities|types`, `*.spec.ts`. Modullar bir-birining DB jadvallariga bevosita tegmaydi — service orqali (yoki domain event orqali).

## 3. Umumiy konvensiyalar

**Base:** `/api/v1`. Swagger: `/api/docs` (production'da faqat ichki). OpenAPI JSON → `packages/types` client generatsiya.

**Javob formati**
```json
{ "success": true, "data": {}, "meta": { "page":1, "limit":20, "total":134, "next_cursor":null }, "message": null }
```
Xato:
```json
{ "success": false, "data": null, "message": "Slot band", "error": { "code": "BOOKING_SLOT_TAKEN", "details": {}, "request_id": "..." } }
```
`message` — `Accept-Language` bo'yicha lokalizatsiya qilingan; klient `error.code` bo'yicha ishlaydi.

**Xato kodlari (asosiylari):** `VALIDATION_ERROR`(422), `UNAUTHORIZED`(401), `TOKEN_EXPIRED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `CONFLICT`(409), `RATE_LIMITED`(429), `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `BOOKING_SLOT_TAKEN`, `BOOKING_HOLD_EXPIRED`, `BOOKING_OUTSIDE_WORKING_HOURS`, `BOOKING_TOO_EARLY/TOO_LATE`, `BOOKING_NOT_CANCELLABLE`, `BOOKING_CHECKIN_WINDOW_CLOSED`, `CUSTOMER_BOOKING_BLOCKED`, `DEVICE_NOT_AVAILABLE`, `SESSION_ALREADY_ACTIVE`, `SESSION_EXTEND_CONFLICT`, `PAYMENT_FAILED`, `PAYMENT_ALREADY_PAID`, `REFUND_NOT_ALLOWED`, `PROMO_INVALID`, `PLAN_LIMIT_REACHED`, `CLUB_NOT_ACTIVE`, `IDEMPOTENCY_CONFLICT`.

**Pagination:** ro'yxatlar `?page=&limit=` (admin jadvallar) yoki `?cursor=&limit=` (mobile feed, tarix). Default limit 20, max 100. Saralash `?sort=-created_at`. Filtr `?status=&from=&to=`.

**Idempotency** 🆕: `Idempotency-Key` header (UUID) `POST /bookings`, `/payments`, `/payments/:id/refund`, `/sessions/*`, `/bookings/:id/cancel` uchun majburiy/qo'llab-quvvatlanadi. Bir xil key + bir xil body → oldingi javob qaytariladi; boshqa body → `IDEMPOTENCY_CONFLICT`. TTL 48 soat.

**Vaqt/pul:** UTC ISO-8601; pul integer tiyin (`"total_amount": 5000000` = 50 000 so'm). Klientlar formatlaydi.

**Til:** `Accept-Language: uz|ru|en`. Kontent maydonlari (tarif nomi va h.k.) klub tilida saqlanadi; tizim xabarlari lokalizatsiya qilinadi.

**Request ID** 🆕: `X-Request-Id` (kelmasa generatsiya), log va xatoda qaytadi.

**Soft delete:** DELETE endpointlar `deleted_at` qo'yadi. Faol bron/sessiyasi bor qurilma/filialni o'chirish `409 CONFLICT`.

**Rate limit** (Redis, `@nestjs/throttler`): darajalar va endpointlar — pastda «Rate limit (2026-10-15)». Bunga qo'shimcha servis ichidagi limitlar: `POST /auth/send-otp` 3/10min/telefon + 10/soat/IP + 60s cooldown; `POST /auth/verify-otp` 5 urinish/kod; `POST /auth/login` 10/10min/IP+login; payment webhook — imzo/Basic auth bilan (rate limit yo'q).

## 4. Autentifikatsiya

### 4.1 Customer (telefon + OTP)
1. `POST /auth/send-otp {phone, purpose: LOGIN|REGISTER|RESET}` → 6 xonali kod **Telegram bot orqali** (SMS ishlatilmaydi), TTL 120 s, Redis'da hash, resend cooldown 60 s, kuniga max 10/telefon.
   - Telefon botga bog'langan (`telegram_links`) → kod darhol botga yuboriladi: `{channel: TELEGRAM, delivered: true, expires_in, resend_in}`.
   - Bog'lanmagan → `{channel: TELEGRAM, delivered: false, bot_url: "https://t.me/<bot>?start=<nonce>", link_expires_in: 600}`. Klient botni ochadi; botda `/start` → «📱 Raqamni ulashish» (Telegram `request_contact`, faqat o'z kontakti: `contact.user_id == from.id`) → raqam `telegram_links` ga yoziladi va kod botga yuboriladi. Nonce'dagi raqam kontakt raqamiga mos kelmasa kod yuborilmaydi.
   - Bot yangilanishlari: dev — long polling (Redis lock, bitta instans), prod — `POST /telegram/webhook` (`X-Telegram-Bot-Api-Secret-Token`). Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME?`, `TELEGRAM_MODE=polling|webhook`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`.
   - Bot token berilmagan va `NODE_ENV != production` → `{channel: DEV}`, qat'iy kod `000000`.
2. `POST /auth/verify-otp {phone, code, device}` → foydalanuvchi mavjud bo'lsa login, bo'lmasa yaratiladi (`REGISTER`) → `{access_token, refresh_token, user, is_new}`.
3. Ixtiyoriy parol: `POST /auth/password` (o'rnatish), `POST /auth/login {phone,password}`.
4. Anti-fraud 🆕: SMS-pumping himoyasi (mamlakat prefiksi allowlist, IP/qurilma limiti, CAPTCHA/attestation ixtiyoriy), bloklangan telefon ro'yxati.

### 4.2 Staff / Super Admin
- `POST /auth/login {login (email|phone), password}` → agar `totp_enabled` bo'lsa `{requires_2fa: true, challenge_id}` → `POST /auth/2fa/verify {challenge_id, code}`.
- Super Admin uchun 2FA **majburiy** 🆕.
- Xodim taklifi 🆕: `POST /clubs/:clubId/staff/invitations` → SMS/email havola → `POST /auth/invitations/accept {token, password, name}`.
- Parolni tiklash: `POST /auth/forgot-password`, `POST /auth/reset-password`.

### 4.3 Tokenlar
- Access JWT 15 daqiqa (`sub`, `type`, `roles` qisqacha, `jti`). Refresh 30 kun, opaque random, DB'da **hash** (`refresh_tokens`), har ishlatilganda **rotation**; eski token qayta ishlatilsa (reuse) → butun `family_id` bekor qilinadi.
- `POST /auth/refresh`, `POST /auth/logout` (joriy), `POST /auth/logout-all`.
- `GET /auth/sessions` (qurilmalar ro'yxati), `DELETE /auth/sessions/:id` 🆕.
- `GET /auth/me` → user + rollar + permissionlar + scope (klient UI'ni shunga qarab quradi).
- Parol: Argon2id. Parol siyosati: min 8, ro'yxatdagi zaif parollar rad.
- WebSocket handshake ham JWT bilan.

### 4.4 Profil 🆕
`GET/PATCH /users/me` (ism, avatar, til, email), `POST /users/me/phone/change` (OTP bilan), `DELETE /users/me` (akkauntni o'chirish → anonimlashtirish, faol bron bo'lsa rad), `GET /users/me/export` (ma'lumot eksporti, async job), `PUT /users/me/notification-preferences`, `POST /users/me/device-tokens` (push token ro'yxatga olish), `DELETE /users/me/device-tokens/:token`.

## 5. RBAC va tenancy

### 5.1 Model
`roles` + `permissions` + `role_permissions` + `user_roles(user, role, club_id?, branch_id?)`.
Tizim rollari (seed): `SUPER_ADMIN`, `SUPPORT`, `CLUB_OWNER`, `CLUB_ADMIN`, `BRANCH_ADMIN` 🆕, `OPERATOR`, `CUSTOMER`. Club owner o'z klubi doirasida **custom rol** yaratishi mumkin (`roles.scope_type=CLUB`, `club_id` bilan) 🆕 — permissionlar to'plamini tanlaydi.

### 5.2 Tekshiruv
```text
@RequirePermission('devices.update')  →  PermissionGuard
1. JWT → user
2. So'ralayotgan resursning club_id/branch_id sini ResourceScopeResolver aniqlaydi
3. user_roles ichida: (permission ∈ role) AND (scope resursni qoplaydi)
   PLATFORM scope → hamma; CLUB scope → shu club; BRANCH scope → shu branch
4. Aks holda 403 (yoki 404 — boshqa klub resursini "mavjud emas" deb qaytarish afzal)
```
- Permissionlar Redis'da 60 s cache; rol o'zgarsa invalidatsiya.
- Har repository so'rovi `club_id` filtri bilan (TenantScope helper). Test: "Club A admin Club B resursini ko'ra olmaydi" — har modul uchun majburiy e2e test.
- Customer resurslari: `resource.user_id === me.id` (ownership guard).

### 5.3 Permission katalogi
```text
platform: platform.clubs.approve, platform.clubs.suspend, platform.users.view, platform.users.block,
          platform.payments.view, platform.payouts.manage, platform.subscriptions.manage,
          platform.reviews.moderate, platform.tickets.manage, platform.analytics.view,
          platform.settings.manage, platform.audit.view, platform.announcements.manage
clubs:     clubs.view, clubs.update, clubs.documents.manage
branches:  branches.view, branches.create, branches.update, branches.delete
rooms:     rooms.view, rooms.create, rooms.update, rooms.delete
devices:   devices.view, devices.create, devices.update, devices.delete, devices.status.change
tariffs:   tariffs.view, tariffs.create, tariffs.update, tariffs.delete
promotions: promotions.view, promotions.manage
bookings:  bookings.view, bookings.create, bookings.cancel, bookings.checkin, bookings.reschedule
sessions:  sessions.view, sessions.start, sessions.stop, sessions.pause, sessions.extend, sessions.move
customers: customers.view, customers.notes.manage, customers.block
payments:  payments.view, payments.create, payments.refund
shifts:    shifts.open, shifts.close, shifts.view_all
reports:   reports.view, reports.export
staff:     staff.view, staff.create, staff.update, staff.delete, roles.manage
reviews:   reviews.view, reviews.reply
notifications: notifications.send, announcements.manage
settings:  settings.view, settings.update
```
Default rol → permission xaritasi seed faylida (`prisma/seed/rbac.ts`) yagona manba bo'lib turadi:
- OPERATOR: `devices.view, devices.status.change, bookings.view/create/checkin/cancel, sessions.*, customers.view, payments.view/create, shifts.open/close`.
- BRANCH_ADMIN: OPERATOR + `rooms.*, devices.*, tariffs.*, reports.view, staff.view, promotions.view` (o'z filiali).
- CLUB_ADMIN: klub bo'yicha BRANCH_ADMIN + `branches.update, staff.*(operator darajasigacha), reports.export`.
- CLUB_OWNER: klubdagi hamma permission (`platform.*` dan tashqari) + `roles.manage`.
- Owner o'zidan yuqori/teng rolni bera olmaydi (privilege escalation oldi 🆕).

## 6. Modullar

Har endpoint uchun: **[Rol/permission]**. `C`=customer (o'z resursi), `P`=public.

### 6.1 users
Profil endpointlari §4.4. Staff ro'yxati `GET /clubs/:clubId/staff [staff.view]`, `POST /clubs/:clubId/staff/invitations [staff.create]`, `PATCH /clubs/:clubId/staff/:userId [staff.update]` (rol/filialni o'zgartirish), `DELETE ... [staff.delete]` (rolni olib tashlash, foydalanuvchi o'chmaydi). `GET /clubs/:clubId/customers [customers.view]` (shu klubda bron qilganlar; telefon qisman maskalangan operator uchun 🆕), `GET/PUT /clubs/:clubId/customers/:userId/notes [customers.notes.manage]`.

### 6.2 clubs (+ verification)
```http
GET    /clubs                     [P]  ACTIVE klublar (qidiruv, sahifalash)
GET    /clubs/:idOrSlug           [P]  ommaviy ma'lumot
POST   /clubs                     [auth]  yangi klub arizasi (DRAFT). Yaratuvchi CLUB_OWNER bo'ladi
PATCH  /clubs/:id                 [clubs.update]
DELETE /clubs/:id                 [owner] soft delete (faol bron bo'lmasa)
POST   /clubs/:id/submit          [clubs.update]  DRAFT/REJECTED → PENDING_APPROVAL (to'liqlik tekshiruvi: filial, hujjat, ish vaqti)
POST   /clubs/:id/documents       [clubs.documents.manage]
GET    /clubs/:id/documents       [clubs.documents.manage]
GET    /clubs/:id/settings        [settings.view]      PATCH [settings.update]  (booking qoidalari, cancellation_policy)
```
Super admin: `POST /admin/clubs/:id/approve|reject|suspend|reactivate` (sabab majburiy), `GET /admin/clubs?status=PENDING_APPROVAL`. Status o'tishlari faqat ruxsat etilgan grafda: `DRAFT→PENDING_APPROVAL→ACTIVE|REJECTED`, `ACTIVE↔SUSPENDED`, `*→CLOSED`. Har o'tish `audit_logs` + notification (owner'ga).
Platforma xodimlari (SUPER_ADMIN/SUPPORT) klub egasi bo'lolmaydi: `POST /clubs` ular uchun `403 FORBIDDEN` (`reason: PLATFORM_STAFF_CANNOT_OWN_CLUB`); `POST /admin/clubs` da `owner_phone` platforma xodimiga tegishli bo'lsa ham rad etiladi. Super admin klubni faqat boshqa egasi nomidan ochib, boshqaradi.
Qoida: faqat `ACTIVE` klub va `ACTIVE` filial ommaviy qidiruvda ko'rinadi va bron qabul qiladi.

### 6.3 branches
```http
GET    /clubs/:clubId/branches         [P ACTIVE | branches.view]
POST   /clubs/:clubId/branches         [branches.create]  (plan limiti tekshiriladi → PLAN_LIMIT_REACHED)
GET    /branches/:id                   [P]
PATCH  /branches/:id                   [branches.update]  (ish vaqti, koordinata, booking_settings)
DELETE /branches/:id                   [branches.delete]
GET/POST/DELETE /branches/:id/hours-exceptions  [branches.update] 🆕
POST   /branches/:id/images            [branches.update] (files orqali)
```
Filial yaratishda `latitude/longitude` majburiy → `location geography` to'ldiriladi. `TEMPORARILY_CLOSED` qilinsa kelajakdagi bronlar haqida ogohlantirish va (tanlovga ko'ra) ommaviy bekor+refund workflow 🆕.

### 6.4 rooms
`GET /branches/:branchId/rooms`, `POST /branches/:branchId/rooms`, `PATCH /rooms/:id`, `DELETE /rooms/:id` — `[rooms.*]`. Xonada faol qurilma bo'lsa o'chirish rad etiladi.

### 6.5 devices
```http
GET    /branches/:branchId/devices        [devices.view | P (qisqa: type, category, specs)]
POST   /branches/:branchId/devices        [devices.create] (plan limiti)
POST   /branches/:branchId/devices/bulk   [devices.create] 🆕 (PC-01..PC-20 ni bir zumda)
PATCH  /devices/:id                       [devices.update]
DELETE /devices/:id                       [devices.delete]
PATCH  /devices/:id/status                [devices.status.change] {operational_status, reason}
GET    /devices/:id/availability?from=&to=   [P] oraliq bo'yicha band vaqtlar
GET/POST/PATCH /branches/:branchId/device-categories  [devices.*]
POST   /devices/:id/maintenance           [devices.status.change] 🆕 ; PATCH /maintenance/:id
PUT    /branches/:branchId/layout         [devices.update] 🆕 zal sxemasi (x,y pozitsiyalar)
```
- `MAINTENANCE/DISABLED` qilinganda kelajakdagi tasdiqlangan bronlari bo'lsa: API `409` + konfliktlar ro'yxati; `?resolve=reassign|cancel` bilan avtomatik boshqa qurilmaga ko'chirish yoki bekor+refund 🆕.
- Status o'zgarishi `device.status.changed` eventini WebSocketga yuboradi.

### 6.6 tariffs + narx engine
```http
GET  /branches/:branchId/tariffs      [P | tariffs.view]
POST /branches/:branchId/tariffs      [tariffs.create]
PATCH /tariffs/:id  DELETE /tariffs/:id   [tariffs.update|delete]
POST /branches/:branchId/price-quote  [P/C] {device_ids|category_id, start_at, duration_minutes, promo_code?} → narx hisob
```
**Tarif tanlash ustuvorligi** (qurilma va vaqt segmenti uchun): `device_id` aniq → `room_id` → `category_id` → `device_type` → filial default; ichida `priority` yuqorisi; sana bo'yicha aniq (bayram) > hafta kuni (weekend) > kunlik oyna (night) > standart.
**Hisoblash algoritmi (PriceEngine):**
1. `[start, end)` ni tarif oynalari chegaralari bo'yicha segmentlarga bo'l (kesib o'tuvchi 22:00–08:00 oynalar ham, filial timezone'ida).
2. Har segment: `amount = ceil(minutes * price_per_hour / 60)` (butun tiyinga yaxlitlash).
3. Min/max muddat tekshiruvi (`min_minutes`, `max_minutes`), slot qadamiga moslik.
4. Promo/chegirma qo'llanadi (§6.12), `discount_amount`.
5. Natija `price_breakdown` snapshot sifatida `booking_items` ga yoziladi; keyin tarif o'zgarsa eski bron narxi o'zgarmaydi.
Unit testlar: kesib o'tuvchi tun tarifi, hafta oxiri chegarasi, bayram, yaxlitlash, min muddat.

### 6.7 discovery (xarita va qidiruv)
```http
GET /branches/nearby?lat=&lng=&radius=&limit=      [P]
GET /branches/search?q=&lat=&lng=&sort=&filters…   [P]
GET /branches/map?bbox=w,s,e,n&zoom=               [P] 🆕 xarita markerlari (klasterlash server yoki klientda)
GET /branches/:id/summary                          [P] karta uchun: rating, masofa, "open now", min narx, bo'sh qurilmalar soni
```
Filtrlar: `distance`, `price_min/max` (soatlik min narx), `rating_min`, `open_now`, `available_now` (hozir bo'sh qurilma bor), `device_type`, `room_type`, `amenities[]`. Saralash: `distance | price | rating | popularity` (popularity = so'nggi 30 kun bron soni; formula sozlanadi, bitta "eng yaxshi"ga qattiq bog'lanmaydi).
Javob: `distance_m`, `is_open_now`, `open_until`, `min_price_per_hour`, `available_devices_count`, `rating_avg`, `cover_image`.
Keshlash: Redis 30–60 s (koordinatani ~100 m gridga yaxlitlab kalit). `available_now` real-time'ga yaqin bo'lgani uchun alohida qisqa TTL.
Faqat `ACTIVE` klub + `ACTIVE` filial; koordinata/masofa aniq raqamli (maxfiy emas).
Qidiruv tarixi/mashhur so'rovlar — V1.5.

### 6.8 availability
```http
GET /branches/:id/availability?date=&start_time=&duration=&device_type=&room_id=&category_id=  [P]
```
Javob: `{ devices: [{id,name,room,category,type,status: AVAILABLE|RESERVED|OCCUPIED|UNAVAILABLE, price_quote}], categories: [{category_id, name, available_count, price_from}], suggested_slots: [...] }`
- `mode` klub sozlamasiga qarab: `SPECIFIC_DEVICE`, `CATEGORY`, yoki ikkalasi (`booking_settings.allow_*`).
- Hisoblash §7.1. Agar tanlangan vaqtda bo'sh joy yo'q bo'lsa — eng yaqin 3 ta muqobil vaqt (`suggested_slots`) 🆕.
- Vaqt filial ish vaqti + istisnolar + `min_advance` + `max_advance` ga mos bo'lishi shart.

### 6.9 bookings
```http
POST /bookings                       [C/auth]  hold yaratadi (PENDING_PAYMENT)
GET  /bookings                       [C: o'zimniki | bookings.view: klub/filial]  ?status=&from=&to=&branch_id=
GET  /bookings/:id                   [C | bookings.view]
POST /bookings/:id/cancel            [C | bookings.cancel] {reason}
POST /bookings/:id/reschedule        [C | bookings.reschedule] {start_at, duration?, device_id?} 🆕
POST /bookings/:id/check-in          [bookings.checkin | C (agar app check-in yoqilgan)]
POST /bookings/check-in/scan         [bookings.checkin] {qr_payload}
POST /bookings/walk-in               [bookings.create] {branch_id, device_ids, duration, guest_name?, guest_phone?, payment_method, start_now}
POST /bookings/:id/no-show           [bookings.checkin] qo'lda belgilash
GET  /bookings/:id/qr                [C] QR payload
GET  /bookings/:id/timeline          [bookings.view] 🆕 (booking_events)
```
**Yaratish so'rovi:** `{branch_id, start_at, duration_minutes, items:[{device_id? | category_id}], promo_code?, source}`.
**Lifecycle:**
```text
PENDING_PAYMENT ──to'lov──► CONFIRMED ──check-in──► CHECKED_IN ──sessiya start──► ACTIVE ──stop──► COMPLETED
      │hold tugadi                │bekor                                │grace o'tdi
      ▼                           ▼                                     ▼
   EXPIRED                    CANCELLED                              NO_SHOW
```
Qoidalar:
- Bir vaqtning o'zida `CUSTOMER_BOOKING_BLOCKED` bo'lgan (no-show limiti) mijoz bron qila olmaydi; bir mijoz bir vaqtga bir nechta bron qila oladi (masalan, do'stlari uchun boshqa PC — bitta qurilmani DB exclusion constraint himoya qiladi); bitta mijozning parallel `PENDING_PAYMENT` holdlari max 2.
- **Cancel:** faqat `PENDING_PAYMENT|CONFIRMED` (va operator uchun `CHECKED_IN`). Refund foizi `cancellation_policy` bo'yicha (§6.10). Cancel tranzaksiyada: booking → CANCELLED, items.active=false, refund yaratiladi, event chiqadi.
- **Reschedule:** yangi oraliq uchun availability qayta tekshiriladi va bir tranzaksiyada eski item bo'shatilib yangisi band qilinadi (constraint himoya qiladi). Narx farqi: yuqori bo'lsa qo'shimcha to'lov (`amount_due`), past bo'lsa farq refund yoki kreditlanadi (klub sozlamasi). Cheklov: boshlanishiga X daqiqa qolganda ko'chirib bo'lmaydi; max 2 marta.
- **Check-in oynasi:** `start - early_checkin_minutes` … `start + grace_minutes` (default 15/15). Undan tashqarida `BOOKING_CHECKIN_WINDOW_CLOSED` (operator override uchun `force=true` + permission).
- **No-show:** `start + grace` dan keyin job `CONFIRMED` bronni `NO_SHOW` qiladi (agar `auto_no_show`), qurilma bo'shaydi, mijoz `no_show_count++`; N marta (platforma sozlamasi, default 3/30 kun) → `booking_blocked_until`. Refund `no_show_refund_percent` bo'yicha.
- **Booking code:** `GC-` + 6 belgi Crockford base32, unique. QR payload: `gc1.<bookingId>.<exp>.<hmac>` (HMAC-SHA256, server sirli kalit) — taxmin qilib bo'lmaydi; `exp` = start+grace.
- Walk-in: `source=WALK_IN`, `customer_id` null yoki telefon bo'yicha topilgan/yaratilgan (`PENDING_VERIFICATION`); to'lov naqd/terminal, ochiq smenaga bog'lanadi; darhol `CONFIRMED→CHECKED_IN` va (start_now) sessiya boshlanadi.
- Har bir o'tish `booking_events` + `audit` (operator amallari) + WebSocket + notification.

### 6.10 payments, refunds, ledger, kassa

```http
POST /payments                       [C] {booking_id, provider, return_url?}  → {payment_id, checkout_url|payload}
GET  /payments/:id                   [C | payments.view]
GET  /payments                       [payments.view] filtrlar + eksport
POST /payments/cash                  [payments.create] operator: {booking_id|session_id, method: CASH|TERMINAL, amount}  → smena talab qilinadi
POST /payments/:id/refund            [payments.refund] {amount?, reason}
POST /payments/transfer              [C] {booking_id, payer_name, payer_card_last4}  → CARD_TRANSFER, PROCESSING (klub tasdiqlaydi)
POST /payments/:id/transfer/confirm  [payments.create]  → PAID, bron CONFIRMED
POST /payments/:id/transfer/reject   [payments.create] {reason}  → FAILED, mijozga xabar
GET  /refunds                        [payments.refund] ?status=PENDING&club_id|branch_id  (mijoz telefoni, to'lov kartasi oxiri)
POST /refunds/:id/complete           [payments.refund] {reference?}  → COMPLETED (klub pulni qo'lda qaytardi)
POST /webhooks/payments/:provider    [P, imzo/basic-auth tekshiruvi]
GET  /shifts/current                 [shifts.open]   POST /shifts/open {opening_cash}   POST /shifts/:id/close {counted_cash, note}
GET  /shifts                         [shifts.view_all]  GET /shifts/:id/report
```
**Provider abstraksiyasi:**
```ts
interface PaymentProvider {
  code: string;
  createCheckout(payment): Promise<{ url?: string; payload?: any }>;
  handleWebhook(req): Promise<NormalizedEvent>;   // imzo tekshiruvi ichida
  refund(payment, amount): Promise<ProviderRefundResult>;
  getStatus(providerTxId): Promise<ProviderStatus>; // reconciliation uchun
}
```
Adapterlar: `PaymeProvider`, `ClickProvider`, (ixtiyoriy) `UzumProvider`, `ManualProvider` (cash/terminal). Har provayderning rasmiy hujjatiga qarab yoziladi (Payme — merchant JSON-RPC metodlari, Click — prepare/complete; summa tiyin/so'm birligini tekshiring).
**Qoidalar:**
- Webhook: (1) imzo/auth tekshir, (2) `payment_events` ga `(provider,event_id)` unique bilan yoz — takror kelsa e'tiborsiz qoldir (idempotent), (3) tranzaksiyada `payments.status` yangila, `bookings.paid_amount/payment_status`, `PAID` bo'lsa booking `CONFIRMED`, ledger yoz, outbox event.
- **Payment-after-expiry** 🆕: hold tugagan bo'lsa → slot hali bo'shmi? Ha: qayta band qilib tasdiqlash. Yo'q: avtomatik refund + mijozga xabar.
- To'lov summasi doim server hisoblagan `amount_due` bilan solishtiriladi (klientdan ishonilmaydi).
- Muvaffaqiyatsiz to'lov bronni tasdiqlamaydi; hold davom etadi (tugamaguncha qayta urinish mumkin).
- **Refund:** `RefundService.calculate(booking, now)` → `cancellation_policy` (§5 DB) + platforma to'lovini (agar `platform_fee_refundable=false`) hisobga oladi → provider.refund → `refunds` + ledger (teskari yozuv) + booking `REFUNDED/PARTIALLY_REFUNDED`. Naqd to'lovning refundi operator tomonidan qo'lda belgilanadi (smena hisobotiga tushadi).
- **Ledger** 🆕: har to'lov/refund/komissiya `ledger_entries` ga double-entry uslubida yoziladi (mijoz → provayder → klub/platforma). Hisobotlar ledger asosida (gross, refund, komissiya, klub daromadi ajratiladi).
- **Reconciliation job** 🆕: har soatda `PROCESSING` va so'nggi 24 soatdagi to'lovlarni `provider.getStatus` bilan solishtirish; nomuvofiqlik → alert.
- **Komissiya:** `commission_bps` klub yoki platforma default'idan; `payments.commission_amount` va `club_amount` to'lov paytida yoziladi (MVP'da hisoblanadi, payout V1'da).
- **Kassa smenasi** 🆕: operator naqd/terminal to'lov qabul qilishdan oldin smena ochadi; yopishda `expected_cash = opening + naqd kirimlar − naqd refundlar`, `difference` hisoblanadi; farq bo'lsa owner'ga xabar.
- Karta ma'lumotlari hech qachon serverda saqlanmaydi (provayder sahifasi/SDK).

### 6.11 sessions
```http
POST /sessions                   [sessions.start] {booking_id? | walk_in:{device_id,duration,...}}  → WAITING
POST /sessions/:id/start         [sessions.start]
POST /sessions/:id/pause         [sessions.pause]     POST /sessions/:id/resume [sessions.pause]
POST /sessions/:id/extend        [sessions.extend] {minutes, payment_method?}
POST /sessions/:id/move          [sessions.move] {to_device_id} 🆕 (mijozni boshqa PC'ga ko'chirish)
POST /sessions/:id/stop          [sessions.stop] {reason?}
GET  /sessions/active            [sessions.view | C: o'zimniki]
GET  /sessions/:id               [sessions.view | C]
GET  /branches/:id/live          [sessions.view] live board snapshot (qurilmalar + occupancy + qolgan vaqt)
```
- Boshlash sharti: qurilma `operational_status=ACTIVE`, boshqa faol sessiya yo'q (DB unique index), bron `CHECKED_IN` (yoki walk-in). Aks holda `DEVICE_NOT_AVAILABLE/SESSION_ALREADY_ACTIVE`.
- `expected_end_at = started_at + booking duration + total_paused`. Klientlar `expected_end_at` va server vaqti (`server_time` javobda) dan qolgan vaqtni o'zlari tick qiladi; har 30 s'da `session.updated` sinxron.
- **Extend:** keyingi bron bilan konflikt bo'lsa `SESSION_EXTEND_CONFLICT` (operator boshqa qurilma taklif qilishi mumkin); `booking_items.end_at` cho'ziladi (constraint tekshiradi), narx PriceEngine bilan hisoblanib `session_charges(EXTENSION)`, to'lov qabul qilinadi (yoki qarz sifatida `amount_due`).
- **Stop:** haqiqiy tugash; `expected_end` dan oshgan bo'lsa overtime hisoblanadi (`session_charges(OVERTIME)`, tarif bo'yicha, grace bilan); erta tugatilsa qaytarim yo'q (yoki klub siyosati bo'yicha qisman — sozlama 🆕). Booking `COMPLETED`, qurilma bo'shaydi, sharh so'rovi notification'i.
- Auto-close job: `expected_end_at` + `overtime_grace` dan keyin operatorga alert (V1); V2 da agent orqali qulflash.
- V1'da timer serverda hisoblanadi, kompyuter qulflanmaydi (operator qo'lda).

### 6.12 promotions 🆕
`GET/POST/PATCH/DELETE /clubs/:clubId/promotions [promotions.*]`, `POST /promotions/validate {code, branch_id, amount}` [C]. Qoidalar: amal qilish muddati, limitlar (umumiy/foydalanuvchi), min summa, max chegirma, filial/qurilma turi/hafta kuni filtri, `funded_by` (klub yoki platforma — moliya hisobotida ajratiladi). Bir bronga bitta promo. Hold paytida "zaxiralanadi", bron bekor bo'lsa qaytariladi.
- **Kim qo'shadi:** klub egasi/admini (`promotions.manage`) — `POST /clubs/:clubId/promotions` (klub hisobidan, faqat shu klubda). Super admin: platforma kodi — `POST /admin/promotions` (`funded_by=PLATFORM`, barcha klublarda); klub nomidan — o'sha `POST /clubs/:clubId/promotions` (klub hisobidan, klub egasi ko'radi/tahrirlaydi; klub yo'q bo'lsa 404; audit `promotion.create` `club_id` bilan).
- `GET /admin/promotions?scope=PLATFORM|CLUBS|ALL&club_id=` [`platform.settings.manage`] — standart `PLATFORM`; klub kodlari `club: {id, name}` bilan. Admin UI: klub paneli `/clubs/:id/promotions`, platforma paneli `/platform/promotions`.

### 6.13 reviews
```http
POST   /reviews                  [C] {booking_id, rating, text, image_file_ids}
GET    /branches/:id/reviews     [P] (?sort=recent|rating)   GET /clubs/:id/reviews [P]
PATCH  /reviews/:id              [C o'ziniki, 24 soat ichida]   DELETE /reviews/:id [C o'ziniki]
POST   /reviews/:id/reply        [reviews.reply]  🆕 klub javobi (sharhni tahrirlay olmaydi)
POST   /reviews/:id/report       [auth] 🆕 shikoyat
PATCH  /admin/reviews/:id        [platform.reviews.moderate] {status: VISIBLE|HIDDEN, note}
```
Qoidalar: faqat `COMPLETED` bron; bron boshiga 1 ta; klub mijoz sharhini tahrirlay/o'chira olmaydi; rating agregatlari (club/branch) o'zgarganda qayta hisoblanadi; matnda telefon/link filtri (spam) 🆕.

### 6.14 favorites
`GET /favorites`, `PUT /favorites/:branchId`, `DELETE /favorites/:branchId` [C].

### 6.15 notifications
```http
GET   /notifications?cursor=       [C/staff]   PATCH /notifications/:id/read   POST /notifications/read-all
GET   /notifications/unread-count
POST  /clubs/:clubId/announcements [announcements.manage]  🆕
POST  /admin/broadcasts            [platform.announcements.manage] 🆕
```
Turlar: `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_EXPIRED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `BOOKING_REMINDER` (start−60 va −15 daq), `SESSION_ENDING_SOON` (−10 daq), `SESSION_ENDED`, `REFUND_COMPLETED`, `CLUB_ANNOUNCEMENT`, `REVIEW_REQUEST`, `NO_SHOW_WARNING`, `CLUB_APPROVED/REJECTED`, `NEW_BOOKING` (staff), `LOW_CASH_DIFFERENCE` (owner), `SUBSCRIPTION_EXPIRING`.
Arxitektura: domain event → outbox → `NotificationService` → shablon (i18n) + foydalanuvchi preferences + kanal (`PUSH` FCM/APNs, `IN_APP`, `EMAIL`, `SMS` (faqat OTP va kritik), `TELEGRAM` (bot orqali bog'lash: `POST /users/me/telegram/link`)) → `notification_deliveries`. Yaroqsiz push token'lar avtomatik o'chiriladi. Ketma-ket takror yuborishdan himoya (dedupe key).

### 6.16 support / complaints 🆕
`POST /support/tickets [C]`, `GET /support/tickets [C o'ziniki | platform.tickets.manage]`, `POST /support/tickets/:id/messages`, `PATCH /admin/support/tickets/:id {status, assigned_to}`. Klub ustidan shikoyat tegishli klubga ko'rinadi (mijoz shaxsiy ma'lumotisiz), platforma xodimi oxirgi qarorni beradi.

**Talab va takliflar (2026-10-13).** Har qanday rol (mijoz, klub egasi/admini, filial admini, operator) murojaat yuboradi → platforma xodimlari (`platform.tickets.manage`: SUPER_ADMIN, SUPPORT) inbox'ida ko'radi va javob beradi.
- `POST /support/tickets {type, subject, body, as?, club_id?, booking_id?}` — `type`: `SUGGESTION` (taklif) | `REQUEST` (talab) | `COMPLAINT` | `QUESTION` | `BUG` | `PAYMENT` | `OTHER`. `as=STAFF` — admin panellardan: `sender_role` xodimning eng yuqori roli snapshot'i, `club_id` o'z grant'idan (boshqa klub nomidan yozib bo'lmaydi, xodim bo'lmasa `FORBIDDEN`). Aks holda `sender_role=CUSTOMER`. Bir foydalanuvchida ochiq murojaat ≤ 10 (`CONFLICT reason=MAX_OPEN_TICKETS`).
- `GET /support/tickets?status&type&awaiting&q` — o'ziniki; platforma `all=true` (+ `sender=CUSTOMER|STAFF`), `last_message_at desc`. `GET /admin/support/stats` → `{awaiting, open}` (menyu badge'i).
- `GET /support/tickets/:id` — `can_reply`, `club_name`, `messages[].sender_name` (javob bergan xodim ismi faqat platformaga). Mijozning klub ustidan murojaatini klub xodimlari (`customers.view`) faqat ko'radi.
- `POST /support/tickets/:id/messages` — faqat murojaat egasi yoki platforma xodimi (`FORBIDDEN`); `CLOSED` → `CONFLICT reason=TICKET_CLOSED`. Platforma javobi: `OPEN→IN_PROGRESS`, `awaiting_reply=false`, egasiga `TICKET_REPLY`. Egasining xabari: `awaiting_reply=true`, `RESOLVED→OPEN`, platforma xodimlariga `TICKET_USER_REPLY`. Yangi murojaat — `TICKET_NEW`.
- `PATCH /admin/support/tickets/:id {status, priority, assigned_to}` — audit; `RESOLVED`/`CLOSED` → egasiga `TICKET_RESOLVED`/`TICKET_CLOSED`.
- Klientlar: web `/support`, `/support/:id` (profil → «Talab va takliflar»; bildirishnoma `ticket_id` → murojaat). Admin: klub/operator panelida `/support`, platforma panelida `/platform/support` (filtrlar, yozishma, javob, status/muhimlik). Mobile — hali yo'q.

### support_tickets.sender_role / awaiting_reply / last_message_at (migratsiya `20261013120000_support_ticket_inbox`)

### 6.17 analytics va reports
```http
GET /analytics/club/overview?from=&to=&branch_id=     [reports.view]  KPI kartalar
GET /analytics/club/revenue?group=day|week|month
GET /analytics/club/occupancy  /peak-hours  /devices/popular  /tariffs/popular
GET /analytics/club/customers  (repeat rate, new vs returning)
GET /analytics/club/cancellations
GET /analytics/club/branches/compare?ids=
GET /analytics/platform/overview  /gmv  /clubs  /growth      [platform.analytics.view]
GET /reports/{bookings|payments|sessions|shifts}?format=json|csv|xlsx   [reports.export]  (katta bo'lsa async job → fayl havolasi)
```
Metrika ta'riflari (analytics aniq farqlashi shart):
- **GMV/Gross booking value** = tasdiqlangan bronlarning `total_amount` yig'indisi.
- **Collected** = `PAID` to'lovlar; **Refunds**; **Net** = collected − refunds.
- **Platform commission** va **Club revenue** = Net − commission.
- **Occupancy** = band daqiqalar / (qurilma × ish vaqti daqiqalari).
- Peak hours: soat × hafta kuni heatmap.
Hisoblash: real-time KPI to'g'ridan-to'g'ri so'rov (indekslar bilan) + Redis cache 30–60 s; og'ir hisobotlar kunlik agregatsiya jadvallari (`daily_branch_stats` 🆕) va nightly job orqali.

### 6.18 subscriptions va komissiya
`GET /clubs/:id/subscription`, `POST /clubs/:id/subscription/change-plan`, `GET /plans [P]`. Admin: `/admin/plans`, `/admin/subscriptions`, `/admin/payouts`. **EntitlementsGuard** 🆕: filial/qurilma/xodim yaratishda va analytics/API/PC-agent kabi feature'larda plan limiti tekshiriladi. Plan tugasa: `PAST_DUE` → grace 7 kun → yangi bron qabul qilish to'xtaydi (mavjud bronlar amal qiladi), ma'lumot o'chirilmaydi. Payout (V1): davr bo'yicha `club_payouts` hisoblanadi, super admin tasdiqlab to'lovni belgilaydi.

### 6.19 files
```http
POST /files/presign   [auth] {entity_type, mime, size}  → {file_id, upload_url, fields}   (to'g'ridan-to'g'ri S3 ga)
POST /files/:id/confirm [auth]   DELETE /files/:id [egasi/permission]
```
Validatsiya: mime allowlist (jpeg/png/webp; hujjatlar uchun pdf), max 10 MB rasm / 15 MB hujjat, magic-byte tekshiruvi, EXIF olib tashlash, `sharp` job orqali variantlar (thumb 256, medium 800, large 1600), CDN URL. Hujjatlar (KYC) **private** bucket, imzolangan qisqa muddatli URL. Bir necha rasm tartibi (`position`).

### 6.20 admin (super admin)
`/admin/clubs`, `/admin/users` (`GET`, `PATCH block/unblock`, foydalanuvchi tafsiloti), `/admin/branches`, `/admin/payments`, `/admin/subscriptions`, `/admin/reviews`, `/admin/support`, `/admin/audit-logs`, `/admin/settings` (`platform_settings`), `/admin/feature-flags`, `/admin/analytics`. Barchasi `platform.*` permission bilan. Impersonation **qilinmaydi**; "foydalanuvchi ko'zi bilan ko'rish" o'rniga read-only tafsilot sahifalari.

### 6.21 audit
`AuditInterceptor` + `@Audit('tariff.update')` dekoratori: kim, nima, qachon, qayerdan (IP/UA), target, old/new value. Muhim amallar: tarif/qurilma/filial/xodim/rol o'zgarishi, sessiya to'xtatish/uzaytirish, refund, klub status o'zgarishi, block/unblock, sozlamalar, login (muvaffaqiyatsiz urinishlar), 2FA o'zgarishi. `GET /clubs/:id/audit-logs [audit.view — owner]`, `GET /admin/audit-logs`.

### 6.22 settings, health, meta
- `GET /meta/app-config [P]` 🆕: `min_app_version` (force update), `maintenance_mode`, feature flags, qo'llab-quvvatlanadigan tillar, hold_minutes.
- `GET /health` (liveness), `GET /health/ready` (DB, Redis, storage).
- `GET /meta/amenities`, `/meta/device-types`.

## 7. Booking engine (eng muhim qism)

### 7.1 Availability hisoblash
Kirish: `branch_id, start_at, end_at (start+duration), filtrlar`.
```sql
SELECT d.*
FROM devices d
WHERE d.branch_id = :branch AND d.deleted_at IS NULL
  AND d.operational_status = 'ACTIVE'
  AND (:type IS NULL OR d.type = :type) AND (:room IS NULL OR d.room_id = :room)
  AND NOT EXISTS (
    SELECT 1 FROM booking_items bi
    JOIN bookings b ON b.id = bi.booking_id
    WHERE bi.device_id = d.id AND bi.active
      AND bi.time_range && tstzrange(:start, :end, '[)')
      AND NOT (b.status = 'PENDING_PAYMENT' AND b.hold_expires_at <= now())
  );
```
Status har qurilma uchun so'ralgan oraliqqa nisbatan: `OCCUPIED` (faol sessiya oraliqda), `RESERVED` (tasdiqlangan/hold bron), `UNAVAILABLE` (maintenance/disabled), aks holda `AVAILABLE`. "Hozir" holati Redis'dagi live snapshot'dan (§9).

### 7.2 Bron yaratish (bitta tranzaksiya)
```text
BEGIN
 1. Idempotency tekshiruv
 2. Validatsiya: klub/filial ACTIVE, ish vaqti + istisnolar, min_advance/max_advance, slot qadami, min/max muddat, mijoz bloklanmaganmi
 3. Eski holdlarni tozalash: UPDATE bookings SET status='EXPIRED' ... WHERE hold_expires_at<=now() AND status='PENDING_PAYMENT'
       AND id IN (shu qurilmalar va oraliq bilan kesishgan)  ; items.active=false
 4. Kategoriya bo'yicha bo'lsa: bo'sh qurilmalarni tanlash (best-fit: kelajakdagi bronlar orasida eng kam "teshik" qoldiradigan qurilma; teng bo'lsa position_order)
    - tanlash paytida SELECT ... FOR UPDATE SKIP LOCKED (qurilma qatori) — parallel so'rovlar bir xil qurilmani olmasligi uchun
 5. PriceEngine → price_breakdown, promo qo'llash
 6. INSERT bookings (PENDING_PAYMENT, hold_expires_at = now()+hold_minutes)
 7. INSERT booking_items (active=true)  ← exclusion constraint oxirgi himoya
    23P01 → ROLLBACK → BOOKING_SLOT_TAKEN (kategoriyada: keyingi nomzod bilan 1–2 marta qayta urinish)
 8. booking_events, outbox('booking.created')
COMMIT
→ BullMQ: 'booking.expire-hold' delayed job (hold_expires_at da)
→ WebSocket: device.status.changed (RESERVED) branch xonasiga
```
Redis qo'shimcha lock: `lock:device:{id}:{slot}` qisqa (10 s) — faqat DB yukini kamaytirish uchun; **haqiqat manbai DB constraint**.

### 7.3 Hold muddati
- Delayed job + zaxira cron (har 15 s): `PENDING_PAYMENT` va `hold_expires_at <= now()` → `EXPIRED`, `items.active=false`, promo qaytariladi, `booking.expired` event.
- Klient `hold_expires_at` ni ko'rsatib, taymer chizadi (server vaqti bilan sinxron).
- To'lov jarayonida (`PROCESSING`) hold uzaytirilishi mumkin (+2 daq, bir marta) 🆕.

### 7.4 Reschedule/extension konfliktlari
Barcha vaqtni o'zgartiruvchi amallar bir xil yo'l bilan: yangi oraliqni `booking_items` ga UPDATE qiladi → constraint xatosi = konflikt.

## 8. Vaqt va ish vaqti
Barcha hisob-kitoblar filial `timezone` da (Luxon/date-fns-tz). `working_hours` + `branch_hours_exceptions` → `isOpen(branch, at)` va `nextOpenWindow`. Tungi ish vaqti (kesib o'tuvchi) to'g'ri ishlashi kerak: 22:00–02:00 bron keyingi kunga o'tadi; bron ish vaqti ichida tugashi shart (yoki `allow_past_closing` sozlamasi).

## 9. WebSocket (`/ws`, Socket.IO + Redis adapter)
**Ulanish:** JWT handshake (`auth.token`); token muddati tugasa klient `refresh` qilib qayta ulanadi.
**Xonalar:** `user:{id}` (customer), `branch:{id}` (staff live board — `sessions.view` bilan), `club:{id}` (owner), `platform` (super admin). Obuna server tomonidan permission bilan tekshiriladi; klient xohlagan xonaga qo'shila olmaydi.
**Eventlar (server → client):**
```text
device.status.changed   {device_id, operational_status, occupancy, booking_id?, session_id?, remaining_seconds?}
booking.created | booking.updated | booking.cancelled | booking.expired
session.started | session.updated | session.ended   {session_id, expected_end_at, server_time}
payment.completed | payment.failed
notification.created
```
**Klient → server:** `subscribe {room}`, `unsubscribe`, `ping`. Buyruqlar (sessiya boshlash va h.k.) faqat REST orqali (audit va idempotentlik uchun).
**Ishonchlilik:** har event `seq` va `at` bilan; reconnect'da klient `GET /branches/:id/live` orqali snapshot oladi (yo'qolgan eventlar o'rniga); heartbeat 25 s; backpressure: `session.updated` throttling (30 s).
**Live snapshot:** Redis hash `live:branch:{id}` — har qurilma uchun occupancy/qolgan vaqt; DB o'zgarishida (outbox handler) yangilanadi.

## 10. Background jobs (BullMQ)
| Queue/Job | Trigger | Vazifa |
|---|---|---|
| `booking.expire-hold` | delayed | Hold tugaganda EXPIRED |
| `booking.sweeper` | cron 15s | Qolib ketgan holdlar |
| `booking.no-show` | cron 1 daq | Grace o'tgan CONFIRMED → NO_SHOW |
| `booking.reminder` | delayed | Start−60/−15 eslatma |
| `session.ending-soon` | delayed | −10 daq xabar; overtime alert |
| `notification.dispatch` | event | Kanal bo'yicha yuborish, retry (exp. backoff) |
| `payment.reconcile` | cron 1 soat | Provayder bilan solishtirish |
| `payment.refund` | event | Refund'ni provayderga yuborish, retry |
| `outbox.publisher` | cron 1s | Outbox → eventlar |
| `analytics.aggregate` | nightly | `daily_branch_stats`, rating recalculation |
| `files.process-image` | event | Variantlar, EXIF tozalash |
| `report.generate` | event | Katta CSV/XLSX |
| `subscription.check` | nightly | Muddati tugash, PAST_DUE |
| `user.export` / `user.anonymize` | event | Maxfiylik so'rovlari |
| `cleanup` | nightly | Eski OTP, idempotency, outbox |
Barcha joblar idempotent; dead-letter queue va monitoring (Bull Board, faqat ichki).

## 11. Xavfsizlik
Argon2id · JWT rotation + reuse detection · RBAC + tenancy filtr (+RLS) · DTO whitelist (`forbidNonWhitelisted`) · rate limiting · CORS allowlist (web/admin domenlari) · Helmet · CSRF (cookie ishlatilsa; Bearer bilan kerak emas) · SQL injection (parametrlangan so'rovlar, raw SQL faqat bind bilan) · XSS (matnlarni sanitize: sharh/tavsif) · file upload validatsiya (mime+magic bytes, o'lcham, antivirus ixtiyoriy) · payment webhook imzo + idempotentlik · HTTPS/HSTS · sirlar env/secret manager'da · audit log · brute-force lockout (staff) · PII maskalash loglarda · 2FA (staff/super admin) · dependency scanning (CI) · OWASP API Top 10 checklist. Qoida: **klub admini boshqa klub ma'lumotini hech qachon ko'rmaydi**.
Maxfiylik 🆕: Ma'lumotlarni qayta ishlash uchun rozilik (consents), akkauntni o'chirish/eksport, mijoz telefoni operatorga qisman maskalangan (`+998 90 *** ** 12`), keraksiz PII yig'ilmaydi. O'zbekiston shaxsiy ma'lumotlar to'g'risidagi qonun talablari (jumladan ma'lumotlarni saqlash joyi) bo'yicha huquqshunos bilan tekshirish tavsiya etiladi.

## 12. Kuzatuv, ishlash, deploy
- Log: Pino JSON, `request_id`, `user_id`, `club_id`; sezgir maydonlar redaksiya.
- Metrikalar (Prometheus): so'rov latency, DB pool, queue chuqurligi, booking success/conflict nisbati, payment webhook xatolari, WebSocket ulanishlar.
- Sentry, alertlar: to'lov nomuvofiqligi, queue backlog, 5xx, DB replikatsiya.
- Maqsad: oddiy so'rovlar p95 < 300 ms; nearby+search < 200 ms (kesh bilan); booking create < 500 ms.
- **Env:** `NODE_ENV, PORT, DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, QR_HMAC_SECRET, STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET/PUBLIC_URL, SMS_PROVIDER/SMS_API_*, FCM_CREDENTIALS, TELEGRAM_BOT_TOKEN, PAYME_*, CLICK_*, SENTRY_DSN, CORS_ORIGINS, APP_TIMEZONE_DEFAULT, SUPER_ADMIN_EMAIL/PASSWORD (seed)`. `.env.example` yangilab boriladi.
- Docker: `postgres(postgis)`, `redis`, `minio`, `api`; prod: Nginx + api (bir nechta replika, Socket.IO sticky yoki Redis adapter) + managed PG.

## 13. Test strategiyasi 🆕
- Unit: PriceEngine, RefundCalculator, working-hours, permission resolver, QR imzo.
- Integration (Testcontainers: PG+PostGIS, Redis): booking yaratish, hold expiry, cancel/refund, reschedule.
- **Concurrency testlar (majburiy):** 50 parallel `POST /bookings` bir xil qurilma/vaqtga → aynan 1 muvaffaqiyat; kategoriya bo'yicha N qurilmaga N+k so'rov → N muvaffaqiyat; hold tugash poygasi; payment webhook takror (10×) → 1 marta ta'sir.
- E2E: to'liq oqim (register → nearby → booking → pay(mock) → check-in → session → stop → review).
- Security: har modul uchun cross-club scope testlari; rate limit; token reuse.
- Contract: OpenAPI'dan generatsiya qilingan klientlar bilan (breaking change tekshiruvi CI'da).
- Load (k6): nearby, availability, booking create; hold spike.

## 14. Phase'lar va checklist

Har bir phase'da: **API / Web / Mobile** vazifalari va Acceptance. (`[ ]` — bajarilganda belgilanadi.)

**PHASE 0 — Foundation**
- [x] Monorepo (pnpm workspaces), CI (lint, test, build), docker-compose (pg+postgis, redis; minio → Phase 2)
- [x] API: config, Prisma, health, global filter/interceptor (response format), Swagger, logger, request-id
- [x] Web/Admin: Next.js + Tailwind + API client (shadcn — UI kerak bo'lganda); Mobile: Flutter skeleton (core, theme, router, dio)
- Acceptance: hamma ilova lokal ishga tushadi, DB ulanadi, CI yashil.

**PHASE 1 — Auth & RBAC**
- [x] users, OTP (Telegram bot; dev'da 000000), staff login, JWT+refresh rotation, roles/permissions seed, guards, `/auth/me`
- [x] invitations (Phase 2 bilan birga)
- [ ] 2FA (staff) — keyinga qoldirildi
- [x] Web: customer login/register; admin login. Mobile: login/OTP/profil
- Acceptance: customer, staff, super admin login qila oladi; ruxsatsiz resurs 401/403; refresh reuse bloklanadi.

**PHASE 2 — Club & Branch**
- [x] clubs (+ariza/hujjat/approval), branches, rooms, staff/invitations
- [ ] files (presign) — MinIO docker-compose'ga qo'shilgach; hozircha hujjat/rasm URL orqali
- [x] Admin: klub onboarding wizard (OTP login → klub → filial → moderatsiya); super admin: approval navbati
- [x] e2e: `apps/api/test/clubs.e2e-spec.ts` (scope, taklif, approval)
- Acceptance: owner klub ochadi, bir nechta filial, admin/operator biriktiradi; boshqa klub ma'lumotini ko'ra olmaydi.

**PHASE 3 — Devices & Tariffs**
- [x] devices, categories, maintenance, tariffs, PriceEngine + price-quote (API + admin: Qurilmalar, Tariflar, narx kalkulyatori)
- [x] layout: admin `/clubs/[id]/layout` (drag & drop, grid) + `/live` da "Xarita" ko'rinishi
- Acceptance: operator barcha PC'larni ko'radi; statuslar ishlaydi; tarif oynalari to'g'ri narx beradi (unit testlar).

**PHASE 4 — Customer Discovery**
- [x] nearby (PostGIS), search, filters, map bbox, club/branch details, summary
- [x] Mobile: Home/Map/List/Details; Web: /clubs, /map, /clubs/[id] (filial id — slug klublararo takrorlanishi mumkin)
- Acceptance: yaqin filiallar to'g'ri masofa bilan; markerlar filial bo'yicha.

**PHASE 5 — Booking Engine**
- [x] availability, hold, create, cancel, reschedule, expiry jobs, exclusion constraint, promo (asosiy) — API
- [x] Web/Mobile: bron vidjeti (sana → davomiylik → vaqt → qurilma), bronlarim, bron tafsiloti (QR/kod), DEMO to'lov, bekor qilish
- [x] UI: vaqtni ko'chirish (`can_reschedule`, slots `exclude_booking_id`), promokod maydoni (web + mobile)
- Acceptance: bir qurilma/vaqt ikki marta bron qilinmaydi; muddati o'tgan hold bo'shaydi; lifecycle ishlaydi.

**PHASE 6 — Payment**
- [x] PaymentProvider abstraksiyasi (`payments/providers/`): DEMO, **Payme** (merchant JSON-RPC `POST /webhooks/payments/payme`), **Click** (`/webhooks/payments/click/prepare|complete` + reversal API); `GET /payments/providers`; webhook idempotent (`payment_events`); refund provayder orqali (Payme — kabinetdan, CancelTransaction bilan yopiladi); ledger; payment-after-expiry; reconciliation job (10 daq)
- [x] Web/Mobile: provayder tanlash, tashqi checkout, qaytgandan keyin holatni tekshirish
- [ ] Haqiqiy merchant kalitlari bilan sandbox sinovi (Payme test kabineti, Click test servisi) — kalitlar `.env` ga berilgach
- Acceptance: muvaffaqiyatli to'lov bronni tasdiqlaydi; xato tasdiqlamaydi; webhook takror ta'sir qilmaydi.

**PHASE 7 — Sessions & Live**
- [x] session engine, check-in (kod/QR matni), walk-in, extend, pause, move, overtime, WebSocket live board (Socket.IO `/api/v1/ws`), kassa smenasi
- [x] Admin: `/live` operator paneli; Web: bosh sahifada mijozning faol sessiyasi
- [x] Kamera orqali QR skanerlash (admin `/live`, BarcodeDetector/jsQR); mobile faol sessiya ekrani (`/session`)
- Acceptance: operator start/stop qiladi; customer active session ko'radi; PC status real-time yangilanadi.

**PHASE 8 — Notifications**
- [x] in-app, Telegram kanali (bot orqali bog'langan telefonlar), eslatmalar (bron −60/−15, sessiya −10, sharh so'rovi), preferences (`GET/PATCH /users/me/notification-preferences`), dedupe (`notifications.dedupe_key`)
- [x] Web: qo'ng'iroqcha + `/notifications` + profilda sozlamalar; Mobile: bildirishnomalar ekrani + sozlamalar
- [x] push (FCM HTTP v1 adapteri, `FCM_SERVICE_ACCOUNT` berilganda yoqiladi; yaroqsiz token'lar o'chiriladi)
- [ ] mobile'da `firebase_messaging` + token ro'yxatdan o'tkazish (Firebase loyihasi/`google-services.json` kerak); outbox; email
- Acceptance: tasdiq, bekor, start-soon, session-ending xabarlari yuboriladi.

**PHASE 9 — Reviews & Analytics**
- [x] API: reviews (+moderatsiya, reply, shikoyat dedupe), favorites, analytics, reports CSV, subscriptions/plan limitlari, payouts (`/admin/payouts`, `/clubs/:clubId/payouts`)
- [x] Admin: klub analitikasi (KPI, daromad, peak-hours, qurilmalar, filiallar, CSV) + payouts, klub sharhlari/javob; platforma analitikasi, sharh moderatsiyasi, payouts
- [x] Web/Mobile: bronga sharh (24 soat tahrirlash), filial sharhlari (javob, shikoyat), sevimlilar
- [x] xlsx eksport (`/reports/:kind?format=xlsx`), `daily_branch_stats` (soatlik job, 90 kun backfill, `GET /analytics/club/daily`), "mening sharhlarim", filialda `is_favorite`
- Acceptance: KPI qiymatlari ledger bilan mos; eksport ishlaydi; plan limitlari majburlanadi.

**PHASE 10 — Production**
- [ ] Docker/Nginx/SSL, CI/CD, monitoring, Sentry, backup+restore sinovi, security audit, k6 load test, deploy runbook, PC agent (V2) boshlash
- Acceptance: reproducible deploy, backuplardan tiklash tekshirilgan.

## 15. Definition of Done (feature)
Migratsiya · DTO validatsiya · permission+scope · Swagger · idempotentlik (kerak joyda) · audit · testlar (unit+e2e+scope; concurrency kerak bo'lsa) · xato kodlari hujjatlangan · OpenAPI klient yangilangan · web/mobile UI holatlari (loading/empty/error) · commit.

## Xona sxemasi va o'rindiq tanlash (2026-10-01)
- `PATCH /rooms/:id` — `grid_cols`, `grid_rows` (2..40): xona sxemasi o'lchami (katak).
- `PUT /branches/:id/layout` — `items[].room_id` (ixtiyoriy, null — xonasiz): qurilmani boshqa xonaga ko'chirish; xona shu filialniki bo'lishi shart.
- `PUT /rooms/:id/tariff` `{ tariff_id | null }` (`tariffs.update`) — xonaga bitta tarif; eski xona tarifi xonadan ajratilib nofaol qilinadi, tanlangan tarif faqat shu xonaga bog'lanadi.
- `GET /branches/:id/availability` javobida `rooms[]`: `grid_cols/rows`, `tariff`, `price_from`, `total_count`, `available_count`; qurilmalarda `room` + `layout {x,y}` — klient o'rindiq sxemasini chizadi.
- `POST /bookings` — bir bronda ko'pi bilan 5 o'rindiq (`items` ≤ 5).
- `PATCH /rooms/:id` — `decor: [{kind: ENTRANCE|CASHIER|WALL|AISLE|TV|WC, x, y}]` (sxema bezaklari).
- Availability `rooms[].decor` va `rooms[].together["2".."5"] = { device_ids, adjacent } | null` — do'stlar uchun API tanlagan yonma-yon joylar (`common/domain/seat-groups.ts`: avval bir qatorda ketma-ket, bo'lmasa eng yaqin guruh).
- `GET /branches/:id/live` javobida `rooms[]` (grid + decor) — operator jonli zali mijoz ko'radigan sxema bilan bir xil.

## Kartaga o'tkazma, qaytarish shartlari va chipta (2026-10-02)
**Qaror:** mijoz bron uchun pulni to'g'ridan-to'g'ri klub egasining kartasiga o'tkazadi (P2P). **Yangilandi (2026-10-13):** bron mijoz yuborgan zahoti tasdiqlanadi (kutish yo'q), klub to'lovni keyin tekshiradi. Pul platformadan o'tmaydi — komissiya va payout'ga kirmaydi (naqd kabi). Payme/Click/DEMO provayderlari zaxira sifatida qoladi.
- `GET|PATCH /clubs/:id/settings` — `transfer_card: {number (16 raqam), holder} | null` (null — o'chirish). Karta audit log'ga maskalangan holda yoziladi; `GET /clubs/:id` da faqat `has_transfer_card`.
- `GET /branches/:idOrSlug` — `cancellation_policy` va `payment_options: {card_transfer, pay_at_club}`; karta raqami ommaviy sahifada yo'q.
- `POST /bookings` — `price_snapshot.cancellation_policy`: bron paytidagi siyosat saqlanadi; cancel va no-show refundi shu snapshot bo'yicha (klub keyin o'zgartirsa ham mijoz rozi bo'lgan shart amal qiladi).
- `GET /bookings/:id` — `cancellation_policy` (snapshot), `refund_preview {percent, amount}` (hozir bekor qilinsa), `transfer {card_number, card_holder, amount, pending, rejected} | null` (karta faqat to'lanmagan bron egasiga).
- O'tkazma oqimi (2026-10-13): mijoz `POST /payments/transfer {booking_id, payer_card_last4, payer_name?}` → payment `PROCESSING`, bron `PENDING_PAYMENT` bo'lsa **darhol `CONFIRMED`** (hold o'chiriladi, chipta/QR faol, mijozga `BOOKING_CONFIRMED`), xodimlarga `TRANSFER_PENDING` + realtime `payment.transfer_pending`. Bron kodi bank ilovasida izoh sifatida (ixtiyoriy) ko'rsatiladi. Bitta bronda bitta ochiq o'tkazma (`CONFLICT reason=TRANSFER_PENDING`). Operator tasdiqlasa — `handleEvent` (PAID), mijozga `TRANSFER_CONFIRMED` ("To'lovingiz operator tomonidan tasdiqlandi"; `BOOKING_CONFIRMED` takrorlanmaydi). Rad etish → `FAILED`, bron `CONFIRMED`/`UNPAID` qoladi (klubda to'lash kabi), mijozga `TRANSFER_REJECTED`, qayta yuborish mumkin; soxta o'tkazmada xodim bronni bekor qiladi. `payments.transfer_confirm_minutes` endi ishlatilmaydi.
- O'tkazma kutilayotganda mijoz bronni bekor qila olmaydi (`BOOKING_NOT_CANCELLABLE reason=TRANSFER_PENDING`); xodim qila oladi.
- **To'lov havolasi va chek (2026-10-16):** klub kartaga qo'shimcha (yoki o'rniga) to'lov havolasini kiritadi — `PATCH /clubs/:id/settings {transfer_link: {url (faqat https), label?} | null, transfer_receipt_required?: boolean}` (Click/Payme/bank QR havolasi). `GET /bookings/:id` → `transfer {card_number|null, card_holder, link {url,label}|null, receipt_required, amount, pending (receipt_url bilan), rejected}`; `payment_options.card_transfer` — karta yoki havola bo'lsa `true`. Mijoz: `POST /payments/transfer {booking_id, channel: CARD|LINK, payer_card_last4 (CARD uchun majburiy), receipt_file_id?}` — chek avval `POST /files purpose=RECEIPT` bilan yuklanadi, faqat egasining, bir marta biriktiriladi (`VALIDATION_ERROR reason=RECEIPT_INVALID`); klub talab qilsa majburiy (`reason=RECEIPT_REQUIRED`); o'chiq kanal → `PAYMENT_FAILED reason=TRANSFER_CHANNEL_DISABLED`. `provider_payload` += `channel, link_label, receipt_file_id`. Xodim ro'yxati (`GET /payments?method=CARD_TRANSFER`) har qatorda `receipt_url`. Operator baribir qo'lda tasdiqlaydi.
- `CARD_TRANSFER` to'lov refundi `PENDING` yaratiladi (mijozga `REFUND_PENDING`), klub pulni qaytargach `POST /refunds/:id/complete` → `REFUND_COMPLETED`.
- Mijoz web/mobile: bron sahifasi **chipta** ko'rinishida (klub, manzil, sana/vaqt, o'rindiqlar va narxlari, summalar, to'lov usuli, kod + kichik QR — faqat CONFIRMED/CHECKED_IN), pastida qaytarish shartlari va "hozir bekor qilsangiz" summasi. Bron vidjetida to'lovdan oldin shartlar ko'rsatiladi.
- Admin: klub paneli `/clubs/:id/payments` (karta, klubda to'lash, siyosat muharriri + oldindan ko'rish, o'tkazmalar va qaytarishlar); operator pulti `/live` da filial bo'yicha shu inbox.

### clubs.transfer_card_number / transfer_card_holder (migratsiya `20261002120000_club_transfer_card`)
### payments.method += CARD_TRANSFER (migratsiya `20261002121000_payment_method_card_transfer`)

## Telegram bot — mijoz self-service (2026-10-02)
Bot (`@<TELEGRAM_BOT_USERNAME>`) endi faqat OTP emas: bog'langan raqam (`telegram_links.chat_id` → `users.phone`, `status=ACTIVE`) egasi botdan o'z ma'lumotlarini ko'radi. Yangi endpoint yo'q — bot `BookingsService`/`NotificationsService`/`EngagementService` ni mijoz sifatida chaqiradi (`Caller.grants = []`, `loadFor` scope tekshiruvi: boshqa mijoz broni → «topilmadi»).
- **Kod:** `apps/api/src/modules/telegram/bot/` (`TelegramBotService`, matnlar `bot.i18n.ts` uz/ru/en — `users.language` bo'yicha). /start, kontakt va bog'lanmagan chat — `OtpService`; bog'langach (`TelegramService.onLinked`) va `/start` (nonce'siz) — salom + doimiy menyu.
- **Menyu / buyruqlar:** 🎟 Chiptalarim `/tickets` (UPCOMING, 10 ta) · 📜 Tarix `/history` (PAST, sahifa 6) · 👤 Profilim `/profile` (ism, telefon, email, til, bronlar statistikasi, jami to'langan, no-show, `booking_blocked_until`, ⭐ sevimli klublar) · 🔔 Bildirishnomalar `/notifications` (oxirgi 8, «hammasini o'qilgan qilish») · ⚙️ Sozlamalar `/settings` (til, `telegram/reminders/announcements` prefs) · ❓ Yordam `/help`. `setMyCommands` bootstrap'da har til uchun.
- **Chipta:** tafsilot (klub, manzil, joylar, vaqt filial TZ'da, summa/to'langan/qarz, check-in oynasi, kartaga o'tkazma rekvizitlari yoki «tekshirilmoqda», qaytarish foizi) + tugmalar: 📱 QR (`signQr` payload → PNG, `sendPhoto`, `protect_content`), ❌ Bekor qilish (tasdiqlash bosqichi → `BookingsService.cancel`, siyosat bo'yicha refund; o'tkazma tekshirilayotganda taqiqlanadi), 📍 Yandex xarita, 🌐 saytda ochish (`PUBLIC_WEB_URL` https bo'lsa).
- **callback_data:** `tl`, `t:<id>:<back>`, `q:<id>`, `c:<id>:<back>`, `cy:<id>:<back>`, `h:<page>`, `p`, `fv`, `n`, `nr`, `s`, `sl`, `lg:<uz|ru|en>`, `st:<pref>` (`back`: `u` — faol chiptalar, raqam — tarix sahifasi). `allowed_updates: [message, callback_query]`.
- **Bildirishnomalar:** mijoz bron turlari (BOOKING_*, PAYMENT_*, TRANSFER_REJECTED, REFUND_*, SESSION_*, NO_SHOW_WARNING) Telegram xabariga «🎟 Chiptani ko'rish» tugmasi qo'shiladi; OTP kod xabari endi menyu klaviaturasini o'chirmaydi.
- **Cheklov:** 40 amal/daqiqa/chat (Redis `tg:bot:rl:<chat>`). Env: `PUBLIC_WEB_URL?`.

## Konsol arendasi — uyga PS5/PS4/Xbox (2026-10-02)
**Qaror:** klub o'z konsolini mijozga uyga soatlik va/yoki kunlik beradi. Bron (`bookings`) dan alohida modul (`apps/api/src/modules/rentals`): qurilma klub ichidagi o'rindiq emas, ko'chma inventar — `rental_items.quantity` dona bilan hisoblanadi. Onlayn to'lov yo'q: so'rov → klub tasdiqlaydi → topshirishda klubda to'lanadi (naqd/terminal — ochiq smena orqali, kartaga o'tkazma — operator qayd etadi) va garov olinadi.
- **Holatlar:** `REQUESTED → CONFIRMED → ACTIVE (topshirildi) → RETURNED`; `CANCELLED` (mijoz/xodim, faqat REQUESTED/CONFIRMED), `REJECTED` (xodim, sabab bilan), `EXPIRED` (sweeper). Har o'tish tranzaksiyada `updateMany where status IN (...)` — parallel bosishda biri `CONFLICT reason=STATUS_CHANGED`.
- **Ommaviy:** `GET /rental-items?branch_id&club_id&type&rate_unit=HOUR|DAY&delivery=true&q` (faqat faol klub/filial, `available_now`), `GET /rental-items/:id` (+ `branch.is_open/open_until`), `GET /rental-items/:id/slots?date&rate_unit&units&quantity` (30 daq qadam; olish va qaytarish paytida filial ochiq + yetarli bo'sh dona), `GET /rental-items/:id/quote?rate_unit&units&start_at&quantity&fulfillment`.
- **Narx:** `dona narxi × units × quantity` (+ `delivery_fee` DELIVERY bo'lsa). Garov `deposit_amount × quantity` to'lov summasiga kirmaydi. Yaratishda `item_snapshot` (nom, tur, narxlar, garov) saqlanadi — kechikish haqi tavsiyasi shu bo'yicha.
- **Mijoz:** `POST /rentals` (Idempotency-Key; `item_id, rate_unit, units, start_at, quantity?, fulfillment?, delivery_address?, contact_phone?, notes?`) → `REQUESTED`; `GET /rentals?status=OPEN|HISTORY`, `GET /rentals/:id`, `POST /rentals/:id/cancel`. Cheklovlar: `min_hours`, `max_days`, 60 kun oldindan, ochiq arenda ≤ 3, `booking_blocked_until`. Bir konsolga parallel so'rovlar `SELECT ... FOR UPDATE` (rental_items qatori) bilan navbatlanadi — dona sonidan oshmaydi (`DEVICE_NOT_AVAILABLE reason=NO_UNITS`).
- **Xato sabablari (`details.reason`):** `MIN_HOURS`, `MAX_DAYS`, `UNIT_NOT_OFFERED`, `NO_DELIVERY`, `ADDRESS_REQUIRED`, `PICKUP_CLOSED`/`RETURN_CLOSED` (`BOOKING_OUTSIDE_WORKING_HOURS`), `NO_UNITS`, `MAX_OPEN_RENTALS` (`CONFLICT`).
- **Klub:** `GET /branches/:id/rental-items/manage` (`rentals.view`; `available_now`, `requested_count`), `POST /branches/:id/rental-items`, `PATCH|DELETE /rental-items/:id` (`rentals.manage`; ochiq arendasi bor konsol o'chirilmaydi — `CONFLICT reason=OPEN_RENTALS`). `GET /rentals?staff=true&branch_id&status=OPEN|OVERDUE|HISTORY&q`. `POST /rentals/:id/confirm | reject {reason} | handover {payment_method: CASH|TERMINAL|CARD_TRANSFER|LATER, deposit_collected} | return {late_fee?, payment_method?, deposit: RETURNED|KEPT, note?}` (`rentals.process`, Idempotency-Key, audit). Qaytarishda qoldiq to'lanmasa yopilmaydi; garov `HELD` bo'lsa taqdiri majburiy.
- **To'lov:** `payments.rental_id`; `FinanceService.syncRentalPayment` (`paid_amount`, `payment_status`), naqd/terminal komissiyasiz (klub kassasi). `GET /payments` da `booking_code` arenda kodi (`RN-XXXXXX`) bilan ham to'ladi.
- **Kechikish:** `ACTIVE` va `end_at + 15 daq` o'tgan — `is_overdue`, `overdue_minutes`, `suggested_late_fee` (soatlik narx × boshlangan soatlar, bo'lmasa kunlik × kunlar, × dona).
- **Sweeper (60 s):** tasdiqlanmagan so'rov boshlanishdan 30 daq keyin, olib ketilmagan arenda muddatning yarmi (≤ 6 soat) o'tib → `EXPIRED`; tugashiga 1 soat qolganda `RENTAL_ENDING_SOON` (reminders prefs); kechiksa mijozga `RENTAL_OVERDUE`, xodimlarga `RENTAL_OVERDUE_STAFF` (dedupe — bir marta).
- **Bildirishnomalar:** `RENTAL_REQUESTED`, `NEW_RENTAL` (xodimlar), `RENTAL_CONFIRMED`, `RENTAL_REJECTED`, `RENTAL_CANCELLED`, `RENTAL_HANDED_OVER`, `RENTAL_RETURNED`, `RENTAL_EXPIRED`. Realtime: `rental.created`, `rental.updated` (`branch:<id>` va mijoz xonasi).
- **Ruxsatlar:** `rentals.view`, `rentals.manage`, `rentals.process`. OPERATOR: view + process; BRANCH_ADMIN va yuqori: + manage.
- **Klientlar:** web `/rentals` (katalog), `/rentals/:id` (konsol + so'rov formasi), `/my-rentals`, `/my-rentals/:id`; filial sahifasida "Uyga arenda" bo'limi. Mobile `features/rentals/` (xuddi shu ekranlar, bosh sahifa va filial sahifasidan kirish). Admin: klub/operator panelida `/clubs/:id/rentals` — so'rovlar (faol/kechikkan/tarix, tasdiqlash → topshirish → qaytarish) va konsollar inventari.

## Ijtimoiy tarmoqlar — mijozlarga "obuna bo'ling" taklifi (2026-10-13)
**Qaror:** majburiy popup emas — yumshoq taklif. `platform_settings.key = 'social'` → `{links: {instagram?, telegram?, tiktok?, youtube?, facebook?}, promo_enabled}`.
- `GET /social` (ommaviy) — havolalar va `promo_enabled`. `GET|PUT /admin/settings/social` (`platform.settings.manage`, audit `admin.settings.social`). Havola faqat `https://` va o'z domeniga (`instagram.com`, `t.me`/`telegram.me`, `tiktok.com`, `youtube.com`/`youtu.be`, `facebook.com`/`fb.com`; aks holda `VALIDATION_ERROR reason=SOCIAL_HOST`); bo'sh qator — o'chirish. Havola bo'lmasa `promo_enabled` avtomatik `false`.
- Web: bosh sahifa footerida ikonkalar (doim); `promo_enabled` bo'lsa bosh sahifada banner (yopilsa 7 kun ko'rinmaydi, `localStorage gc.social.dismissed`) va tasdiqlangan bron chiptasi / arenda (CONFIRMED, ACTIVE) sahifasida karta. Admin: platforma panelida `/platform/social`. Mobile — hali yo'q.

## VIP — ochiq vaqt (2026-10-13)
**Qaror:** ilovadan (web/mobile/bot) faqat aniq vaqtli bron. VIP — mijoz klubga kelib aytadi, **operator** pultdan tugash vaqtisiz sessiya ochadi; mijoz o'ynab bo'lgach haqiqiy vaqt bo'yicha to'laydi. Operator yopmaguncha bu qurilmani ilovadan bron qilib bo'lmaydi.
- `POST /bookings/walk-in {open: true, device_ids, guest_name?, guest_phone?}` — `duration_minutes` kerak emas, to'lov olinmaydi; bron `WALK_IN`, summa 0, sessiya darhol `is_open=true`, `expected_end_at=null`. Qurilma `booking_items` oralig'i bilan band: shu qurilmada oldindan qilingan keyingi bron bo'lsa uning boshlanishi − buffer gacha (`sessions.must_end_by`), bo'lmasa `max_advance_days + 1` kungacha — exclusion constraint parallel onlayn bronni ham DB darajasida to'xtatadi; `BookingsService.busy` esa ochiq sessiyali qurilmani istalgan kelajak vaqt uchun band deb qaytaradi. Keyingi bron 15 daqiqadan yaqin bo'lsa — `BOOKING_SLOT_TAKEN reason=NEXT_BOOKING_SOON`.
- Hisob (`common/domain/open-session.ts`): o'ynalgan = o'tgan − pauza, boshlangan daqiqa to'liq, `booking_settings.open_round_minutes` (default 5) qadamiga yuqoriga, kamida `open_min_minutes` (default 30); summa tarif oynalari bo'yicha (`PricingService.quote`, boshlangan vaqtdan).
- `GET /sessions/:id`, `/sessions/active`, `/branches/:id/live` — ochiq sessiyada `is_open`, `must_end_by`, `elapsed_seconds`, `accrued_amount` (server hisobi), `amount_due` ga qo'shilgan; live'da `paused_at`, `total_paused_seconds` (klient taymeri uchun).
- `POST /sessions/:id/stop {payment_method?: CASH|TERMINAL|LATER}` — ochiq sessiyada: `session_charges.type=OPEN_TIME`, bron summasi/oxiri yangilanadi, qurilma bo'shaydi, CASH/TERMINAL bo'lsa qarz ochiq smenaga yoziladi (`SHIFT_REQUIRED`), audit `session.stop_open`; javobda `open_minutes`, `open_amount`, `paid_amount`. `extend` — `CONFLICT reason=OPEN_SESSION`; `pause/resume` — pauza hisobdan chiqariladi; `move` — chegara yangi qurilmaning keyingi broni bo'yicha qayta hisoblanadi.
- Bildirishnomalar: `SESSION_STARTED_OPEN`, `SESSION_ENDED_OPEN` (mijoz), `must_end_by` dan 15 daqiqa oldin xodimlarga `OPEN_SESSION_LIMIT_SOON` va mijozga `SESSION_ENDING_SOON`.
- Klientlar: operator pulti — walk-in formasida «VIP — ochiq vaqt», kartada VIP belgisi + oldinga sanaydigan taymer + hozirgacha summa + chegara; panelda «VIP sessiyani yopish» (to'lov usuli bilan). Mijoz web — faol sessiya kartasida VIP taymer va summa, chiptada «VIP ∞»; Telegram bot chiptasida «–… (VIP)». Mobile — hali yo'q.

### sessions.is_open / must_end_by (migratsiya `20261013150000_open_sessions`), session_charges.type += OPEN_TIME (`20261013151000_session_charge_open_time`)

## Paket narxlar — "3 soat 30 ming" (2026-10-13)
**Qaror:** soatlik tarifdan tashqari klub qat'iy davomiylik + qat'iy narxli **paket** sotadi (masalan, oddiy 1 soat 12 000, paket 3 soat 30 000; tungi paket 22:00–08:00 oralig'ida 8 soat 50 000). Paket tarifga tegishli (`tariff_packages`, `02-DATABASE.md` §3.4): qaysi qurilmalarga amal qilishi tarifning o'zi (device → room → category → device_type → filial) bilan aniqlanadi.
- **Boshqaruv:** `POST /branches/:id/tariffs`, `PATCH /tariffs/:id` — `packages[]: {id?, name, duration_minutes, price, days_of_week?, start_time?, end_time?, is_active?}`. `id` bor — yangilanadi, yangi — yaratiladi, ro'yxatda yo'q eskisi — soft-delete (`packages` berilmasa tegilmaydi). Tarif javobida `packages[]`. Audit `tariff.update` ichida.
- **Ommaviy:** `GET /branches/:id/packages` — faol paketlar: `id, name, duration_minutes, price, days_of_week, start_time, end_time, tariff {id, name, price_per_hour, room_id, category_id, device_type}`, `regular_amount` (= `ceil(price_per_hour × duration / 60)`, tejash ko'rsatish uchun taxminiy, tarif oynalarisiz). `GET /branches/:id/tariffs` (ommaviy) da ham `packages[]`.
- **Amal qilish qoidasi** (`common/domain/price-engine.ts` `quotePackage`): (1) qurilma uchun boshlanish paytida tanlangan tarif = paket tarifi; (2) boshlanish vaqti (filial TZ) paket oynasi ichida — oyna boshlangan kun `days_of_week` da (kesib o'tuvchi oynada kechagi kun); tugash oyna ichida bo'lishi shart emas; (3) davomiylik doim `duration_minutes` (mijoz o'zgartira olmaydi); tarif `min/max_minutes` tekshirilmaydi. Narx = `price` (har qurilma uchun). Segment: `{rule: 'PACKAGE', package_id, minutes, amount, price_per_hour: tarif narxi}` + `regular_amount` (oddiy tarif bo'yicha shu oraliq narxi).
- **Xatolar:** `VALIDATION_ERROR field=package_id reason=PACKAGE_NOT_FOUND | PACKAGE_DEVICE` (qurilma tarifiga tegishli emas) `| PACKAGE_TIME` (oynadan tashqari) `| PACKAGE_DURATION` (paketli bron davomiyligini ko'chirishda o'zgartirish).
- **Bron:** `POST /bookings {package_id?}` — berilsa `duration_minutes` paketnikiga tenglanadi; har o'rindiq paket narxida; promo subtotal'ga odatdagidek qo'llanadi. `price_snapshot.package = {id, name, duration_minutes, price, tariff_id, days_of_week, start_time, end_time}` — keyin klub paketni o'zgartirsa ham bron shu narxda qoladi. `GET /bookings/:id` da `package` (snapshot) qaytadi.
- **Narx/bo'sh joy:** `GET /branches/:id/availability?package_id` — `price_quote` paket bo'yicha (paket amal qilmaydigan qurilmada `null`, tanlab bo'lmaydi); `duration` paketnikiga tenglanadi. `GET /branches/:id/slots?package_id` — paket oynasidan tashqari slotlar chiqmaydi. `POST /branches/:id/price-quote {package_id?}`.
- **Ko'chirish:** paketli bron snapshot'dagi paket bilan qoladi: davomiylik o'zgarmaydi, yangi boshlanish oynaga mos bo'lishi kerak, narx snapshot narxi.
- **Walk-in:** `POST /bookings/walk-in {package_id?}` (ochiq/VIP bilan birga emas) — operator pultdan paket sotadi.
- **Sessiya:** uzaytirish va overtime — oddiy soatlik tarif bo'yicha (paketdan oshgan vaqt soatlik narxda). Erta tugatilsa qaytarim yo'q (paket oldindan sotiladi).
- **Klientlar:** admin tariflar sahifasida tarif ichida "Paketlar" bo'limi (nom, davomiylik, narx, kunlar, oyna, tejash ko'rsatkichi). Web/mobile bron vidjetida davomiylik qadamida "Paketlar" chiplari (narx, "−X so'm tejaysiz"); tanlansa davomiylik qulflanadi. Chiptada paket nomi. Operator pulti walk-in formasida paket tanlash. Paket chiplarida tarif nomi ham ko'rsatiladi (bir xil nomli paketlar turli xonalarda bo'lishi mumkin). Demo seed: har xona tarifiga "3 soat" (≈2.5 soat narxi) va "Tungi paket" 22:00–08:00, 8 soat (≈5 soat narxi). Mobile — hali yo'q.

### tariff_packages (migratsiya `20261013160000_tariff_packages`)

### 6.19 files — o'z fayl saqlash joyimiz 🆕 (2026-10-16)
- Fayl serverda `STORAGE_DIR` (prod: doimiy volume, backup'ga kiradi), metama'lumot `files` jadvalida (`owner_id, club_id, purpose, mime, size, sha256, storage_key, ref_type/ref_id`). S3 keyin kerak bo'lsa — faqat `FilesService` drayveri almashadi.
- `POST /files` (multipart: `file`, `purpose`, `club_id?`) — tur faylning birinchi baytlari bo'yicha aniqlanadi (Content-Type/kengaytmaga ishonilmaydi): `RECEIPT` (har qanday mijoz; JPEG/PNG/WEBP/PDF), `CLUB_MEDIA` (`clubs.update`; JPEG/PNG/WEBP — ommaviy, `public_url` → `logo_url`/`cover_url`), `CLUB_DOCUMENT` (`clubs.documents.manage`; JPEG/PNG/PDF). Hajm `UPLOAD_MAX_MB` (10). Xato: `VALIDATION_ERROR reason=FILE_TYPE|FILE_TOO_LARGE`.
- `GET /files/:id` — meta + havola: egasi, shu klub/filialda `payments.view|create` (chek), `clubs.documents.manage` / `platform.clubs.approve` (hujjat); boshqalarga 404. `GET /files/:id/raw` [public] — `CLUB_MEDIA` ochiq, qolganlari faqat imzolangan havola (`?exp&sig`, HMAC, 15 daqiqa). Javob: `X-Content-Type-Options: nosniff`, `CSP sandbox`.
- `POST /clubs/:id/documents {type, file_url | file_id}` — `file_id` shu klub uchun yuklangan, biriktirilmagan `CLUB_DOCUMENT` bo'lishi kerak; ro'yxatlarda `file_url` imzolangan havola bo'lib qaytadi.
- Biriktirilmagan cheklar 24 soatdan keyin o'chiriladi (soatlik fon vazifa).


## Rate limit (2026-10-15)
**Qaror:** barcha HTTP marshrutlar global guard (`common/rate-limit/`, `@nestjs/throttler` + o'zimizning Redis storage — Lua, atomar) orqali; hisoblagichlar Redis'da (`rl:*`), bir nechta API instansiyasi uchun umumiy. **Kalit:** token bo'lsa user id, aks holda klient IP (`trust proxy: loopback` — Nginx/Next proxy `X-Forwarded-For` beradi). Guard JWT guard'dan keyin, permission guard'dan oldin ishlaydi.
- **Javob:** `429`, `error.code = RATE_LIMITED`, `error.details.retry_after` (soniya) va `Retry-After` header. Limit oshgach kalit oyna davomiyligiga bloklanadi. Web/admin: `retry_after` bo'lsa «N soniya/daqiqadan keyin» matni (`errors.RATE_LIMITED_SECONDS|MINUTES`).
- **Sozlash** (`.env`, format `<so'rov>/<oyna soniya>`; bo'sh — standart):

| Daraja | Env | Standart | Hisob | Endpointlar |
|---|---|---|---|---|
| global | `RATE_LIMIT_GLOBAL` | 300/60 | kalit bo'yicha, barcha marshrutlar umumiy | hammasi (istisnolardan tashqari) |
| public | `RATE_LIMIT_PUBLIC` | 120/60 | marshrut + kalit | `GET /files/:id/raw`, `GET /discovery/*`, `GET /branches/{nearby,search,map,:id/summary}`, `GET /branches/:idOrSlug`, `/branches/:id/{availability,slots,reviews,device-categories,devices/public,tariffs,packages}`, `POST /branches/:id/price-quote`, `GET /clubs`, `/clubs/:idOrSlug/public`, `/clubs/:clubId/{branches,announcements}`, `GET /rental-items[/:id[/quote,/slots]]`, `GET /plans`, `/announcements`, `/social`, `/payments/providers` |
| write | `RATE_LIMIT_WRITE` | 30/60 | marshrut + kalit | `POST /files`, `POST /bookings`, `/bookings/:id/{cancel,reschedule}`, `POST /rentals`, `/rentals/:id/cancel`, `POST /payments`, `/payments/transfer`, `/payments/:id/demo/confirm`, `POST|PATCH|DELETE /reviews[/:id]`, `/reviews/:id/report`, `PUT|DELETE /favorites/:branchId`, `POST /support/tickets`, `/support/tickets/:id/messages`, `POST /users/me/device-tokens`, `POST /clubs` |
| sensitive | `RATE_LIMIT_SENSITIVE` | 20/300 | marshrut + kalit | `POST /auth/{login,send-otp,verify-otp,password,invitations/preview,invitations/accept}`, `POST /bookings/check-in/scan` (bron kodi/QR) |
| promo | `RATE_LIMIT_PROMO` | 10/600 | kalit bo'yicha, marshrutlar umumiy | `POST /promotions/validate`; `POST /bookings` va `POST /branches/:id/price-quote` — faqat body'da `promo_code` bo'lsa |

- **Istisno (hech qachon cheklanmaydi, `@NoRateLimit()`):** `/health*`, `POST /webhooks/payments/{payme,click/prepare,click/complete,demo}` (provayder o'zi autentifikatsiya qiladi, qayta urinishlari 429 olmasligi kerak), `POST /telegram/webhook`, WebSocket gateway.
- **Test:** e2e muhitda limitlar juda yuqori (`test/utils/rate-limit.env.ts`), `test/rate-limit.e2e-spec.ts` ularni pasaytirib 429/Retry-After, user bo'yicha kalit, webhook va health istisnolarini tekshiradi.
- **Deploy:** API oldidagi proxy loopback'da bo'lmasa `trust proxy` ni moslash kerak — aks holda barcha anonim so'rovlar proxy IP'si ostida bitta hisobga tushadi.
