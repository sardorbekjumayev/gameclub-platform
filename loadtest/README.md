# Yuklama testlari (k6)

> **DIQQAT: production'da HECH QACHON ishlatmang.** Ssenariylar yuzlab soxta mijoz (tasodifiy `+99899…` telefonlar),
> bronlar va bekor qilishlar yaratadi. Haqiqiy to'lov provayderlari (Payme/Click) ulangan muhitda ishga tushirish
> real tranzaksiyalar va SMS/Telegram xabarlariga olib kelishi mumkin. Faqat lokal yoki alohida staging bazada,
> to'lov provayderlari o'chirilgan (yoki test rejimida) holda ishlating. `lib/config.js` localhost/staging bo'lmagan
> hostni `CONFIRM_HOST` siz rad etadi.

## Tarkib

| Fayl | Nima qiladi |
| --- | --- |
| `setup-data.mjs` | Node skript (k6 emas). Super admin sifatida **alohida test klubi** yaratadi: klub → filial (24/7) → kategoriya "Arena" (5 PC) + 20 oddiy PC → tarif → moderatsiya tasdig'i. Id'larni `loadtest/.data.json` ga yozadi (git'ga tushmaydi). `CLOSE=1` — klubni yopadi. |
| `browse.js` | (a) Ommaviy sayr, login yo'q: qidiruv/klublar ro'yxati, xarita, filial sahifasi (+summary, tariflar, sharhlar), slotlar va bo'sh joylar. VU'lar bosqichma-bosqich `VUS` gacha oshadi. Chegara: `p(95) < 500ms`, `http_req_failed < 1%`. |
| `booking-burst.js` | (b) Bir vaqtda (soat bo'yicha to'siq bilan, `ROUNDS` raund) `VUS` ta mijoz **bitta qurilma + vaqtga** va **bitta kategoriyaga** bron qiladi. Faqat `201`/`409 BOOKING_SLOT_TAKEN` qabul qilinadi, 5xx = 0. `teardown()` xodim API (`GET /bookings?staff=true`) orqali filialda **bitta qurilmada kesishgan faol bron yo'qligini** tekshiradi (`overlap_violations == 0`) va har raund bo'yicha hisobot chiqaradi. |
| `mixed.js` | (c) "Oddiy kun": sayr 80%, bron 10% (tasodifiy qurilma/kategoriya/slot), bekor qilish 5% (o'z broni; bo'lmasa avval bron qiladi), "mening bronlarim" 5%. |
| `stress.js` | (d) Ommaviy GET oqimi (iteratsiya/s) geometrik oshadi (`START_RATE` → `MAX_RATE`, `STEPS` bosqich). Xatolar > 5% yoki p95 > 2 s bo'lsa test o'zi to'xtaydi — o'sha tezlik "sinish nuqtasi". |
| `lib/config.js` | Env: `BASE_URL`, `VUS`, `DURATION`; prod himoyasi; `.data.json` o'qish. |
| `lib/auth.js` | Mijoz OTP kirishi (`/auth/send-otp` + `/auth/verify-otp`, tasodifiy telefon + `X-Forwarded-For`), parallel `customerTokens(n)`, xodim kirishi (`/auth/login`). |
| `lib/api.js` | Sayr, bron, bekor qilish, xodim ro'yxati va kesishish tekshiruvi. |

## k6 o'rnatish

k6 repo bog'liqligi emas — alohida o'rnatiladi (https://grafana.com/docs/k6/latest/set-up/install-k6/):

```bash
# Ubuntu/Debian
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# yoki statik binar (root kerak emas)
curl -L https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz | tar xz
./k6-v0.54.0-linux-amd64/k6 version

# macOS: brew install k6     Docker: docker run --rm -i --network host grafana/k6 run - <loadtest/browse.js
```

## Tayyorgarlik

1. API ishga tushgan bo'lsin. Lokal o'lchov uchun dev server (`pnpm dev:api`, watch rejimi) emas, build qilinganini ishlating:
   ```bash
   pnpm --filter @gc/api build && (cd apps/api && node dist/main.js)
   ```
   Dev'da mijoz OTP kodi `000000` bo'lishi uchun `apps/api/.env` da `TELEGRAM_BOT_TOKEN` bo'sh va `NODE_ENV=development`.
   (`NODE_ENV=production` da OTP kodi tasodifiy — faqat `stress.js` va `browse.js` ishlaydi, ular login qilmaydi.)
2. Test ma'lumotlari:
   ```bash
   BASE_URL=http://localhost:4700/api/v1 ADMIN_EMAIL=admin@gameclub.local ADMIN_PASSWORD='ChangeMe123!' \
     node loadtest/setup-data.mjs          # → loadtest/.data.json
   ```
   Lokal `BASE_URL` da admin env berilmasa dev standarti (`CLAUDE.md`) olinadi. Boshqa `.data.json` uchun k6'ga `-e DATA_FILE=...`.
3. Testdan keyin klubni katalogdan olib tashlash: `CLOSE=1 node loadtest/setup-data.mjs` (bronlar bazada qoladi — faqat dev/staging!).

### Limitlar haqida
- **OTP:** bitta telefon — 60 s cooldown, kuniga 10 kod; bitta IP — soatiga 10 kod (`otp.service.ts`). Skriptlar har
  mijozga yangi tasodifiy telefon va soxta `X-Forwarded-For` (10.x.x.x) beradi. API `trust proxy: loopback` — XFF faqat
  so'rov lokal (loopback) proksidan/k6'dan kelsa hisobga olinadi. **Staging'da** k6 boshqa mashinada bo'lsa, proksi o'z
  IP'sini qo'yadi va soatiga 10 ta kirishdan keyin `429 RATE_LIMITED` keladi — k6'ni API bilan bitta hostda ishga tushiring
  yoki mijozlar sonini kamaytiring (`CUSTOMERS`, `VUS`). Limitlarni test uchun o'chirmang.
- **Xodim kirishi:** `login:<ip>:<login>` limiti — bitta run'da bitta kirish, muammo emas.
- **Bron:** `AT_CLUB` rejimida yuboriladi (hold limiti `booking.max_parallel_holds` ga urilmaslik uchun). Filial
  `max_advance_days` = 14 — slotlar 1..13 kun oralig'ida.

## Ishga tushirish

```bash
K="k6 run -e BASE_URL=http://localhost:4700/api/v1"

$K -e VUS=50 -e DURATION=2m loadtest/browse.js
$K -e VUS=50 -e ROUNDS=5 -e ADMIN_EMAIL=admin@gameclub.local -e ADMIN_PASSWORD='ChangeMe123!' loadtest/booking-burst.js
$K -e VUS=40 -e DURATION=5m loadtest/mixed.js
$K -e START_RATE=20 -e MAX_RATE=1000 -e STEPS=10 -e STEP=30s loadtest/stress.js

# Staging (host nomida "staging" bo'lmasa CONFIRM_HOST bilan tasdiqlash shart)
k6 run -e BASE_URL=https://api.staging.example.uz/api/v1 -e VUS=30 loadtest/browse.js

# Natijani faylga (keyingi tahlil uchun): --out json=loadtest/results/browse.json  (results/ git'ga tushmaydi)
```

| Env | Default | Qayerda |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:4700/api/v1` | hammasi |
| `VUS` | 20 | browse, burst (mijozlar soni = VUS), mixed |
| `DURATION` | `1m` | browse, mixed (ushlab turish bosqichi) |
| `THINK` | 1 | sahifalar orasidagi pauza koeffitsiyenti (s); `0` — tanaffussiz |
| `ROUNDS`, `GAP` | 5, 4 | burst: raundlar soni va ular orasidagi soniya |
| `CUSTOMERS` | `VUS` | mixed: OTP bilan kiradigan mijozlar soni |
| `START_RATE`, `MAX_RATE`, `STEPS`, `STEP`, `PRE_VUS`, `MAX_VUS` | 20, 1000, 10, `30s`, 50, 1000 | stress |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | burst teardown (bo'lmasa `.data.json` dagi klub egasi) |
| `DATA_FILE` | `./.data.json` | hammasi |
| `OTP_CODE` | `000000` | mijoz kirishi |
| `CONFIRM_HOST` | — | localhost/staging bo'lmagan host uchun tasdiq |

## Natijani o'qish

- `✓/✗` thresholds — chegara bajarildimi. Biror chegara buzilsa k6 **99** kodi bilan chiqadi (CI'da qizil).
- `http_req_duration` — javob vaqti; `p(95)` — so'rovlarning 95% shundan tez. `{ name:... }` qatorlari — endpoint bo'yicha.
- `http_reqs` — jami so'rovlar va **RPS** (`/s`). `iterations` — "foydalanuvchi sayri" soni.
- `http_req_failed` — xato ulushi. `409` (joy band) burst/mixed'da xato hisoblanmaydi (`expectedStatuses`).
- `burst_created` / `burst_conflict` / `burst_5xx` / `overlap_violations` — burst'ning asosiy natijasi: to'g'rilik
  (5xx = 0, kesishish = 0) tezlikdan muhimroq. Teardown har raund uchun `device[0] bronlari=1 (≤1), kategoriya bronlari=N (≤5)` yozadi.
- `dropped_iterations` (stress) — server sekinlashib, k6 rejalashtirilgan so'rovni yubora olmadi: tizim to'yingan.
- 5xx bo'lsa javobdagi `error.request_id` ni API log'idan qidiring (`x-request-id`).

### Stress natijasini o'qish
Konsolda `bosqich N/M: maqsad X so'rov/s` yozuvlari chiqadi. Test `thresholds ... stopping test prematurely` bilan
to'xtagan bo'lsa, oxirgi yozilgan bosqichdan **oldingisi** — barqaror ishlagan eng yuqori tezlik. Aniqroq ko'rish uchun
`--out json=...` bilan yozib, 10 soniyalik oynalar bo'yicha RPS/p95 ni hisoblang: p95 keskin o'sgan oyna — sinish nuqtasi.

## O'lchov natijalari (lokal, 2026-10-15)

Muhit: bitta `node dist/main.js` jarayoni (dev, pino-pretty log), Postgres/Redis lokal, 16 yadro. Bir vaqtda boshqa
jarayonlar (build/e2e) ham ishlagan — raqamlar taxminiy, faqat solishtirish uchun.

| Ssenariy | Yuklama | Natija |
| --- | --- | --- |
| browse | 30 VU, 60 s | 53 RPS, p95 88 ms (availability p95 132 ms), xato 0% — ✓ |
| mixed | 30 VU, 60 s | 56 RPS, p95 90 ms, `POST /bookings` p95 247 ms, 5xx 0 — ✓ |
| booking-burst | 20 mijoz × 2 ssenariy × 5 raund | 0 ta 5xx, 0 ta kesishish, faqat 201/409; lekin `POST /bookings` p95 9.6 s — ✗ |
| booking-burst | 50 mijoz × 2 × 5 | **20 ta 500** (Prisma pool/tranzaksiya timeout), p95 31.8 s; kesishish 0 — ✗ |
| stress | 20→800 it/s | ~60–75 RPS gacha p95 < 100 ms; ~85–100 RPS da p95 > 2 s → to'xtadi. `NODE_ENV=production` da ham shu (≈ 95–100 RPS) |

Topilmalar (tuzatilmagan, alohida vazifa):
1. **Bir vaqtdagi bronlarda 500.** 100 ta parallel `POST /bookings` (bitta qurilma/kategoriya) — so'rovlar exclusion
   constraint'da bir-birini kutadi, har biri Prisma pool ulanishini band qiladi (limit 21, `maxWait` 10 s,
   interaktiv tranzaksiya `timeout` 20 s). Natija: `Timed out fetching a new connection from the connection pool`
   va `Transaction already closed ... timeout was 20000 ms, however 20988 ms passed` → 500 `INTERNAL_ERROR`.
   Double-booking yo'q (DB himoyasi ishlaydi), lekin mijoz 409 o'rniga 500 oladi va kutish 30+ s.
2. **`GET /branches/:id/availability` eng og'ir endpoint**: ketma-ket ~48 ms/so'rov (25 qurilma), boshqalari 3–7 ms.
   Stress aralashmasida 20% ulush bilan bitta Node jarayonining CPU chegarasini (~100 RPS) belgilaydi (main thread
   100%+ CPU). Ehtimoliy sabab — har qurilma uchun alohida `pricing.tryQuote` (timezone segmentlari); bir xil
   tarifdagi qurilmalar narxini bir marta hisoblash yoki qisqa kesh, va bir nechta API replika (cluster) yordam beradi.
