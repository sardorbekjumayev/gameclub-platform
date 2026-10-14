#!/usr/bin/env node
// Lokal muhitni bir buyruqda tayyorlaydi: `pnpm run setup`
// (`pnpm setup` pnpm'ning o'z buyrug'i — shuning uchun `run` shart.)
//
// Qadamlar: tekshiruv → env fayllar (+ Yandex kalit) → pnpm install → docker → prisma → migrate → seed.
// Bayroqlar: --key=<yandex-kalit>  (so'ramaydi)   --skip-db  (docker/migrate/seed'siz)
// Qayta ishga tushirish xavfsiz: mavjud env qiymatlari saqlanadi, seed idempotent.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argKey = args.find((a) => a.startsWith('--key='))?.slice(6).trim();
const skipDb = args.includes('--skip-db');

const c = (n) => (s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = c(1), green = c(32), yellow = c(33), red = c(31), cyan = c(36), dim = c(2);
const step = (n, t) => console.log(`\n${cyan(`[${n}/7]`)} ${bold(t)}`);
const ok = (t) => console.log(`  ${green('✓')} ${t}`);
const warn = (t) => console.log(`  ${yellow('!')} ${t}`);
const fail = (t) => {
  console.error(`\n  ${red('✗')} ${t}\n`);
  process.exit(1);
};

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  return r.status === 0;
}
function has(cmd, cmdArgs = ['--version']) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore', shell: process.platform === 'win32' });
  return r.status === 0;
}

// ---------- env fayl yordamchilari ----------
function readEnv(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
function getVar(text, key) {
  const m = text?.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}
function setVar(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n*$/, '\n')}${key}=${value}\n`;
}

const WEB_ENV = (key) => `NEXT_PUBLIC_API_URL=/api/v1
API_ORIGIN=http://localhost:4700
NEXT_PUBLIC_TOKEN_KEY=gc.web.tokens

# Yandex: "JavaScript API va HTTP Geocoder" kaliti
NEXT_PUBLIC_YANDEX_MAPS_KEY=${key}
NEXT_PUBLIC_SITE_URL=http://localhost:4710
# "Klub ochish" havolasi (prod: https://club.<domen>). Bo'sh bo'lsa havola ko'rsatilmaydi.
NEXT_PUBLIC_CLUB_PANEL_URL=

# Dev server boshqa host (IP/domen) orqali ochilsa, vergul bilan
ALLOWED_DEV_ORIGINS=
`;
const ADMIN_ENV = (key) => `NEXT_PUBLIC_API_URL=/api/v1
API_ORIGIN=http://localhost:4700
NEXT_PUBLIC_TOKEN_KEY=gc.admin.tokens

# Yandex: "JavaScript API va HTTP Geocoder" kaliti
NEXT_PUBLIC_YANDEX_MAPS_KEY=${key}

# Dev server boshqa host (IP/domen) orqali ochilsa, vergul bilan
ALLOWED_DEV_ORIGINS=
`;

// ---------- Yandex kalit ----------
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Geocoder'ga bitta so'rov: kalit aynan "JavaScript API va HTTP Geocoder" mahsulotiga tegishlimi. */
async function probeKey(key) {
  try {
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(key)}&geocode=Tashkent&format=json&results=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return 'ok';
    if (res.status === 403 || res.status === 401) return 'denied';
    return 'unknown';
  } catch {
    return 'offline';
  }
}

function explainKey() {
  console.log(`
  Yandex kabinetida (${cyan('developer.tech.yandex.ru')}) sizda bir nechta kalit bo'lishi mumkin.
  Bu loyihaga ${bold('faqat bittasi')} kerak:

    ${green('✓')} ${bold('"JavaScript API и HTTP Геокодер"')}  ${dim('(JavaScript API and HTTP Geocoder)')}
    ${red('✗')} "Static API"                      ${dim('— statik rasm xarita, bizda ishlatilmaydi')}
    ${red('✗')} "API Геосаджеста" (Geosuggest)    ${dim('— manzil tavsiyalari, bizda ishlatilmaydi')}
    ${red('✗')} "MapKit SDK"                      ${dim('— native mobil SDK, bizning mobile WebView orqali JS API ishlatadi')}

  Bitta shu kalit web, admin va mobile uchun ham ishlaydi.
  Kalit ko'rinishi: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ${dim("Bo'sh qoldirsangiz (Enter) — xaritasiz davom etadi, keyin qayta `pnpm run setup` qilish mumkin.")}
