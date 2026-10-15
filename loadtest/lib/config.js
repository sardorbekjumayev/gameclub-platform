// Umumiy sozlamalar: hammasi env orqali (k6 run -e BASE_URL=... yoki shell env).
// BASE_URL API prefiksi bilan birga: http://localhost:4700/api/v1

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4700/api/v1').replace(/\/+$/, '');
export const VUS = Number(__ENV.VUS || 20);
export const DURATION = __ENV.DURATION || '1m';

/**
 * Production'ga tasodifan yuborishdan himoya: localhost emas va nomida staging/test/dev yo'q bo'lsa,
 * CONFIRM_HOST=<host> bilan host nomini aniq takrorlash shart.
 */
const HOST = (/^https?:\/\/([^/:]+)/.exec(BASE_URL) || [])[1] || '';
const SAFE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(HOST) || /staging|stage|test|dev/i.test(HOST);
if (!SAFE_HOST && __ENV.CONFIRM_HOST !== HOST) {
  throw new Error(`BASE_URL (${HOST}) localhost/staging emas. Production'da yuklama testi taqiqlanadi; staging bo'lsa: -e CONFIRM_HOST=${HOST}`);
}

/** Davomiylikni ("30s", "2m", "1h") soniyaga aylantiradi — bosqichlarni bo'lish uchun. */
export function seconds(d) {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(String(d).trim());
  if (!m) throw new Error(`DURATION noto'g'ri: ${d}`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600, undefined: n }[m[2]];
}

/** setup-data.mjs yozgan fayl (`open()` faqat scenariy faylining init qismida chaqiriladi). */
export function parseData(raw) {
  const d = JSON.parse(raw);
  for (const k of ['branch_id', 'devices', 'category_id', 'category_devices']) {
    if (!d[k]) throw new Error(`.data.json da "${k}" yo'q — avval: node loadtest/setup-data.mjs`);
  }
  if (d.base_url && d.base_url.replace(/\/+$/, '') !== BASE_URL) {
    console.warn(`DIQQAT: .data.json ${d.base_url} uchun yaratilgan, test esa ${BASE_URL} ga yuborilyapti`);
  }
  return d;
}

export const json = { headers: { 'Content-Type': 'application/json' } };

export const auth = (token, extra = {}) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra } });
