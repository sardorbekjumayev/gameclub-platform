/**
 * (d) Stress: so'rovlar oqimi (iteratsiya/s) bosqichma-bosqich oshiriladi — xatolar yoki kechikish chegaradan
 * oshguncha. Chegara buzilsa test `abortOnFail` bilan to'xtaydi; o'sha paytdagi tezlik — "sinish nuqtasi".
 * Har iteratsiya = bitta ommaviy GET (tasodifiy: qidiruv / filial / slotlar / bo'sh joylar / xarita), tanaffussiz.
 *
 *   k6 run -e BASE_URL=http://localhost:4700/api/v1 -e START_RATE=20 -e MAX_RATE=1000 -e STEP=30s loadtest/stress.js
 *
 * Natijani o'qish: konsoldagi "level=..." yozuvlari har bosqichda maqsad tezlikni ko'rsatadi; summary'dagi
 * `http_reqs` (haqiqiy RPS), `dropped_iterations` (server ulgurmadi — VU yetmadi) va to'xtagan vaqt bo'yicha
 * sinish nuqtasi aniqlanadi (README "Stress natijasini o'qish").
 */
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { pick, slotAt, tashkentDate } from './lib/api.js';
import { BASE_URL, parseData } from './lib/config.js';

const DATA = parseData(open(__ENV.DATA_FILE || './.data.json'));
const START = Number(__ENV.START_RATE || 20);
const MAX = Number(__ENV.MAX_RATE || 1000);
const STEP = __ENV.STEP || '30s';
const STEPS = Number(__ENV.STEPS || 10);
const server5xx = new Counter('stress_5xx');

// Geometrik o'sish: START → MAX, STEPS bosqich; har bosqich STEP davomida ushlab turiladi
const rates = Array.from({ length: STEPS }, (_, i) => Math.round(START * Math.pow(MAX / START, i / (STEPS - 1))));
const stages = rates.flatMap((r) => [
  { duration: '5s', target: r },
  { duration: STEP, target: r },
]);

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: START,
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.PRE_VUS || 50),
      maxVUs: Number(__ENV.MAX_VUS || 1000),
      stages,
    },
  },
  thresholds: {
    // Sinish mezoni: 5% dan ko'p xato yoki p95 > 2 s — 15 s kuzatilgach to'xtatiladi
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
    http_req_duration: [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '15s' }],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const ENDPOINTS = [
  [3, () => [`/discovery/search?limit=20&lat=41.3&lng=69.25&sort=distance`, 'discovery/search']],
  [1, () => [`/discovery/map?bbox=69.1,41.2,69.4,41.4&zoom=12`, 'discovery/map']],
  [2, () => [`/branches/${DATA.branch_id}`, 'branches/:id']],
  [2, () => [`/branches/${DATA.branch_id}/slots?date=${tashkentDate(1 + Math.floor(Math.random() * 7))}&duration=60`, 'branches/:id/slots']],
  [2, () => [`/branches/${DATA.branch_id}/availability?start_at=${encodeURIComponent(slotAt(1 + Math.floor(Math.random() * 7), 20 + Math.floor(Math.random() * 20)))}&duration=60`, 'branches/:id/availability']],
];
const WEIGHTED = ENDPOINTS.flatMap(([w, f]) => Array(w).fill(f));

let lastLogged = -1;
export default function () {
  // Har VU o'zi ko'rgan bosqich o'zgarganda bir marta yozadi (tezlik jadvalini log'dan kuzatish uchun)
  const t = (Date.now() - exec.scenario.startTime) / 1000;
  const stage = Math.min(rates.length - 1, Math.floor(t / (5 + parseInt(STEP, 10))));
  if (exec.vu.idInTest === 1 && stage !== lastLogged) {
    lastLogged = stage;
    console.log(`bosqich ${stage + 1}/${rates.length}: maqsad ${rates[stage]} so'rov/s`);
  }
  const [path, name] = pick(WEIGHTED)();
  const r = http.get(`${BASE_URL}${path}`, { tags: { name } });
  if (r.status >= 500) server5xx.add(1);
  check(r, { '200': (x) => x.status === 200 });
}
