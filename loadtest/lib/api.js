import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { auth, BASE_URL } from './config.js';

/*
 * Ssenariylar uchun umumiy so'rovlar. Har so'rovga `name` tegi — natijada URL'dagi id/sana bo'yicha
 * minglab alohida qatorlar emas, endpoint bo'yicha bitta qator chiqadi.
 */

const THINK = Number(__ENV.THINK ?? 1); // sahifalar orasidagi "o'ylash" vaqti (s); 0 — tanaffussiz
export const think = (k = 1) => THINK > 0 && sleep(k * THINK * (0.5 + Math.random()));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const get = (path, name, params = {}) => http.get(`${BASE_URL}${path}`, { ...params, tags: { name, ...(params.tags || {}) } });

/** Toshkent sanasi (YYYY-MM-DD) bugundan `days` kun keyin (UTC+5, DST yo'q). */
export function tashkentDate(days = 0) {
  return new Date(Date.now() + 5 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
}

/**
 * Kelajakdagi slot boshlanishi (UTC ISO, 30 daqiqaga tekislangan — filial `slot_minutes` 30).
 * `days` 1..13 (max_advance_days 14), `halfHour` 0..47 — Toshkent kunining yarim soati.
 */
export function slotAt(days, halfHour) {
  const date = tashkentDate(days);
  const ms = Date.parse(`${date}T00:00:00+05:00`) + halfHour * 30 * 60_000;
  return new Date(ms).toISOString();
}

export const randomSlot = () => slotAt(1 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 46));

const GONE_OK = http.expectedStatuses(200, 404, 409);

const QUERIES = ['', 'club', 'cyber', 'arena', 'ps5', 'chilonzor', 'loadtest'];
const BBOXES = ['69.1,41.2,69.4,41.4', '69.15,41.25,69.35,41.35', '69.2,41.28,69.3,41.33'];

/**
 * Mijozning ommaviy sahifalar bo'ylab bir "sayri": qidiruv/ro'yxat → xarita → filial sahifasi → bo'sh joylar/slotlar.
 * Filial — test klubi yoki qidiruvdan tasodifiy (real katalog ham yuklanadi).
 */
export function browse(data) {
  let branchId = data.branch_id;
  group('catalog', () => {
    const q = pick(QUERIES);
    const s = get(`/discovery/search?limit=20${q ? `&q=${q}` : ''}${Math.random() < 0.5 ? '&lat=41.3&lng=69.25&sort=distance' : ''}`, 'discovery/search');
    check(s, { 'search 200': (r) => r.status === 200 });
    if (Math.random() < 0.5) check(get('/clubs?limit=20', 'clubs'), { 'clubs 200': (r) => r.status === 200 });
    const found = s.status === 200 ? (s.json('data') || []).map((b) => b.id) : [];
    if (found.length && Math.random() < 0.5) branchId = pick(found);
  });
  think();
  if (Math.random() < 0.4) {
    check(get(`/discovery/map?bbox=${pick(BBOXES)}&zoom=12`, 'discovery/map'), { 'map 200': (r) => r.status === 200 });
    think();
  }
  // Katalogdan olingan begona filial test davomida yopilishi mumkin (umumiy staging/dev baza) — 404/409 normal holat
  const foreign = branchId !== data.branch_id;
  const p = (name) => ({ tags: { name }, ...(foreign ? { responseCallback: GONE_OK } : {}) });
  const ok = (r) => r.status === 200 || (foreign && (r.status === 404 || r.status === 409));
  group('branch', () => {
    const res = http.batch([
      ['GET', `${BASE_URL}/branches/${branchId}`, null, p('branches/:id')],
      ['GET', `${BASE_URL}/branches/${branchId}/summary`, null, p('branches/:id/summary')],
      ['GET', `${BASE_URL}/branches/${branchId}/tariffs`, null, p('branches/:id/tariffs')],
      ['GET', `${BASE_URL}/branches/${branchId}/reviews`, null, p('branches/:id/reviews')],
    ]);
    check(res[0], { 'branch 200': ok });
  });
  think();
  group('availability', () => {
    const days = 1 + Math.floor(Math.random() * 7);
    const s = http.get(`${BASE_URL}/branches/${branchId}/slots?date=${tashkentDate(days)}&duration=60`, p('branches/:id/slots'));
    check(s, { 'slots 200': ok });
    const a = http.get(`${BASE_URL}/branches/${branchId}/availability?start_at=${encodeURIComponent(slotAt(days, 20 + Math.floor(Math.random() * 20)))}&duration=60`, p('branches/:id/availability'));
    check(a, { 'availability 200': ok });
  });
  think();
}

/** POST /bookings (AT_CLUB — hold limiti yo'q, bron darhol CONFIRMED). Idempotency-Key har urinishga yangi. */
export function book(token, body, tags = {}) {
  const key = `lt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return http.post(`${BASE_URL}/bookings`, JSON.stringify({ payment_mode: 'AT_CLUB', source: 'WEB', duration_minutes: 60, ...body }), {
    ...auth(token, { 'Idempotency-Key': key }),
    tags: { name: 'POST bookings', ...tags },
  });
}

export const myBookings = (token, status = 'UPCOMING') => http.get(`${BASE_URL}/bookings?status=${status}&limit=20`, { ...auth(token), tags: { name: 'GET bookings (mine)' } });

export function cancel(token, id) {
  return http.post(`${BASE_URL}/bookings/${id}/cancel`, JSON.stringify({ reason: 'loadtest' }), {
    ...auth(token, { 'Idempotency-Key': `lt-c-${id}` }),
    tags: { name: 'POST bookings/:id/cancel' },
  });
}

/** Xodim API orqali filialning barcha bronlari (sahifalab). */
export function staffBookings(token, branchId, extra = '') {
  const out = [];
  for (let page = 1; page < 1000; page++) {
    const r = http.get(`${BASE_URL}/bookings?staff=true&branch_id=${branchId}&limit=100&page=${page}${extra}`, { ...auth(token), tags: { name: 'GET bookings (staff)' } });
    if (r.status !== 200) throw new Error(`staff bookings ${r.status}: ${String(r.body).slice(0, 200)}`);
    const rows = r.json('data') || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const LIVE = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE']);

/**
 * Bitta qurilmada vaqti kesishgan faol bronlar (double-booking). DB exclusion constraint buni taqiqlaydi —
 * natija bo'sh bo'lishi shart. Muddati o'tgan hold'lar (hold_expires_at) hisobga olinmaydi.
 */
export function findOverlaps(bookings) {
  const now = Date.now();
  const byDevice = new Map();
  for (const b of bookings) {
    if (!LIVE.has(b.status)) continue;
    if (b.status === 'PENDING_PAYMENT' && b.hold_expires_at && Date.parse(b.hold_expires_at) <= now) continue;
    for (const d of b.devices || []) {
      if (!byDevice.has(d.id)) byDevice.set(d.id, []);
      byDevice.get(d.id).push({ id: b.id, code: b.code, s: Date.parse(b.start_at), e: Date.parse(b.end_at), device: d.name });
    }
  }
  const out = [];
  for (const list of byDevice.values()) {
    list.sort((a, b) => a.s - b.s);
    // Saralangan ro'yxatda oldingi bronlarning eng kech tugashi bilan solishtiriladi
    let last = list[0];
    for (let i = 1; i < list.length; i++) {
      if (list[i].s < last.e) out.push({ device: list[i].device, a: last.code, b: list[i].code });
      if (list[i].e > last.e) last = list[i];
    }
  }
  return out;
}
