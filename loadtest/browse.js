/**
 * (a) Ommaviy sayr: katalog/qidiruv, xarita, filial sahifasi, bo'sh joylar va slotlar. Login yo'q.
 * VUS gacha bosqichma-bosqich oshadi → DURATION davomida ushlab turiladi → kamayadi.
 *
 *   k6 run -e BASE_URL=http://localhost:4700/api/v1 -e VUS=50 -e DURATION=2m loadtest/browse.js
 */
import { browse } from './lib/api.js';
import { DURATION, VUS, parseData, seconds } from './lib/config.js';

const DATA = parseData(open(__ENV.DATA_FILE || './.data.json'));
const hold = seconds(DURATION);
const ramp = `${Math.max(10, Math.round(hold / 4))}s`;

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: ramp, target: Math.ceil(VUS / 2) },
        { duration: ramp, target: VUS },
        { duration: `${hold}s`, target: VUS },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Eng og'ir endpointlar alohida ko'rinsin
    'http_req_duration{name:branches/:id/availability}': ['p(95)<500'],
    'http_req_duration{name:branches/:id/slots}': ['p(95)<500'],
    'http_req_duration{name:discovery/search}': ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  browse(DATA);
}
