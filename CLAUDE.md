# CLAUDE.md — Game Club Platform

Bu fayl repo ildizida turadi. Har bir sessiyada birinchi o'qiladi.

## Hujjatlar
`docs/00-README.md` (qarorlar) → `docs/02-DATABASE.md` → `docs/01-API.md` → klient hujjatlari (`03`–`06`).
Vazifa boshlashdan oldin tegishli hujjat bo'limini o'qi. Hujjatda yo'q narsani o'zingdan o'ylab topma — savol ber yoki `docs/` ga taklif sifatida yoz.

## Qat'iy qoidalar
1. Biznes logika faqat `apps/api` da. Web/mobile faqat API'ni chaqiradi va ko'rsatadi.
2. Pul faqat `BIGINT` tiyinda. `float`/`double` ishlatma. Klientda formatlash uchun yagona helper.
3. Vaqt DB va API'da UTC ISO-8601; ko'rsatishda filial timezone (`Asia/Tashkent`).
4. Har bir resurs so'rovida scope tekshiruvi (club/branch). Bir klub boshqa klub ma'lumotini hech qachon ko'rmasligi kerak. Har feature uchun buni tekshiradigan test yoz.
5. Bron/sessiya/to'lov yozuvlari tranzaksiya ichida; double-booking DB exclusion constraint bilan himoyalangan (`02-DATABASE.md`).
6. Har bir POST (bron, to'lov, refund, sessiya amallari) `Idempotency-Key` ni qo'llab-quvvatlaydi.
7. DTO validatsiya (`class-validator`), Swagger dekoratorlari majburiy. OpenAPI'dan `packages/types` generatsiya qilinadi.
8. Permissionlar controllerlarga qattiq yozilmaydi: `@RequirePermission('devices.update')`.
9. Sezgir ma'lumot (OTP, token, karta, parol) log'ga tushmaydi.
10. Har bir muhim admin amali `audit_logs` ga yoziladi.
11. Migratsiyalar faqat oldinga; mavjud migratsiyani tahrirlama.
12. Matnlar i18n kalitlari orqali (`uz` default, `ru`, `en`). Hardcoded matn yo'q.

## Ish tartibi (har bir feature)
1. Talab → 2. DB migratsiya → 3. NestJS modul (service, controller, DTO) → 4. Swagger → 5. Testlar (unit + e2e + scope + concurrency kerak bo'lsa) → 6. Web → 7. Mobile → 8. Integratsiya tekshiruvi.

## Definition of Done
Migratsiya bor · DTO validatsiya bor · permission/scope bor · Swagger bor · testlar yashil · audit log (kerak bo'lsa) · loading/empty/error holatlar (UI) · uz/ru/en matnlar · lint/format o'tgan · commit `feat:`/`fix:` formatida.

## Komandalar
```text
docker compose up -d            # postgres(postgis) :55432, redis :56379
pnpm install
pnpm dev:api | pnpm dev:web | pnpm dev:admin
pnpm test | pnpm test:e2e | pnpm lint
pnpm db:migrate | pnpm db:seed
pnpm gen:types   # OpenAPI -> packages/types
cd mobile && flutter run --dart-define=API_URL=http://<host>:4700/api/v1 --dart-define=YANDEX_MAPS_KEY=<kalit>
```
Dev kirish: super admin `admin@gameclub.local` / `ChangeMe123!` (`apps/api/.env`), customer OTP kodi dev'da `000000`.
Web/admin API'ni o'z domeni orqali `/api/v1` (Next rewrite → `API_ORIGIN`) chaqiradi — CORS kerak emas.
Portlar (serverdagi boshqa servislar bilan to'qnashmaslik uchun): API `4700` (Swagger `/api/docs`), web `4710`, admin `4720`.
Object storage (S3/MinIO) hali docker-compose'da yo'q — `minio/minio` image reestrdan olib bo'lmadi; Phase 2 (files) da qo'shiladi.
Xarita: Yandex Maps JS API 2.1 + HTTP Geocoder (`MapProvider` abstraksiyasi: web/admin `src/components/map/`, mobile `lib/features/map/` — WebView). Kalit `apps/{web,admin}/.env.local` → `NEXT_PUBLIC_YANDEX_MAPS_KEY` (git'ga tushmaydi), mobile'da `--dart-define`. Xarita markerlari `GET /branches/map?bbox=` dan (Phase 2); endpoint yo'q bo'lsa UI "tez orada" holatini ko'rsatadi.
