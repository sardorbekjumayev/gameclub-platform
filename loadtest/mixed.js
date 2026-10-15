/**
 * (c) "Oddiy kun": har iteratsiya tasodifiy amal — sayr 80%, bron 10%, bekor qilish 5%, mening bronlarim 5%.
 * Mijozlar setup() da OTP bilan kiradi (CUSTOMERS ta, default VUS), har VU o'z mijozini ishlatadi.
 * Bron — test klubining tasodifiy qurilmasi/kategoriyasi, tasodifiy kelajak slotiga (409 kutilgan holat).
 *
 *   k6 run -e BASE_URL=http://localhost:4700/api/v1 -e VUS=40 -e DURATION=5m loadtest/mixed.js
 */
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { book, browse, cancel, myBookings, pick, randomSlot, think } from './lib/api.js';
import { customerTokens } from './lib/auth.js';
import { DURATION, VUS, parseData, seconds } from './lib/config.js';

const DATA = parseData(open(__ENV.DATA_FILE || './.data.json'));
const CUSTOMERS = Number(__ENV.CUSTOMERS || VUS);
const hold = seconds(DURATION);

const server5xx = new Counter('mixed_5xx');
const booked = new Counter('mixed_booked');
const cancelled = new Counter('mixed_cancelled');

// Bron to'qnashuvi (409) — real hayotdagi oddiy holat, xato emas
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

export const options = {
  setupTimeout: '180s',
  scenarios: {
    day: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: `${Math.max(10, Math.round(hold / 5))}s`, target: VUS },
        { duration: `${hold}s`, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    'http_req_duration{name:POST bookings}': ['p(95)<1000'],
    'http_req_duration{name:GET bookings (mine)}': ['p(95)<500'],
    mixed_5xx: ['count==0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { tokens: customerTokens(CUSTOMERS) };
}

const all = () => DATA.devices.concat(DATA.category_devices);

function track(r) {
  if (r.status >= 500) {
    server5xx.add(1);
    console.error(`5xx ${r.request.method} ${r.request.url}: ${r.status} ${String(r.body).slice(0, 300)}`);
  }
  return r;
}

function doBook(token) {
  const item = Math.random() < 0.3 ? { category_id: DATA.category_id } : { device_id: pick(all()) };
  const r = track(book(token, { branch_id: DATA.branch_id, start_at: randomSlot(), items: [item] }));
  check(r, { 'bron 201/409': (x) => x.status === 201 || x.status === 409 });
  if (r.status === 201) booked.add(1);
  return r;
}

function doCancel(token) {
  // O'zining yaqin bronini bekor qiladi; bo'lmasa — avval bron qilib keyin bekor qiladi
  const list = track(myBookings(token));
  let id = list.status === 200 ? ((list.json('data') || []).find((b) => b.status === 'CONFIRMED') || {}).id : null;
  if (!id) {
    const r = doBook(token);
    id = r.status === 201 ? r.json('data.id') : null;
  }
  if (!id) return;
  const c = track(cancel(token, id));
  check(c, { 'bekor 2xx': (x) => x.status >= 200 && x.status < 300 });
  if (c.status < 300) cancelled.add(1);
}

export default function (d) {
  const token = d.tokens[(exec.vu.idInTest - 1) % d.tokens.length];
  const r = Math.random();
  if (r < 0.8) return browse(DATA);
  if (r < 0.9) doBook(token);
  else if (r < 0.95) doCancel(token);
  else check(track(myBookings(token, Math.random() < 0.5 ? 'UPCOMING' : 'PAST')), { 'mening bronlarim 200': (x) => x.status === 200 });
  think();
}