`);
}

async function askKey(current) {
  if (argKey !== undefined) return argKey;
  if (!process.stdin.isTTY) {
    warn("Terminal interaktiv emas — kalit so'ralmadi (--key=... bilan berish mumkin).");
    return current ?? '';
  }
  explainKey();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const hint = current ? ` ${dim(`[Enter = joriy ${current.slice(0, 8)}…]`)}` : '';
      const raw = (await rl.question(`  Yandex Maps kalitini kiriting${hint}: `)).trim();
      if (!raw) return current ?? '';
      if (!KEY_RE.test(raw)) {
        warn("Format noto'g'ri — kalit UUID ko'rinishida bo'lishi kerak. Qayta kiriting.");
        continue;
      }
      process.stdout.write(`  ${dim('Kalit tekshirilmoqda…')}\r`);
      const r = await probeKey(raw);
      process.stdout.write('\r\x1b[K');
      if (r === 'ok') {
        ok("To'g'ri kalit: \"JavaScript API va HTTP Geocoder\" ishlayapti.");
        return raw;
      }
      if (r === 'offline' || r === 'unknown') {
        warn("Kalitni internet orqali tekshirib bo'lmadi — shu kalit yozib qo'yiladi.");
        return raw;
      }
      warn('Yandex bu kalitni rad etdi (403). Ehtimol bu boshqa mahsulot kaliti (Static API / Geosuggest / MapKit)');
      warn("yoki kabinetda HTTP Referer cheklovi qo'yilgan. Boshqa kalitingizni kiriting.");
      const again = (await rl.question(`  Baribir shu kalitni yozaymi? ${dim('(y/N)')} `)).trim().toLowerCase();
      if (again === 'y' || again === 'yes' || again === 'ha') return raw;
    }
  } catch (e) {
    if (e?.code !== 'ABORT_ERR') throw e;
    console.log();
    warn("Kiritish to'xtatildi (Ctrl+D) — joriy qiymat saqlanadi.");
    return current ?? '';
  } finally {
    rl.close();
  }
}

// ---------- asosiy oqim ----------
console.log(bold('\nZonup — lokal sozlash'));

step(1, 'Talablarni tekshirish');
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node.js ${process.versions.node} — kamida 20 kerak (nodejs.org).`);
ok(`Node.js ${process.versions.node}`);
if (!has('pnpm')) fail("pnpm topilmadi. Avval: corepack enable");
ok('pnpm');
const dockerOk = has('docker', ['compose', 'version']);
if (!skipDb && !dockerOk) fail('Docker (compose bilan) topilmadi. Docker Desktop o\'rnating yoki --skip-db bilan ishga tushiring.');
if (dockerOk) ok('docker compose');

step(2, 'API env (apps/api/.env)');
const apiEnvPath = join(ROOT, 'apps/api/.env');
if (existsSync(apiEnvPath)) {
  ok('Mavjud — tegilmadi');
} else {
  let text = readFileSync(join(ROOT, 'apps/api/.env.example'), 'utf8');
  for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'QR_HMAC_SECRET']) {
    text = setVar(text, k, randomBytes(32).toString('hex'));
  }
  writeFileSync(apiEnvPath, text);
  ok(".env.example'dan yaratildi (JWT/QR sirlari tasodifiy generatsiya qilindi)");
}

