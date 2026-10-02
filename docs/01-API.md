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

**Rate limit** (Redis, `@nestjs/throttler`): umumiy 120/min/IP; `POST /auth/send-otp` 3/10min/telefon + 10/soat/IP; `POST /auth/verify-otp` 5 urinish/kod; `POST /auth/login` 10/10min/IP+login; `POST /bookings` 20/min/user; payment webhook — IP allowlist/imzo bilan.

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
- Bir vaqtning o'zida `CUSTOMER_BOOKING_BLOCKED` bo'lgan (no-show limiti) mijoz bron qila olmaydi; bir mijozning bir xil vaqtga ikki bronini cheklash 🆕; bitta mijozning parallel `PENDING_PAYMENT` holdlari max 2.
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
