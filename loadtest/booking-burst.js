/**
 * (b) Bron "portlashi": VUS ta mijoz BIR VAQTDA (soat bo'yicha to'siq) bir xil qurilma + vaqtga va bir xil kategoriyaga
 * bron qiladi. Kutiladi: faqat 201 yoki 409, hech qanday 5xx; har raundda qurilmaga ko'pi bilan 1 ta, kategoriyaga
 * ko'pi bilan kategoriya qurilmalari soncha bron. teardown() xodim API orqali filialda bitta qurilmada vaqti kesishgan
 * faol bron yo'qligini tekshiradi (`overlap_violations` = 0).
 *
 *   k6 run -e BASE_URL=http://localhost:4700/api/v1 -e VUS=50 -e ROUNDS=5 \
 *          -e ADMIN_EMAIL=admin@gameclub.local -e ADMIN_PASSWORD='ChangeMe123!' loadtest/booking-burst.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { book, findOverlaps, slotAt, staffBookings } from './lib/api.js';
import { customerTokens, staffLogin } from './lib/auth.js';
import { VUS, parseData } from './lib/config.js';

const DATA = parseData(open(__ENV.DATA_FILE || './.data.json'));
const ROUNDS = Number(__ENV.ROUNDS || 5);
const GAP_S = Number(__ENV.GAP || 4); // raundlar orasidagi soniya (to'siq)

const created = new Counter('burst_created');
const conflicts = new Counter('burst_conflict');
const server5xx = new Counter('burst_5xx');
const unexpected = new Counter('burst_unexpected');
const overlaps = new Counter('overlap_violations');

// 409 (joy band) bu testda kutilgan javob — xato hisoblanmaydi
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

export const options = {
  setupTimeout: '180s',
  teardownTimeout: '120s',
  scenarios: {
    same_device: { executor: 'per-vu-iterations', vus: VUS, iterations: ROUNDS, maxDuration: `${ROUNDS * GAP_S + 120}s`, exec: 'sameDevice' },
    same_category: { executor: 'per-vu-iterations', vus: VUS, iterations: ROUNDS, maxDuration: `${ROUNDS * GAP_S + 120}s`, exec: 'sameCategory' },
  },
  thresholds: {
    burst_5xx: ['count==0'],
    burst_unexpected: ['count==0'],
    overlap_violations: ['count==0'],
    burst_created: ['count>0'],
    http_req_failed: ['rate==0'],
    'http_req_duration{name:POST bookings}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const tokens = customerTokens(VUS);
  // Har ishga tushirishda boshqa kun/soat — oldingi run bronlari bilan aralashmasin (ehtimolini kamaytiradi)
  const day = 2 + Math.floor(Math.random() * 11);
  const base = Math.floor(Math.random() * (48 - ROUNDS * 3));
  const slots = Array.from({ length: ROUNDS }, (_, i) => slotAt(day, base + i * 3)); // 1.5 soat oraliq
  const t0 = Date.now() + 3000;
  console.log(`burst: ${tokens.length} mijoz, ${ROUNDS} raund, slotlar ${slots[0]} … ${slots[slots.length - 1]}`);
  return { tokens, slots, t0 };
}

/** Raund to'sig'i: barcha VU'lar bir xil soat millisekundida yuboradi. */
function waitRound(d, round) {
  const at = d.t0 + round * GAP_S * 1000;
  const ms = at - Date.now();
  if (ms > 0) sleep(ms / 1000);
}

function fire(d, kind, item) {
  // per-vu-iterations: VU'ning shu ssenariydagi n-iteratsiyasi = n-raund
  const round = exec.vu.iterationInScenario;
  const token = d.tokens[(exec.vu.idInTest - 1) % d.tokens.length];
  waitRound(d, round);
  const r = book(token, { branch_id: DATA.branch_id, start_at: d.slots[round % ROUNDS], items: [item] }, { kind });
  const code = r.status === 409 ? r.json('error.code') : null;
  if (r.status === 201) created.add(1, { kind });
  else if (r.status === 409) conflicts.add(1, { kind });
  if (r.status >= 500) {
    server5xx.add(1, { kind });
    console.error(`5xx ${kind} round=${round}: ${r.status} ${String(r.body).slice(0, 300)}`);
  }
  const ok = check(r, {
    '201 yoki 409': (x) => x.status === 201 || x.status === 409,
    '409 → BOOKING_SLOT_TAKEN': (x) => x.status !== 409 || code === 'BOOKING_SLOT_TAKEN',
  });
  if (!ok) {
    unexpected.add(1, { kind });
    if (r.status < 500) console.warn(`kutilmagan javob ${kind}: ${r.status} ${String(r.body).slice(0, 300)}`);
  }
}

export function sameDevice(d) {
  fire(d, 'device', { device_id: DATA.devices[0] });
}

export function sameCategory(d) {
  fire(d, 'category', { category_id: DATA.category_id });
}

export function teardown(d) {
  const token = __ENV.ADMIN_EMAIL ? staffLogin(__ENV.ADMIN_EMAIL, __ENV.ADMIN_PASSWORD) : staffLogin(DATA.owner_phone, DATA.owner_password);
  const from = d.slots[0];
  const to = new Date(Date.parse(d.slots[d.slots.length - 1]) + 3 * 3600_000).toISOString();
  const rows = staffBookings(token, DATA.branch_id, `&from=${encodeURIComponent(new Date(Date.parse(from) - 6 * 3600_000).toISOString())}&to=${encodeURIComponent(to)}`);
  const bad = findOverlaps(rows);
  overlaps.add(bad.length);
  for (const o of bad.slice(0, 20)) console.error(`OVERLAP: ${o.device} ${o.a} ↔ ${o.b}`);

  // Raund bo'yicha hisobot: qurilmaga ≤1, kategoriyaga ≤ kategoriya hajmi
  const cat = new Set(DATA.category_devices);
  for (const s of d.slots) {
    const live = rows.filter((b) => b.start_at === s && ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'].includes(b.status));
    const dev = live.filter((b) => (b.devices || []).some((x) => x.id === DATA.devices[0])).length;
    const inCat = live.filter((b) => (b.devices || []).some((x) => cat.has(x.id))).length;
    console.log(`slot ${s}: device[0] bronlari=${dev} (≤1), kategoriya bronlari=${inCat} (≤${cat.size})`);
    check(null, {
      'qurilmaga ≤1 bron': () => dev <= 1,
      'kategoriyaga ≤ hajm': () => inCat <= cat.size,
    });
  }
  check(null, { 'kesishgan faol bron yo\'q': () => bad.length === 0 });
}