step(3, 'Yandex Maps kaliti');
const webEnvPath = join(ROOT, 'apps/web/.env.local');
const adminEnvPath = join(ROOT, 'apps/admin/.env.local');
const webText = readEnv(webEnvPath);
const adminText = readEnv(adminEnvPath);
const currentKey = getVar(webText, 'NEXT_PUBLIC_YANDEX_MAPS_KEY') || getVar(adminText, 'NEXT_PUBLIC_YANDEX_MAPS_KEY') || undefined;
const key = await askKey(currentKey);

writeFileSync(webEnvPath, webText ? setVar(webText, 'NEXT_PUBLIC_YANDEX_MAPS_KEY', key) : WEB_ENV(key));
ok(`apps/web/.env.local   ${dim('→ NEXT_PUBLIC_YANDEX_MAPS_KEY')}`);
writeFileSync(adminEnvPath, adminText ? setVar(adminText, 'NEXT_PUBLIC_YANDEX_MAPS_KEY', key) : ADMIN_ENV(key));
ok(`apps/admin/.env.local ${dim('→ NEXT_PUBLIC_YANDEX_MAPS_KEY')}`);
if (!key) warn("Kalit bo'sh — xarita o'rniga \"tez orada\" holati ko'rinadi.");

step(4, "Package'larni o'rnatish (pnpm install)");
if (!run('pnpm', ['install'])) fail('pnpm install muvaffaqiyatsiz.');
ok("O'rnatildi");

if (skipDb) {
  warn('--skip-db: 5–7 qadamlar o\'tkazib yuborildi.');
} else {
  step(5, 'Postgres + Redis (docker compose up -d)');
  if (!run('docker', ['compose', 'up', '-d'])) fail('docker compose up muvaffaqiyatsiz (Docker ishlab turibdimi?).');
  // TCP orqali tekshiramiz: init.sql bajarilayotganda postgres faqat unix socket'da tinglaydi.
  process.stdout.write(`  ${dim('Postgres tayyor bo\'lishini kutish')}`);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-h', '127.0.0.1', '-U', 'gc', '-d', 'gameclub'], { cwd: ROOT, stdio: 'ignore' });
    ready = r.status === 0;
    if (!ready) {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log();
  if (!ready) fail('Postgres 60 soniyada tayyor bo\'lmadi: docker compose logs postgres');
  ok('Postgres :55432, Redis :56379');

  step(6, 'Prisma client + migratsiyalar');
  if (!run('pnpm', ['--filter', '@gc/api', 'exec', 'prisma', 'generate'])) fail('prisma generate muvaffaqiyatsiz.');
  if (!run('pnpm', ['db:migrate'])) fail('Migratsiya muvaffaqiyatsiz.');
  ok('Baza sxemasi tayyor');

  step(7, "Demo ma'lumotlar (seed)");
  if (!run('pnpm', ['db:seed'])) fail('Seed muvaffaqiyatsiz.');
  ok("Demo klublar, qurilmalar, ijara konsollari qo'shildi");
}

const mobileCmd = `flutter run --dart-define=API_URL=http://<kompyuter-IP>:4700/api/v1${key ? ` --dart-define=YANDEX_MAPS_KEY=${key}` : ''}`;
console.log(`
${green(bold('Tayyor!'))} Har birini alohida terminalda ishga tushiring:

  pnpm dev:api        ${dim('http://localhost:4700/api/docs')}
  pnpm dev:web        ${dim('http://localhost:4710')}
  pnpm dev:platform   ${dim('http://localhost:4720  (super admin)')}
  pnpm dev:club       ${dim('http://localhost:4730  (klub egasi)')}
  pnpm dev:desk       ${dim('http://localhost:4740  (operator)')}

  Admin:  admin@gameclub.local / ChangeMe123!
  Mijoz:  telefon raqam, kod ${bold('000000')} ${dim('(TELEGRAM_BOT_TOKEN bo\'sh bo\'lsa)')}

  Mobile (gameclub-mobile repo'sida):
    ${mobileCmd}
`);
