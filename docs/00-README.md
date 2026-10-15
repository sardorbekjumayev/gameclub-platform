# ZONUP PLATFORM — Hujjatlar to'plami

Bu papka `GAME-CLUB-PLATFORM-SPEC.md` asosida tahlil qilinib, har bir qism bo'yicha alohida hujjatga ajratilgan.
Belgilar: 🆕 = asl spetsifikatsiyada yo'q, tahlil paytida qo'shilgan feature/qaror. ⚠️ = asl spetsifikatsiyadagi ziddiyat/aniqlik kerak bo'lgan joy, bu yerda hal qilingan.

## 1. Hujjatlar xaritasi

| Fayl | Nima uchun | Kim o'qiydi |
|---|---|---|
| `00-README.md` | Umumiy ko'rinish, qarorlar, qo'shilgan featurelar, phase reja | Hamma |
| `CLAUDE.md` | Claude Code uchun repo ildiziga qo'yiladigan qoidalar | Claude |
| `01-API.md` | NestJS backend: modullar, endpointlar, biznes qoidalar, algoritmlar, WebSocket, joblar, xavfsizlik | Backend |
| `02-DATABASE.md` | PostgreSQL/PostGIS sxema, constraint, indekslar, migratsiya | Backend |
| `03-MOBILE.md` | Flutter customer ilovasi | Mobile |
| `04-WEB-CUSTOMER.md` | Next.js customer web (SEO, booking) | Web |
| `05-WEB-CLUB-ADMIN.md` | Club owner / admin / operator paneli (Next.js `apps/admin`) | Web |
| `06-WEB-SUPER-ADMIN.md` | Platforma egasi paneli (Next.js `apps/admin`, alohida route group) | Web |
| `07-PC-AGENT-V2.md` | Klub kompyuteriga o'rnatiladigan agent (V2) | Desktop |

**Ishlash tartibi (Claude bilan):** avval `00` → `02` → `01` → keyin klient hujjatlari. Har bir phase uchun `01-API.md` oxiridagi checklistdan foydalaning. Klient (web/mobile) hech qachon biznes logikani o'zida saqlamaydi.

## 2. Mahsulot qisqacha

Marketplace + club-management platforma.
- **Customer:** yaqin klubni xaritadan topadi → bo'sh PC/consolelarni ko'radi → vaqt bron qiladi → to'laydi → QR bilan check-in → o'ynaydi → sharh qoldiradi.
- **Club:** filiallar, xonalar, qurilmalar, tariflar, bronlar, live sessiyalar, kassa, hisobotlar.
- **Super Admin:** klublarni tasdiqlash, foydalanuvchilar, to'lovlar, obuna, komissiya, moderatsiya, audit.

## 3. Ilovalar va repozitoriy

```text
game-club-platform/
├── apps/
│   ├── api/        # NestJS (yagona backend)
│   ├── web/        # Next.js — customer web (SEO, public)
│   └── admin/      # Next.js — club panel (/club/*) + super admin (/platform/*)
├── mobile/         # Flutter — customer app
├── agent/          # (V2) PC Client Agent
├── packages/
│   ├── types/      # umumiy TS tiplar, OpenAPI'dan generatsiya qilingan client
│   ├── config/     # tsconfig, env schema
│   └── eslint-config/
├── infrastructure/ {docker, nginx, postgres}
├── docs/           # shu hujjatlar
├── docker-compose.yml
└── CLAUDE.md
```

⚠️ Asl spetsifikatsiyada 2.3 va 2.4 alohida web deb yozilgan, 3-bo'limda bitta `web`, 52-bo'limda `web` + `admin`. **Qaror:** ikkita Next.js app: `apps/web` (public customer) va `apps/admin` (club + super admin, alohida layout/route group, rolga qarab redirect). Sabab: customer web SEO/SSR va tez yuklanish uchun yengil bo'lishi kerak, admin esa og'ir dashboard.

## 4. Arxitektura qarorlari (ADR)

| # | Qaror | Sabab |
|---|---|---|
| 1 | Modular monolith (NestJS) | Spetsifikatsiya talabi; mikroservis kerak emas |
| 2 | PostgreSQL 16 + PostGIS + `btree_gist` | Geo-qidiruv va DB darajasida double-booking oldini olish |
| 3 | ORM: Prisma + qo'lda yozilgan SQL migratsiyalar | Prisma exclusion constraint/PostGIS'ni to'g'ridan-to'g'ri qo'llamaydi; shu qismlar raw SQL |
| 4 | Redis: cache, rate limit, lock, BullMQ, Socket.IO adapter | V1'dan boshlab BullMQ ishlatiladi (spetsda V2 deyilgan, lekin hold expiry va reminderlar uchun kerak) 🆕 |
| 5 | Socket.IO (`/ws`) + Redis adapter | Real-time, gorizontal scale |
| 6 | Pul: `BIGINT`, **tiyin** (1 so'm = 100 tiyin), valyuta `UZS` | Float xatolari yo'q; to'lov provayderlari tiyin ishlatadi 🆕 |
| 7 | Vaqt: DB'da `timestamptz` (UTC); filial `timezone` (default `Asia/Tashkent`) | To'g'ri vaqt hisobi 🆕 |
| 8 | ID: UUID v7 (app'da generatsiya) | Tartiblangan, index-friendly 🆕 |
| 9 | Soft delete (`deleted_at`) biznes entitylarda; to'lov/audit hech qachon o'chirilmaydi | Tarixiy ma'lumot 🆕 |
| 10 | ⚠️ Qurilma holati uch qatlamga bo'lindi: `operational_status` (saqlanadi), `connectivity` (agent heartbeat), `occupancy` (bron/sessiyadan hisoblanadi) | Spetsda `AVAILABLE/OCCUPIED/MAINTENANCE/OFFLINE` bitta ro'yxatda aralashgan, lekin "alohida saqlansin" deyilgan |
| 11 | Kategoriya bo'yicha bronda qurilma **bron paytidayoq** biriktiriladi (best-fit); operator keyin o'zgartira oladi | DB constraint ishlashi uchun konkret `device_id` kerak 🆕 |
| 12 | Har bir moliyaviy operatsiya idempotent (`Idempotency-Key`, provider `transaction_id` unique) | Spets NFR |
| 13 | Til: `uz` (lotin, default), `ru`, `en` | Bozor talabi 🆕 |
| 14 | Har bir booking narx snapshot'ini saqlaydi (tarif keyin o'zgarsa ham eski bron narxi o'zgarmaydi) | Moliyaviy izchillik 🆕 |
| 15 | Server-authoritative timer: sessiya vaqtini server hisoblaydi, klient faqat ko'rsatadi | Soatni o'zgartirib aldash oldi olinadi 🆕 |

## 5. Rollar (qisqa matritsa)

| Rol | Scope | Asosiy vakolat |
|---|---|---|
| SUPER_ADMIN | Platform | Hammasi |
| CLUB_OWNER | Club | Klub, filiallar, xodimlar, tariflar, moliya, analytics |
| CLUB_ADMIN | Club yoki Branch | Owner bergan permissionlar doirasida |
| OPERATOR | Branch | Live dashboard, walk-in, session, kassa |
| CUSTOMER | O'zi | Qidirish, bron, to'lov, sharh |
| 🆕 SUPPORT (platforma xodimi) | Platform | Complaint/review, foydalanuvchini ko'rish (moliya va sozlamalarsiz) |

To'liq permission katalogi: `01-API.md` §5.

## 6. Asl spetsifikatsiyaga QO'SHILGAN featurelar 🆕

**Booking va sessiya**
1. Booking qoidalari: slot qadami (15/30 daq), min/max oldindan bron, filial buffer (bronlar orasida tozalash vaqti), check-in oynasi va grace.
2. `NO_SHOW` holati va avtomatik bo'shatish; ko'p marta kelmagan customer uchun cheklov/blacklist.
3. Bronni **ko'chirish (reschedule)** — bekor qilmasdan vaqtni o'zgartirish.
4. Guruh bron: bir bronda bir nechta qurilma (`booking_items`); V2 team booking uchun asos.
5. Bron manbasi: `APP`, `WEB`, `WALK_IN`, `PHONE`.
6. Overtime (vaqtdan oshib ketish) va `session_charges` (extension/overtime/adjustment).
7. To'lov muddatidan keyin kelgan webhook (payment-after-expiry) uchun qayta tasdiqlash yoki avto-refund.
8. Kutish ro'yxati (waitlist) — V1.5.
9. Filial ish vaqti istisnolari (bayram, yopiq kunlar).

**Moliya**
10. Operator **kassa smenasi** (shift open/close, naqd hisob-kitob).
11. Ledger (`ledger_entries`) — komissiya va payout uchun to'g'ri asos.
12. Promo kod / chegirma engine (spetsda faqat nom sifatida bor).
13. Payment reconciliation job (provider bilan solishtirish).
14. Hisobotlarni CSV/XLSX eksport.

**Platforma**
15. Klub verification hujjatlari va tasdiqlash workflow (KYC).
16. Complaint / support ticket sxemasi (spetsda menyuda bor, sxemasi yo'q edi).
17. Klub e'lonlari (announcements) va platforma broadcast.
18. Xodim taklifi (invitation) oqimi.
19. Qurilma texnik xizmat (maintenance) tiketlari.
20. Feature flags va `platform_settings`.
21. Obuna limitlarini majburlash (entitlements guard).
22. Mobil ilova versiya tekshiruvi / force update.
23. Deep links va universal links.
24. Customer web SEO: slug, sitemap, JSON-LD.
25. Maxfiylik: akkauntni o'chirish, ma'lumot eksporti, rozilik (consent) versiyalari.
26. Outbox pattern (ishonchli domain eventlar) va Idempotency-Key.
27. Observability: request-id, metrikalar, Sentry, health/readiness.
28. Anti-fraud: SMS-pumping himoyasi, OTP limitlari, qurilma fingerprint.
29. Test strategiyasi (concurrency testlar bilan), seed/demo ma'lumotlar.
30. Mijoz eslatmalari (booking boshlanishidan oldin, sessiya tugashiga 10 daq).

## 7. Release rejasi

**MVP** (spets §48 + §57): Auth+RBAC → Club/Branch/Room → Device/Tariff → Discovery → Booking engine → Payment (1 provayder) → Session + Live dashboard → Notifications (push+in-app) → Basic analytics → Super admin approval.

**V1:** Reviews, Favorites, Refunds, QR check-in, Telegram, Subscriptions, Commission/payout, Promo, Advanced filters, Kassa smenasi, Waitlist.

**V2:** PC Agent, Wallet, Loyalty, Membership, Tournament, Team booking, Social.

Phase'lar (0–10) `01-API.md` §14 da, har bir phase uchun API + Web + Mobile vazifalari bilan.

## 8. Ochiq savollar (qaror qabul qilish kerak)

1. Xarita provayderi: Google Maps yoki Yandex MapKit (yoki OSM/MapLibre). Har ikki klientda `MapProvider` abstraksiyasi bilan boshlanadi.
2. To'lov provayderi(lar)i: Payme / Click / Uzum va h.k. — shartnoma va hujjatlar API'sini tekshiring. Kod `PaymentProvider` interfeysi orqali yoziladi.
3. SMS provayderi (OTP): mahalliy SMS gateway (masalan Eskiz) — narx va shablon tasdiqlash jarayoni.
4. Komissiya: MVP'da yoqilganmi yoki faqat yozib boriladimi?
5. Klub to'lovlari: mijoz pulini platforma ushlab, keyin payout qiladimi, yoki klub merchant hisobiga to'g'ridan-to'g'ri tushadimi (huquqiy/litsenziya jihati).
6. Nom va domen.
